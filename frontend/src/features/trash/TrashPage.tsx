/**
 * /trash — deleted runs (admins only; brief 07 §2.18). URL state: ?q=&project=&page= (1-based).
 * Single and bulk restore (≤200) with skipped reasons; archived-project rows cannot be restored.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useSearchParams } from 'react-router-dom';
import { RESTORE_MAX, TRASH_PAGE, useRestoreRuns, useTrash, useTrashProjects, type TrashRun } from '@/api/trash';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useAuth, useDocumentTitle } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import { Badge, Button, DataTable, EmptyState, ErrorState, Icon, PageHeader, Pagination, RunStatusBadge, SearchField, Select, Skeleton, Tag, Text, Tooltip, useToast, type RunStatus } from '@/ui';
import styles from './TrashPage.module.css';

const DAY = 86_400_000;

export function purgeInfo(row: TrashRun, now = Date.now()): { text: string; tone?: 'warning' | 'danger'; sub?: string; soon: boolean } {
  if (row.purge_paused || row.project_archived) return { text: 'Paused', sub: 'Purge paused while the project is archived', soon: false };
  if (!row.purge_at) return { text: 'Not scheduled', soon: false };
  const days = (Date.parse(row.purge_at) - now) / DAY;
  if (days <= 0) return { text: 'Due now', tone: 'danger', soon: true };
  if (days < 1) return { text: 'in under 1 day', tone: 'danger', soon: true };
  const n = Math.ceil(days);
  return { text: `in ${n} day${n === 1 ? '' : 's'}`, tone: n < 3 ? 'warning' : undefined, soon: n < 3, sub: new Date(row.purge_at).toLocaleDateString() };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function TrashPage() {
  const { isAdmin } = useAuth();
  useDocumentTitle('Deleted runs');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const projectId = params.get('project') || null;
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const toast = useToast();
  const restore = useRestoreRuns();
  const list = useTrash({ q, projectId, page }, isAdmin);
  const projects = useTrashProjects(isAdmin);
  const showSkeleton = useDelayedPending(list.isPending && isAdmin);

  function setQuery(updates: Record<string, string | null>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => {
      setQuery({ q: search.trim() || null, page: null });
      setSelected(new Set());
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, q]);

  const rows = useMemo(() => [...(list.data?.runs ?? [])].sort((a, b) => (a.purge_at ?? '9').localeCompare(b.purge_at ?? '9')), [list.data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const restorableSelected = [...selected].map(String).filter((id) => byId.get(id) && !byId.get(id)!.project_archived);

  // An emptied last page steps back.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && list.data.runs.length === 0 && page > 1) setQuery({ page: String(page - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.isPlaceholderData, page]);

  async function doRestore(ids: string[]) {
    try {
      const r = await restore.mutateAsync(ids);
      const skipped = r.skipped ?? [];
      const restored = r.restored ?? (skipped.length ? [] : ids);
      setSelected(new Set());
      toast.show(
        `${restored.length} run${restored.length === 1 ? '' : 's'} restored${skipped.length ? ` · ${skipped.length} skipped: ${[...new Set(skipped.map((s) => s.reason))].join('; ')}` : ''}`,
        { tone: restored.length ? 'success' : 'error' },
      );
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Restore failed', { tone: 'error' });
    }
  }

  if (!isAdmin) {
    return (
      <div className={constrained}>
        <PageHeader title="Deleted runs" />
        <EmptyState icon={<Icon name="shield" />} title="Admin access required" body="Only platform admins can view and restore deleted runs." />
      </div>
    );
  }
  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <div className={constrained}>
        <PageHeader title="Deleted runs" />
        <EmptyState icon={<Icon name="shield" />} title="Admin access required" body="Only platform admins can view and restore deleted runs." />
      </div>
    );
  }

  const total = list.data?.total ?? 0;
  const grace = list.data?.graceDays;
  const filtered = Boolean(q || projectId);
  return (
    <div className={constrained} data-trash-page>
      <PageHeader
        title="Deleted runs"
        description={
          grace
            ? `Deleted runs are permanently removed ${grace} days after deletion, not counting time their project spends archived. Restore a run before its purge date to keep it.`
            : 'Automatic purge is off: deleted runs are kept until removed by an operator.'
        }
        meta={[
          <span key="r">Retention {grace ? `${grace} days` : 'Off'}</span>,
          <span key="n">{filtered ? `${total} matching` : `${total} deleted run${total === 1 ? '' : 's'}`}</span>,
          <span key="a">Only admins can restore runs</span>,
        ]}
      />
      <div className={styles.toolbar}>
        <SearchField label="Search run name or ID" placeholder="Search run name or ID" value={search} onChange={setSearch} width={280} />
        <Select
          label="Project"
          hideLabel
          placeholder="All projects"
          items={[{ key: '', label: 'All projects' }, ...(projects.data ?? []).map((p) => ({ key: p.id, label: `${p.name}${p.archived ? ' (archived)' : ''} · ${p.deleted_runs}` }))]}
          value={projectId ?? ''}
          onChange={(k) => {
            setQuery({ project: k ? String(k) : null, page: null });
            setSelected(new Set());
          }}
          searchable="auto"
          width={260}
        />
        <span className={styles.grow} />
        <Text as="span" variant="sm" tone="muted" aria-live="polite">
          {restorableSelected.length ? `${restorableSelected.length} selected` : ''}
        </Text>
        <Button
          variant="accent"
          isDisabled={!restorableSelected.length || restorableSelected.length > RESTORE_MAX}
          loading={restore.isPending}
          onPress={() => void doRestore(restorableSelected)}
          data-testid="restore-selected"
        >
          Restore {restorableSelected.length ? restorableSelected.length : ''} selected
        </Button>
      </div>
      {showSkeleton ? (
        <Skeleton kind="table" rows={6} label="Loading deleted runs" />
      ) : list.isError ? (
        <ErrorState error={list.error} title="Couldn’t load deleted runs" onRetry={() => void list.refetch()} />
      ) : list.data && rows.length === 0 ? (
        <EmptyState title={filtered ? 'No deleted runs match' : 'Nothing in the trash'} body={filtered ? 'Try another search or project.' : 'Runs you delete appear here until they are purged.'} />
      ) : list.data ? (
        <>
          <DataTable<TrashRun>
            aria-label="Deleted runs"
            className={styles.table}
            storageKey="trash-v2"
            rows={rows}
            rowKey={(r) => r.id}
            selection={{
              selected,
              onChange: (keys) => setSelected(new Set([...keys].filter((k) => byId.get(String(k)) && !byId.get(String(k))!.project_archived))),
            }}
            dimmed={list.isFetching && list.isPlaceholderData}
            columns={[
              {
                id: 'run',
                label: 'Run',
                flex: true,
                minWidth: 240,
                cell: (r) => (
                  <span className={styles.runCell}>
                    <Text as="span" variant="md" weight={600} truncate>
                      {r.run_name}
                    </Text>
                    <span className={styles.runId} title={`Created ${new Date(r.created_at).toLocaleString()}`}>
                      {r.id}
                    </span>
                  </span>
                ),
              },
              {
                id: 'project',
                label: 'Project',
                width: 170,
                cell: (r) => (
                  <span className={styles.stack}>
                    <span>{r.project_name}</span>
                    {r.project_archived ? <Tag tone="warning">Project archived</Tag> : null}
                  </span>
                ),
              },
              {
                id: 'purges',
                label: 'Purges',
                width: 170,
                cell: (r) => {
                  const p = purgeInfo(r);
                  return (
                    <span className={styles.stack} data-soon={p.soon ? '' : undefined}>
                      {p.tone ? <Badge tone={p.tone}>{p.text}</Badge> : <span>{p.text}</span>}
                      {p.sub ? <span className={styles.sub}>{p.sub}</span> : null}
                    </span>
                  );
                },
              },
              {
                id: 'deleted',
                label: 'Deleted',
                width: 170,
                cell: (r) => (
                  <span className={styles.stack}>
                    <span className={styles.mono}>{fmtDate(r.deleted_at)}</span>
                    {r.deleted_by_name ? <span className={styles.sub}>by {r.deleted_by_name}</span> : null}
                  </span>
                ),
              },
              { id: 'status', label: 'Status', width: 120, cell: (r) => <RunStatusBadge status={r.status as RunStatus} /> },
              { id: 'model', label: 'Model', width: 150, cell: (r) => r.model ?? '—' },
              { id: 'task', label: 'Task', width: 140, cell: (r) => r.task ?? '—' },
              { id: 'dataset', label: 'Dataset', width: 140, cell: (r) => r.dataset ?? '—' },
              {
                id: 'actions',
                label: 'Restore',
                hideLabel: true,
                width: 100,
                align: 'end',
                cell: (r) =>
                  r.project_archived ? (
                    <Tooltip content="Unarchive the project to restore this run.">
                      <Button variant="neutral" size="sm" aria-disabled="true" onPress={() => toast.show('Unarchive the project to restore this run.', { tone: 'info' })}>
                        Restore
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button variant="accent" size="sm" onPress={() => void doRestore([r.id])} isDisabled={restore.isPending} data-testid={`restore-${r.id}`}>
                      Restore
                    </Button>
                  ),
              },
            ]}
          />
          <Pagination total={total} page={page} pageSize={TRASH_PAGE} noun="deleted runs" onPageChange={(p) => { setQuery({ page: p <= 1 ? null : String(p) }); setSelected(new Set()); }} />
        </>
      ) : null}
    </div>
  );
}
