import { useMemo, useState } from 'react';
import { Badge, DataTable, type Column, type Key, type SortState } from '@/ui';
import type { FeedbackList, FeedbackRow } from '@/api/feedback';
import { ComplexityTag, PriorityBadge, StatusBadge } from './badges';
import { shortDate } from './format';
import { RequestLink } from './RequestLink';
import styles from './feedback.module.css';

const keep = () => 0; // the server sorts; the table only draws the arrow

function TitleCell({ r }: { r: FeedbackRow }) {
  return (
    <span className={styles.titleCell} data-dup-of={r.duplicate_of ?? undefined}>
      <span className={styles.titleLine}>
        <RequestLink id={r.ref} />
        <span className={styles.titleText}>{r.title}</span>
      </span>
      {r.duplicate_of ? (
        <span className={styles.dupNote} data-testid="dup-note">
          <Badge tone="warning">Duplicate</Badge> of <RequestLink id={r.duplicate_of} small />
        </span>
      ) : r.possible_duplicate_of ? (
        <span className={styles.dupNote} data-testid="possible-dup-note">
          Possible duplicate of <RequestLink id={r.possible_duplicate_of} small />
        </span>
      ) : null}
    </span>
  );
}

const PLACEHOLDER = (id: number): FeedbackRow => ({
  id: `__sk-${id}`,
  ref: '',
  number: null,
  title: '',
  summary: '',
  subject: 'platform',
  project: null,
  priority: null,
  complexity: null,
  status: 'new',
  submitter: { id: '', name: '' },
  created_at: null,
  confirmed_at: null,
  duplicate_of: null,
  possible_duplicate_of: null,
});

function columns(skeleton: boolean): Column<FeedbackRow>[] {
  const bone = (w: number) => <span className={styles.bone} style={{ inlineSize: `${w}%` }} aria-hidden="true" />;
  return [
    {
      id: 'title',
      header: 'Request',
      flex: true,
      minWidth: 200,
      pin: 'start',
      hideable: false,
      priority: 1,
      cardTitle: true,
      cell: (r) => (skeleton ? bone(70) : <TitleCell r={r} />),
    },
    {
      id: 'about',
      header: 'About',
      width: 130,
      priority: 2,
      cell: (r) =>
        skeleton ? (
          bone(60)
        ) : (
          <span className={styles.about}>
            <span>{r.subject === 'platform' ? 'qym itself' : 'A product'}</span>
            <span className={styles.aboutSub}>{r.subject === 'platform' ? 'Platform' : r.project?.name}</span>
          </span>
        ),
    },
    {
      id: 'priority',
      header: 'Priority',
      width: 84,
      priority: 2,
      sort: { key: 'priority', first: 'desc', compare: keep },
      cell: (r) => (skeleton ? bone(60) : <PriorityBadge value={r.priority} />),
    },
    {
      id: 'complexity',
      header: 'Complexity',
      width: 96,
      priority: 2,
      sort: { key: 'complexity', first: 'desc', compare: keep },
      cell: (r) => (skeleton ? bone(40) : <ComplexityTag value={r.complexity} />),
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 96,
      priority: 1,
      sort: { key: 'status', first: 'asc', compare: keep },
      cell: (r) => (skeleton ? bone(60) : <StatusBadge status={r.status} />),
    },
    {
      id: 'created',
      header: 'Submitted',
      width: 130,
      priority: 2,
      sort: { key: 'created_at', first: 'desc', compare: keep },
      cell: (r) =>
        skeleton ? (
          bone(60)
        ) : (
          <span className={styles.about}>
            <span>{r.submitter.name}</span>
            <span className={styles.aboutSub}>{shortDate(r.created_at)}</span>
          </span>
        ),
    },
  ];
}

export interface RequestsTableProps {
  data: FeedbackList | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  sort: SortState;
  onSortChange: (s: SortState | null) => void;
  toolbar: React.ReactNode;
  footer: React.ReactNode;
  filtered: boolean;
  /** Rows the last loaded page had: the loading frame draws as many. */
  lastCount: number;
}

/** The requests table: a confirmed duplicate is a child row of its canonical request, open by default (QE-13). */
export function RequestsTable(p: RequestsTableProps) {
  const rows = p.data?.items ?? [];
  const children = useMemo(() => p.data?.children ?? {}, [p.data]);
  const canonical = useMemo(() => new Set(Object.keys(children)), [children]);
  const [collapsed, setCollapsed] = useState<Set<Key>>(new Set());
  const expanded = useMemo(() => new Set<Key>([...canonical].filter((id) => !collapsed.has(id))), [canonical, collapsed]);
  const skeleton = p.loading && !p.data;
  const shown = skeleton ? Array.from({ length: Math.max(1, p.lastCount) }, (_, i) => PLACEHOLDER(i)) : rows;
  const cols = useMemo(() => columns(skeleton), [skeleton]);
  return (
    <DataTable<FeedbackRow>
      aria-label="Feedback requests"
      density="comfortable"
      densityLocked
      columns={cols}
      rows={shown}
      rowKey={(r) => r.id}
      sort={p.sort}
      onSortChange={p.onSortChange}
      allowUnsorted={false}
      rowHref={(r) => (skeleton ? undefined : `/feedback/${r.ref}`)}
      rowProps={(r) => ({ 'data-request': r.ref || undefined })}
      expanded={expanded}
      onExpandedChange={(keys) => setCollapsed(new Set([...canonical].filter((id) => !keys.has(id))))}
      canExpand={(r) => canonical.has(r.id)}
      childRows={(r) => {
        const kids = children[r.id];
        return kids?.length ? { rows: kids, detail: false } : undefined;
      }}
      childLabel={(r, parent) => `${r.ref}, duplicate of ${parent.ref}`}
      childGroupLabel={(r) => `Duplicates of ${r.ref}`}
      renderExpanded={() => null}
      error={p.error && !p.data ? p.error : undefined}
      onRetry={p.onRetry}
      errorTitle="Couldn’t load feedback"
      empty="No requests match."
      isFiltered={p.filtered}
      storageKey="feedback-requests"
    >
      {p.toolbar}
      {p.footer}
    </DataTable>
  );
}
