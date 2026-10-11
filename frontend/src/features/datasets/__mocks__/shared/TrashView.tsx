import { useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { Badge, Button, DataTable, Icon, PageHeader, Pagination, SearchField, Select, Tag, Text, useToast } from '@/ui';
import { NOW, trashProjects, trashRows as seed, type TrashRow } from '../fixtures';
import styles from './TrashView.module.css';

function purgeInfo(row: TrashRow): { text: string; tone?: 'warning' | 'danger'; sub?: string; soon: boolean } {
  if (row.purge_paused || row.project_archived) return { text: 'Paused', sub: 'Purge paused while the project is archived', soon: false };
  if (!row.purge_at) return { text: 'Not scheduled', soon: false };
  const days = (new Date(row.purge_at).getTime() - NOW.getTime()) / 86_400_000;
  if (days <= 0) return { text: 'Due now', tone: 'danger', soon: true };
  if (days < 1) return { text: 'in under 1 day', tone: 'danger', soon: true, sub: new Date(row.purge_at).toLocaleDateString() };
  const n = Math.ceil(days);
  return { text: `in ${n} day${n === 1 ? '' : 's'}`, tone: n < 3 ? 'warning' : undefined, soon: n < 3, sub: new Date(row.purge_at).toLocaleDateString() };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Trash page: admin-only deleted runs with select + sticky Restore column + purge countdown + project facet. URL state: ?q=&project=&page=. */
export function TrashView({ constrainedWidth }: { constrainedWidth?: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<TrashRow[]>(seed);
  const [q, setQ] = useState('');
  const [project, setProject] = useState<Key | null>(null);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => (project == null ? true : r.project_id === Number(project)))
        .filter((r) => !q || r.run_name.toLowerCase().includes(q.toLowerCase()) || r.id.startsWith(q))
        .sort((a, b) => (a.purge_at ?? '9').localeCompare(b.purge_at ?? '9')),
    [rows, project, q],
  );
  const restorable = filtered.filter((r) => !r.project_archived);
  const selectedRestorable = restorable.filter((r) => selected.has(r.id));
  const restore = (ids: string[]) => {
    const skipped = ids.filter((id) => rows.find((r) => r.id === id)?.project_archived);
    const ok = ids.filter((id) => !skipped.includes(id));
    setRows((prev) => prev.filter((r) => !ok.includes(r.id)));
    setSelected(new Set());
    toast.show(`${ok.length} run${ok.length === 1 ? '' : 's'} restored${skipped.length ? ` · ${skipped.length} skipped (project archived)` : ''}`, { tone: 'success' });
  };
  return (
    <div className={styles.wrap} style={constrainedWidth ? { maxWidth: 'var(--page-constrained-width)', margin: '0 auto', width: '100%' } : undefined}>
      <PageHeader
        title="Deleted runs"
        description="Deleted runs are permanently removed 30 days after deletion, not counting time their project spends archived. Restore a run before its purge date to keep it."
        meta={[<span key="r">Retention 30 days</span>, <span key="n">{filtered.length === rows.length ? `${rows.length} deleted runs` : `${filtered.length} matching`}</span>, <span key="a">Only admins can restore runs</span>]}
      />
      <div className={styles.toolbar}>
        <SearchField label="Search run name or ID" placeholder="Search run name or ID" value={q} onChange={setQ} width={260} />
        <Select
          label="Project"
          hideLabel
          placeholder="All projects"
          value={project}
          onChange={setProject}
          width={220}
          items={[
            { key: '', label: 'All projects' },
            ...trashProjects.map((p) => ({ key: String(p.id), label: `${p.name}${p.archived ? ' (archived)' : ''} · ${p.deleted_runs}` })),
          ]}
        />
        <span className={styles.selection} aria-live="polite">
          {selected.size ? `${selected.size} selected${selectedRestorable.length !== selected.size ? ` · ${selected.size - selectedRestorable.length} cannot be restored` : ''}` : ''}
        </span>
        <span className={styles.toolbarEnd}>
          <Button variant="accent" isDisabled={!selectedRestorable.length} icon={<Icon name="retry" size={12} />} onPress={() => restore(selectedRestorable.map((r) => r.id))}>
            Restore {selectedRestorable.length || ''} selected
          </Button>
        </span>
      </div>
      <DataTable<TrashRow>
        aria-label="Deleted runs"
        className={styles.table}
        storageKey="trash-v2"
        rows={filtered}
        rowKey={(r) => r.id}
        selection={{ selected, onChange: setSelected }}
        emptyState={<Text tone="muted">No deleted runs match.</Text>}
        columns={[
          {
            id: 'run',
            label: 'Run',
            flex: true,
            minWidth: 200,
            cell: (r) => (
              <span className={styles.runCell} title={`Created ${fmtDate(r.deleted_at)}`}>
                <span className={styles.runName}>{r.run_name}</span>
                <span className={styles.runId}>{r.id}</span>
              </span>
            ),
          },
          {
            id: 'project',
            label: 'Project',
            width: 150,
            cell: (r) => (
              <span className={styles.two}>
                <span>{r.project_name}</span>
                {r.project_archived ? <Tag tone="warning">Project archived</Tag> : null}
              </span>
            ),
          },
          {
            id: 'purge',
            label: 'Purges',
            width: 150,
            cell: (r) => {
              const p = purgeInfo(r);
              return (
                <span className={styles.two}>
                  <span className={styles.purge} data-tone={p.tone}>
                    {p.tone ? <Icon name="warning" size={12} /> : null}
                    {p.text}
                  </span>
                  {p.sub ? <span className={styles.purgeSub}>{p.sub}</span> : null}
                </span>
              );
            },
          },
          {
            id: 'deleted',
            label: 'Deleted',
            width: 140,
            cell: (r) => (
              <span className={styles.two}>
                <span>{fmtDate(r.deleted_at)}</span>
                <span className={styles.sub}>by {r.deleted_by_name}</span>
              </span>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            width: 100,
            cell: (r) => <Badge tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status}</Badge>,
          },
          { id: 'model', label: 'Model', width: 140, cell: (r) => `${r.model}${r.has_reasoning ? ' · reasoning' : ''}` },
          { id: 'task', label: 'Task', width: 120, cell: (r) => r.task },
          { id: 'dataset', label: 'Dataset', width: 120, cell: (r) => r.dataset },
          {
            id: 'restore',
            label: 'Restore',
            hideLabel: true,
            width: 92,
            resizable: false,
            cell: (r) => (
              <Button size="sm" isDisabled={r.project_archived} onPress={() => restore([r.id])}>
                Restore
              </Button>
            ),
          },
        ]}
      />
      <Pagination total={filtered.length} page={page} pageSize={50} noun="runs" onPageChange={setPage} />
    </div>
  );
}
