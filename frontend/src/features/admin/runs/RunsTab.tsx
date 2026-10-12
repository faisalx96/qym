import { useState } from 'react';
import { RECENT_PAGE_SIZE, useLiveRuns, useRecentRuns, type AdminRunSummary } from '@/api/admin';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { Badge, ErrorState, Pagination, SectionHeader, Skeleton, Stack, useToast } from '@/ui';
import { ForceStopDialog } from './ForceStopDialog';
import { RunTable } from './RunTables';

/** Live runs (10 s poll, force stop) + most recent runs (6/page, `?page=`). */
export function RunsTab({ announce }: { announce: (text: string) => void }) {
  const live = useLiveRuns();
  const { params, replaceUrlQuery } = useSearchParamsState();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const recent = useRecentRuns(page);
  const toast = useToast();
  const [target, setTarget] = useState<AdminRunSummary | null>(null);
  const showLiveSkeleton = useDelayedPending(live.isPending);
  const showRecentSkeleton = useDelayedPending(recent.isPending);

  return (
    <Stack gap="xl">
      <section aria-labelledby="live-runs-title">
        <SectionHeader
          id="live-runs-title"
          title="Live runs"
          description={`${live.data?.total_count ?? 0} running across all projects`}
          aside={
            <Badge tone="info" dot>
              polling every 10 s
            </Badge>
          }
        />
        {live.isError ? (
          <ErrorState error={live.error} title="Failed to load live runs" onRetry={() => live.refetch()} compact />
        ) : live.isPending ? (
          showLiveSkeleton ? <Skeleton kind="table" rows={3} label="Loading live runs" /> : null
        ) : (
          <RunTable
            aria-label="Live runs"
            variant="live"
            storageKey="admin-live-runs"
            runs={live.data.runs}
            onForceStop={setTarget}
            emptyState="No live runs"
          />
        )}
      </section>
      <section aria-labelledby="recent-runs-title">
        <SectionHeader id="recent-runs-title" title="Most recent eval runs" description={`${recent.data?.total_count ?? 0} total finished runs`} />
        {recent.isError ? (
          <ErrorState error={recent.error} title="Failed to load recent runs" onRetry={() => recent.refetch()} compact />
        ) : recent.isPending ? (
          showRecentSkeleton ? <Skeleton kind="table" rows={4} label="Loading recent runs" /> : null
        ) : (
          <>
            <RunTable
              aria-label="Recent runs"
              variant="recent"
              storageKey="admin-recent-runs"
              runs={recent.data.runs}
                onForceStop={setTarget}
              emptyState="No recent eval runs"
            />
            <Pagination
              total={recent.data.total_count}
              page={page}
              pageSize={RECENT_PAGE_SIZE}
              noun="runs"
              onPageChange={(p) => replaceUrlQuery({ page: p === 1 ? null : p })}
            />
          </>
        )}
      </section>
      <ForceStopDialog
        run={target}
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        onStopped={(run) => {
          const label = run.run_name || run.external_run_id || run.run_id.slice(0, 8);
          toast.show(`“${label}” was force stopped. Further updates are blocked.`, { tone: 'success' });
          announce(`${label} was force stopped. Further updates are blocked.`);
        }}
        onFailed={(_run, message) => {
          announce(`Could not force stop run: ${message}`);
        }}
      />
    </Stack>
  );
}
