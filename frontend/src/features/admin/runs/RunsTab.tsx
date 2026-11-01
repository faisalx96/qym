import { useEffect, useState } from 'react';
import {
  RECENT_PAGE_SIZE,
  useAllProjects,
  useLiveRuns,
  useRecentRuns,
  type AdminRunSummary,
} from '@/api/admin';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { DataTable, ErrorState, SearchField, Section, Select, Skeleton, useToast } from '@/ui';
import { ForceStopDialog } from './ForceStopDialog';
import { RunTable } from './RunTables';

/**
 * Live runs (10 s poll, force stop; the empty table stays, owner note on C093) + the most recent runs: 25 a page
 * (`?page=`), with a run search (`?q=`) and a Project filter (`?project=`) across every project (C093).
 */
export function RunsTab({ announce }: { announce: (text: string) => void }) {
  const live = useLiveRuns();
  const { params, replaceUrlQuery } = useSearchParamsState();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  const projectId = params.get('project') || null;
  const [search, setSearch] = useState(q);
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => replaceUrlQuery({ q: search.trim() || null, page: null }), 250);
    return () => clearTimeout(t);
  }, [search, q, replaceUrlQuery]);
  const projects = useAllProjects();
  const recent = useRecentRuns(page, RECENT_PAGE_SIZE, true, { q, projectId });
  const filtered = Boolean(q || projectId);
  const toast = useToast();
  const lastPage = recent.data ? Math.max(1, Math.ceil(recent.data.total_count / RECENT_PAGE_SIZE)) : null;
  useEffect(() => {
    if (lastPage !== null && page > lastPage) replaceUrlQuery({ page: lastPage === 1 ? null : lastPage });
  }, [lastPage, page, replaceUrlQuery]);
  const [target, setTarget] = useState<AdminRunSummary | null>(null);
  const showLiveSkeleton = useDelayedPending(live.isPending);
  const showRecentSkeleton = useDelayedPending(recent.isPending);

  return (
    <>
      <Section
        id="live-runs"
        title="Live runs"
        description={live.data ? `${live.data.total_count} running across all projects` : undefined}
      >
        {live.isError ? (
          <ErrorState
            error={live.error}
            title="Failed to load live runs"
            onRetry={() => live.refetch()}
            compact
          />
        ) : live.isPending ? (
          showLiveSkeleton ? (
            <Skeleton kind="table" rows={3} label="Loading live runs" />
          ) : null
        ) : (
          <RunTable
            aria-label="Live runs"
            variant="live"
            storageKey="admin-live-runs"
            runs={live.data.runs}
            onForceStop={setTarget}
            emptyState="No live runs"
            footerSummary={`${live.data.runs.length} live`}
          />
        )}
      </Section>
      <Section
        id="recent-runs"
        title="Most recent eval runs"
        description={
          filtered
            ? `${recent.data?.total_count ?? 0} matching finished runs`
            : `${recent.data?.total_count ?? 0} total finished runs`
        }
      >
        {recent.isError ? (
          <ErrorState
            error={recent.error}
            title="Failed to load recent runs"
            onRetry={() => recent.refetch()}
            compact
          />
        ) : recent.isPending ? (
          showRecentSkeleton ? (
            <Skeleton kind="table" rows={4} label="Loading recent runs" />
          ) : null
        ) : (
          <>
            <RunTable
              aria-label="Recent runs"
              variant="recent"
              storageKey="admin-recent-runs"
              runs={recent.data.runs}
              onForceStop={setTarget}
              emptyState={filtered ? 'No finished runs match' : 'No recent eval runs'}
              toolbar={
                <DataTable.Toolbar
                  columnsMenu={false}
                  search={
                    <SearchField
                      label="Search runs"
                      placeholder="Search run name or ID"
                      value={search}
                      onChange={setSearch}
                      onClear={() => setSearch('')}
                      width={280}
                    />
                  }
                  filters={
                    <Select
                      label="Project"
                      hideLabel
                      placeholder="All projects"
                      items={[
                        { key: '', label: 'All projects' },
                        ...(projects.data ?? [])
                          .filter((p) => p.is_active)
                          .map((p) => ({ key: p.id, label: p.name })),
                      ]}
                      value={projectId ?? ''}
                      onChange={(k) => replaceUrlQuery({ project: k ? String(k) : null, page: null })}
                      searchable="auto"
                      width={220}
                    />
                  }
                />
              }
              pagination={{
                total: recent.data.total_count,
                page,
                pageSize: RECENT_PAGE_SIZE,
                noun: 'runs',
                onPageChange: (p) => replaceUrlQuery({ page: p === 1 ? null : p }),
              }}
            />
          </>
        )}
      </Section>
      <ForceStopDialog
        run={target}
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        onStopped={(run, stopped) => {
          const label = run.run_name || run.external_run_id || run.run_id.slice(0, 8);
          const msg = stopped ? `was force stopped. Further updates are blocked.` : `was already stopped.`;
          toast.show(`“${label}” ${msg}`, { tone: stopped ? 'success' : 'info' });
          announce(`${label} ${msg}`);
        }}
        onFailed={(_run, message) => {
          announce(`Could not force stop run: ${message}`);
        }}
      />
    </>
  );
}
