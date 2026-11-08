/**
 * /trash — deleted runs (admins only; brief 07 §2.18). URL state: ?q=&project=&page= (1-based).
 * Single and bulk restore (≤200) with skipped reasons; archived-project rows cannot be restored.
 * Row actions sit in one menu behind the row's '>' handle, as on the runs list (C151): Restore and Delete permanently.
 * Delete permanently (C118) asks for a typed count and also works on runs of an archived project, so that project's
 * Deleted runs can be emptied before it is deleted.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useSearchParams } from 'react-router-dom';
import { useAllProjects } from '@/api/admin';
import { useModelIndex } from '@/api/dashboard';
import {
  PURGE_MAX,
  RESTORE_MAX,
  TRASH_PAGE,
  usePurgeRuns,
  useRestoreRuns,
  useTrash,
  useTrashProjects,
  type TrashRun,
} from '@/api/trash';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useAuth, useDocumentTitle } from '@/features/shell';
import { constrained, fullWidth } from '@/features/shell/layout';
import { modelSeriesOf } from '@/features/runs-list/model';
import {
  ActionTile,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  RunStatusBadge,
  SearchField,
  Select,
  Skeleton,
  RowMenu,
  Text,
  useToast,
  type RunStatus,
  type Column,
  Flag,
  StatusMark,
  ModelTag,
  TaskTag,
  DatasetTag,
  UserName,
} from '@/ui';
import styles from './TrashPage.module.css';
import { retentionLabel } from '@/lib/retention';
import { APP_LOCALE, formatDay } from '@/lib/dates';

const DAY = 86_400_000;

export function purgeInfo(
  row: TrashRun,
  now = Date.now(),
): { text: string; tone?: 'warning' | 'danger'; sub?: string; soon: boolean } {
  if (row.purge_paused || row.project_archived)
    return { text: 'Paused', sub: 'Purge paused while the project is archived', soon: false };
  if (!row.purge_at) return { text: 'Not scheduled', soon: false };
  const days = (Date.parse(row.purge_at) - now) / DAY;
  if (days <= 0) return { text: 'Due now', tone: 'danger', soon: true };
  if (days < 1) return { text: 'in under 1 day', tone: 'danger', soon: true };
  const n = Math.ceil(days);
  return {
    text: `in ${n} day${n === 1 ? '' : 's'}`,
    tone: n < 3 ? 'warning' : undefined,
    soon: n < 3,
    sub: formatDay(row.purge_at),
  };
}

function plural(n: number) {
  return `${n} run${n === 1 ? '' : 's'}`;
}

function fmtDate(iso: string) {
  return formatDay(iso);
}

/** A trashed run's model in its own project's model colour (rows come from many projects). */
function TrashModelCell({ slug, name, reasoning }: { slug: string; name: string; reasoning: boolean }) {
  const modelIndex = useModelIndex(slug);
  return <ModelTag name={name} reasoning={reasoning} series={modelSeriesOf(modelIndex, name, reasoning)} />;
}

export function TrashPage() {
  const { isAdmin } = useAuth();
  useDocumentTitle('Deleted runs');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const projectParam = params.get('project') || null;
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const toast = useToast();
  const restore = useRestoreRuns();
  const purge = usePurgeRuns();
  const [purgeIds, setPurgeIds] = useState<string[] | null>(null);
  const allProjects = useAllProjects();
  // ?project= takes the id; an old link may still carry the slug (C060).
  const chosen = projectParam
    ? (allProjects.data ?? []).find((p) => p.id === projectParam || p.slug === projectParam)
    : undefined;
  const projectId = chosen?.id ?? projectParam;
  const list = useTrash({ q, projectId, page }, isAdmin);
  const projects = useTrashProjects(isAdmin);
  const showSkeleton = useDelayedPending(list.isPending && isAdmin);

  function setQuery(updates: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
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

  const rows = useMemo(
    () => [...(list.data?.runs ?? [])].sort((a, b) => (a.purge_at ?? '9').localeCompare(b.purge_at ?? '9')),
    [list.data],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const restorableSelected = [...selected]
    .map(String)
    .filter((id) => byId.get(id) && !byId.get(id)!.project_archived);

  // An emptied last page steps back.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && list.data.runs.length === 0 && page > 1)
      setQuery({ page: String(page - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, list.isPlaceholderData, page]);

  async function doPurge(ids: string[]) {
    try {
      const r = await purge.mutateAsync(ids);
      setSelected(new Set());
      const reasons = [...new Set(r.skipped.map((s) => s.reason))].join('; ');
      toast.show(
        `${plural(r.purged.length)} deleted permanently${r.skipped.length ? ` · ${r.skipped.length} skipped: ${reasons}` : ''}`,
        { tone: r.purged.length ? 'success' : 'error' },
      );
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.detail || e.message : 'Delete failed');
    }
  }

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
        <EmptyState
          icon={<Icon name="shield" />}
          title="Admin access required"
          body="Only platform admins can view and restore deleted runs."
        />
      </div>
    );
  }
  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <div className={constrained}>
        <PageHeader title="Deleted runs" />
        <EmptyState
          icon={<Icon name="shield" />}
          title="Admin access required"
          body="Only platform admins can view and restore deleted runs."
        />
      </div>
    );
  }

  const total = list.data?.total ?? 0;
  const grace = list.data?.graceDays;
  const filtered = Boolean(q || projectId);
  const purgeOn = Boolean(grace);
  const selectedIds = [...selected].map(String).filter((id) => byId.has(id));
  const purgesColumn: Column<TrashRun> = {
    id: 'purges',
    priority: 1,
    header: 'Purges',
    width: 120,
    cell: (r) => {
      const p = purgeInfo(r);
      return (
        <span className={styles.stack} data-soon={p.soon ? '' : undefined}>
          {p.tone ? (
            <Flag tone={p.tone} icon="clock">
              {p.text}
            </Flag>
          ) : (
            <span>{p.text}</span>
          )}
          {p.sub ? <span className={styles.sub}>{p.sub}</span> : null}
        </span>
      );
    },
  };
  const columns: Column<TrashRun>[] = [
    {
      id: 'run',
      pin: 'start',
      hideable: false,
      priority: 1,
      header: 'Run',
      flex: true,
      minWidth: 190,
      cell: (r) => (
        <span className={styles.runCell}>
          <Text as="span" variant="md" weight={600} truncate>
            {r.run_name}
          </Text>
          <span
            className={styles.runId}
            title={`Created ${new Date(r.created_at).toLocaleString(APP_LOCALE)}`}
          >
            {r.id}
          </span>
        </span>
      ),
    },
    {
      id: 'project',
      priority: 2,
      header: 'Project',
      width: 120,
      cell: (r) => (
        <span className={styles.stack}>
          <span>{r.project_name}</span>
          {r.project_archived ? (
            <StatusMark tone="warning" shape="pause" label="Project archived" data-status="archived" />
          ) : null}
        </span>
      ),
    },
    // With retention Off nothing is ever purged, so the column would say "Not scheduled" on every row (C151).
    ...(purgeOn ? [purgesColumn] : []),
    {
      id: 'deleted',
      type: 'date',
      priority: 2,
      header: 'Deleted',
      width: 130,
      cell: (r) => (
        <span className={styles.stack}>
          <span className={styles.mono}>{fmtDate(r.deleted_at)}</span>
          {r.deleted_by_name ? <UserName id={r.deleted_by_user_id} name={r.deleted_by_name} /> : null}
        </span>
      ),
    },
    {
      id: 'status',
      type: 'status',
      priority: 1,
      header: 'Status',
      width: 110,
      cell: (r) => <RunStatusBadge status={r.status as RunStatus} />,
    },
    {
      id: 'model',
      priority: 3,
      header: 'Model',
      width: 130,
      cell: (r) =>
        r.model ? (
          <TrashModelCell slug={r.project_slug} name={r.model} reasoning={!!r.trace_stats?.has_reasoning} />
        ) : (
          '—'
        ),
    },
    { id: 'task', header: 'Task', priority: 3, width: 120, cell: (r) => <TaskTag name={r.task} /> },
    {
      id: 'dataset',
      header: 'Dataset',
      priority: 3,
      width: 120,
      cell: (r) => <DatasetTag name={r.dataset} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      type: 'actions',
      hideLabel: true,
      // one 20px handle and the cell padding, as on the runs list
      width: 44,
      pin: 'end',
      hideable: false,
      menuColumn: true,
      cell: (r) => (
        <RowMenu
          label={`Actions for ${r.run_name}`}
          items={[
            {
              id: 'restore',
              label: 'Restore',
              icon: <ActionTile icon="retry" />,
              disabled: r.project_archived || restore.isPending,
              description: r.project_archived ? 'Unarchive the project to restore this run.' : undefined,
            },
            {
              id: 'purge',
              label: 'Delete permanently',
              icon: <ActionTile tone="danger" icon="trash" />,
              tone: 'danger',
              separatorBefore: true,
            },
          ]}
          onAction={(id) => {
            if (id === 'restore') void doRestore([r.id]);
            else if (id === 'purge') setPurgeIds([r.id]);
          }}
        />
      ),
    },
  ];

  return (
    <div className={fullWidth} data-trash-page>
      <PageHeader
        title="Deleted runs"
        description={
          grace
            ? `Deleted runs are permanently removed ${grace} days after deletion, not counting time their project spends archived. Restore a run before its purge date to keep it.`
            : 'Retention is off: deleted runs are kept until an admin restores them or deletes them permanently.'
        }
        meta={[
          <span key="r">Retention {retentionLabel(grace)}</span>,
          <span key="n">
            {list.data
              ? filtered
                ? `${total} matching`
                : `${total} deleted run${total === 1 ? '' : 's'}`
              : '–'}
          </span>,
          <span key="a">Only admins can restore runs</span>,
        ]}
      />
      <div className={styles.toolbar}>
        <SearchField
          label="Search run name or ID"
          placeholder="Search run name or ID"
          value={search}
          onChange={setSearch}
          width="var(--search-width)"
          shortcut="/"
        />
        <Select
          label="Project"
          hideLabel
          placeholder="All projects"
          items={[
            { key: '', label: 'All projects' },
            ...(projects.data ?? []).map((p) => ({
              key: p.id,
              label: `${p.name}${p.archived ? ' (archived)' : ''} · ${p.deleted_runs}`,
            })),
            // The chosen project always shows, also with no deleted runs (C060); All projects clears it.
            ...(projectId && projects.data && !projects.data.some((p) => p.id === projectId)
              ? [{ key: projectId, label: chosen ? `${chosen.name} · 0` : 'Unknown project' }]
              : []),
          ]}
          value={projectId ?? ''}
          onChange={(k) => {
            setQuery({ project: k ? String(k) : null, page: null });
            setSelected(new Set());
          }}
          searchable="auto"
          width={260}
        />
        <span className={styles.grow} />
      </div>
      {showSkeleton ? (
        <Skeleton kind="table" rows={6} label="Loading deleted runs" />
      ) : list.isError ? (
        <ErrorState
          error={list.error}
          title="Couldn’t load deleted runs"
          onRetry={() => void list.refetch()}
        />
      ) : list.data && rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No deleted runs match' : 'No deleted runs'}
          body={
            filtered ? 'Try another search or project.' : 'Runs you delete appear here until they are purged.'
          }
        />
      ) : list.data ? (
        <div
          role="presentation"
          onKeyDown={(e) => {
            // Ctrl/Cmd+A on a focused row selects every run that can be restored.
            if (
              e.key.toLowerCase() === 'a' &&
              (e.ctrlKey || e.metaKey) &&
              (e.target as HTMLElement).closest('tr')
            ) {
              e.preventDefault();
              setSelected(new Set(rows.map((r) => r.id)));
            }
          }}
        >
          <DataTable<TrashRun>
            aria-label="Deleted runs"
            className={styles.table}
            storageKey="trash-v2"
            rows={rows}
            rowKey={(r) => r.id}
            selection={{
              selected,
              // Runs of an archived project can be selected for Delete permanently; Restore skips them.
              onChange: (keys) => setSelected(new Set([...keys].filter((k) => byId.has(String(k))))),
            }}
            refreshing={list.isFetching && list.isPlaceholderData}
            columns={columns}
            density="regular"
            selectOnRowClick
            bulkActions={
              <>
                <Button
                  variant="accent"
                  isDisabled={!restorableSelected.length || restorableSelected.length > RESTORE_MAX}
                  loading={restore.isPending}
                  onPress={() => void doRestore(restorableSelected)}
                  data-testid="restore-selected"
                >
                  Restore {restorableSelected.length} selected
                </Button>
                <Button
                  variant="danger"
                  isDisabled={selectedIds.length > PURGE_MAX}
                  onPress={() => setPurgeIds(selectedIds)}
                  data-testid="purge-selected"
                >
                  Delete {selectedIds.length} permanently
                </Button>
              </>
            }
            rowState={(r) => (purgeInfo(r).soon ? 'warn' : undefined)}
          >
            <DataTable.Footer
              summary={`${total} deleted run${total === 1 ? '' : 's'}`}
              pagination={{
                total,
                page,
                pageSize: TRASH_PAGE,
                noun: 'deleted runs',
                onPageChange: (p) => {
                  setQuery({ page: p <= 1 ? null : String(p) });
                  setSelected(new Set());
                },
              }}
            />
          </DataTable>
        </div>
      ) : null}
      <ConfirmDialog
        open={purgeIds !== null}
        onOpenChange={(o) => {
          if (!o) setPurgeIds(null);
        }}
        tone="danger"
        title={`Delete ${plural(purgeIds?.length ?? 0)} permanently?`}
        description="This removes the runs with their items, scores and traces. They cannot be restored."
        requireText={`delete ${plural(purgeIds?.length ?? 0)}`}
        inputLabel={`Type “delete ${plural(purgeIds?.length ?? 0)}” to confirm`}
        confirmLabel={`Delete ${plural(purgeIds?.length ?? 0)} permanently`}
        onConfirm={async () => {
          if (purgeIds) await doPurge(purgeIds);
          setPurgeIds(null);
        }}
      />
    </div>
  );
}
