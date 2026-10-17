/**
 * Round 4 runs-list mocks (design stage): static visual contracts for
 * docs/internal/ui-migration/redesign4/runs-passes.md. The desktop cases use the real DataTable with the pass rows
 * as ordinary rows of the same table (that is the design: same columns, same scroll, same frozen set); nothing here
 * reads the API. Cases: r4-collapsed, r4-expanded, r4-states, r4-frozen-scrolled, r4-select, r4-cards (390).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Button,
  DataTable,
  DatasetTag,
  HelpMarker,
  Icon,
  IconButton,
  ModelTag,
  RunStatusBadge,
  ScoreBar,
  ScoreValue,
  Select,
  Skeleton,
  Tag,
  TaskTag,
  Text,
  type Column,
} from '@/ui';
import styles from './Round4Mocks.module.css';

type Status = 'COMPLETED' | 'RUNNING' | 'FAILED';
type Metrics = {
  correct: number | null;
  quality: number | null;
  exact: number | null;
  halluc: number | null;
};

interface MockRow {
  key: string;
  kind: 'run' | 'pass' | 'queued' | 'loading' | 'error';
  name: string;
  /** Passes of a run (run rows) or the run's pass count (pass rows). */
  samples: number;
  pass?: number;
  status: Status;
  progress?: string;
  issues?: Array<{ glyph: string; count: number; tone: 'danger' | 'warning' | 'info'; text: string }>;
  date: string;
  m: Metrics;
  latency: string;
  duration: string;
  task?: string;
  model?: string;
  dataset?: string;
  queuedText?: string;
}

const run = (
  key: string,
  name: string,
  samples: number,
  m: Metrics,
  extra: Partial<MockRow> = {},
): MockRow => ({
  key,
  kind: 'run',
  name,
  samples,
  status: 'COMPLETED',
  date: 'Oct 1 · 15:00',
  m,
  latency: '2.1s',
  duration: '21h 0m',
  task: 'rag_answer',
  model: 'claude-sonnet-4',
  dataset: 'qa-arabic-v3',
  ...extra,
});

const pass = (
  parent: string,
  samples: number,
  n: number,
  m: Metrics,
  extra: Partial<MockRow> = {},
): MockRow => ({
  key: `${parent}::pass${n}`,
  kind: 'pass',
  name: parent,
  samples,
  pass: n,
  status: 'COMPLETED',
  date: `Oct 1 · 14:${String(58 + n).padStart(2, '0')}`,
  m,
  latency: `${(1.4 + n / 5).toFixed(1)}s`,
  duration: `${44 + n * 2}s`,
  ...extra,
});

const M = (correct: number, quality: number, exact: number, halluc: number): Metrics => ({
  correct,
  quality,
  exact,
  halluc,
});

const RUN_A = run('a', 'ar-eval-nightly', 10, M(0.72, 0.68, 0.41, 0.12), { task: 'sql_agent' });
const RUN_B = run('b', 'rag-answer-v7', 3, M(0.708, 0.64, 0.46, 0.09));
const RUN_C = run('c', 'baseline-gpt-5-mini', 1, M(0.55, 0.61, 0.38, 0.2), {
  model: 'gpt-5-mini',
  task: 'rag_answer',
});
const B_PASSES = [
  pass('b', 3, 1, M(0.625, 0.64, 0.5, 0.1)),
  pass('b', 3, 2, M(0.625, 0.62, 0.38, 0.12), {
    issues: [{ glyph: '!', count: 1, tone: 'danger', text: '1 task error in this pass' }],
  }),
  pass('b', 3, 3, M(0.875, 0.73, 0.5, 0.05)),
];

const dash = <span className={styles.none}>—</span>;
const metricDef = [
  ['correct', 'correct'],
  ['quality', 'quality'],
  ['exact', 'exact match'],
  ['halluc', 'hallucination'],
] as const;

function Issues({ r }: { r: MockRow }) {
  if (!r.issues?.length) return r.kind === 'run' ? dash : <span className={styles.none}>–</span>;
  return (
    <span className={styles.issues}>
      {r.issues.map((i) => (
        <span
          key={i.glyph}
          className={styles.issue}
          data-tone={i.tone}
          title={i.text}
          role="img"
          aria-label={i.text}
        >
          <span aria-hidden="true">{i.glyph}</span>
          <span className={styles.mono}>{i.count}</span>
        </span>
      ))}
    </span>
  );
}

function RunCell({ r, open, onToggle }: { r: MockRow; open: boolean; onToggle?: () => void }) {
  if (r.kind === 'run')
    return (
      <span className={styles.runName}>
        {r.samples > 1 ? (
          <IconButton
            label={`${open ? 'Collapse' : 'Expand'} ${r.samples} passes of ${r.name}`}
            icon={open ? 'chevron-down' : 'chevron-right'}
            aria-expanded={open}
            onPress={onToggle}
          />
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}
        <span className={styles.runLink}>{r.name}</span>
        {r.samples > 1 ? <Tag kind="count">×{r.samples}</Tag> : null}
      </span>
    );
  if (r.kind === 'pass')
    return (
      <span className={styles.passName}>
        <a
          href="#pass"
          className={styles.passLink}
          aria-label={`Pass ${r.pass} of ${r.samples} of run ${r.name}`}
          onClick={(e) => e.preventDefault()}
        >
          Pass {r.pass}
        </a>
        {r.progress ? <span className={styles.mutedSm}>{r.progress}</span> : null}
      </span>
    );
  return null;
}

/** The columns of the runs table, in the default order; `order` and `frozen` model the user's layout. */
function columnsFor(opts: {
  open: Set<string>;
  onToggle: (k: string) => void;
  frozen?: string;
  order?: string[];
}): Column<MockRow>[] {
  const own = (r: MockRow, node: ReactNode): ReactNode =>
    r.kind === 'pass' || r.kind === 'run' ? node : null;
  const inherit = (r: MockRow, node: ReactNode): ReactNode => (r.kind === 'run' ? node : null);
  const metricCols = metricDef.map(([id, label]): Column<MockRow> => ({
    id,
    header: label,
    label,
    type: 'score',
    group: 'Scores',
    width: 150,
    align: 'end',
    pin: opts.frozen === id ? 'start' : undefined,
    cell: (r) =>
      r.kind === 'run' || r.kind === 'pass' ? (
        <ScoreBar value={r.m[id]} type="percentage" direction="maximize" error={null} />
      ) : null,
  }));
  const base: Column<MockRow>[] = [
    {
      id: 'run',
      header: 'Run',
      group: 'Overview',
      width: 250,
      pin: 'start',
      cell: (r) => {
        if (r.kind === 'queued')
          return (
            <span className={styles.passName}>
              <span className={styles.passLink}>Pass {r.pass}</span>
              <span className={styles.mutedSm}>{r.queuedText}</span>
            </span>
          );
        return <RunCell r={r} open={opts.open.has(r.key)} onToggle={() => opts.onToggle(r.key)} />;
      },
    },
    {
      id: 'status',
      header: 'Status',
      group: 'Overview',
      width: 150,
      pin: 'start',
      cell: (r) => {
        if (r.kind === 'loading') return <span className={styles.none}>Loading passes…</span>;
        if (r.kind === 'error') return <span className={styles.errText}>Could not load passes</span>;
        if (r.kind === 'queued')
          return (
            <span className={styles.statusCell}>
              <RunStatusBadge status="PENDING" label="QUEUED" />
            </span>
          );
        return (
          <span className={styles.statusCell}>
            <RunStatusBadge status={r.status} />
          </span>
        );
      },
    },
    {
      id: 'signals',
      header: 'Signals',
      group: 'Overview',
      width: 96,
      cell: (r) => (r.kind === 'run' || r.kind === 'pass' ? <Issues r={r} /> : null),
    },
    {
      id: 'task',
      header: 'Task',
      group: 'Context',
      width: 110,
      cell: (r) => inherit(r, <TaskTag name={r.task ?? ''} />),
    },
    {
      id: 'model',
      header: 'Model',
      group: 'Context',
      width: 150,
      cell: (r) => inherit(r, <ModelTag name={r.model ?? ''} />),
    },
    {
      id: 'dataset',
      header: 'Dataset',
      group: 'Context',
      width: 150,
      cell: (r) => inherit(r, <DatasetTag name={r.dataset ?? ''} />),
    },
    {
      id: 'time',
      header: 'Date',
      group: 'Context',
      width: 130,
      cell: (r) => own(r, <span className={styles.mono}>{r.date}</span>),
    },
    {
      id: 'analysis',
      header: 'Analysis',
      group: 'Context',
      width: 110,
      cell: (r) =>
        r.kind === 'pass' && r.status !== 'RUNNING' ? (
          <span className={styles.analyze}>
            <Icon name="sparkles" size={12} /> Analyze
          </span>
        ) : r.kind === 'run' ? (
          <span className={styles.analyze}>
            <Icon name="sparkles" size={12} /> Analyze
          </span>
        ) : null,
    },
    ...metricCols,
    {
      id: 'latency',
      header: 'Avg latency',
      group: 'System',
      type: 'number',
      width: 100,
      align: 'end',
      cell: (r) => own(r, <span className={styles.mono}>{r.latency}</span>),
    },
    {
      id: 'duration',
      header: 'Duration',
      group: 'System',
      type: 'duration',
      width: 100,
      align: 'end',
      cell: (r) => own(r, <span className={styles.mono}>{r.duration}</span>),
    },
    {
      id: 'actions',
      header: 'Actions',
      hideLabel: true,
      width: 96,
      pin: 'end',
      lockOrder: true,
      cell: (r) => {
        if (r.kind === 'error')
          return (
            <Button variant="ghost" size="sm">
              Retry
            </Button>
          );
        if (r.kind === 'run')
          return (
            <span className={styles.actions}>
              <IconButton label={`Delete ${r.name}`} icon="trash" tone="danger" />
            </span>
          );
        if (r.kind === 'pass')
          return (
            <span className={styles.actions}>
              <IconButton label={`Delete pass ${r.pass} of ${r.name}`} icon="trash" tone="danger" />
            </span>
          );
        return null;
      },
    },
  ];
  if (!opts.order) return base;
  const rank = (id: string) => {
    const i = opts.order!.indexOf(id);
    return i < 0 ? 999 : i;
  };
  const locked = (c: Column<MockRow>) => c.id === 'actions';
  const free = base.filter((c) => !locked(c)).sort((a, b) => rank(a.id) - rank(b.id));
  return [...free, ...base.filter(locked)];
}

/* ─────────────── the group metrics strip: ONE full-width row under the passes ─────────────── */

function Strip({ k = 3, dim = false }: { k?: number; dim?: boolean }) {
  const stats: Array<[string, number | null, string]> = [
    [`Pass@${k}`, 0.875, 'Share of items solved by at least one of the k passes at the threshold.'],
    [`Pass^${k}`, 0.625, 'Share of items solved by every pass.'],
    [`Avg@${k}`, 0.708, `Mean score across all items and all ${k} passes.`],
    ['Consistency', 0.833, 'Agreement between passes on the same item.'],
    ['Reliability', 0.81, 'Pass^k over Pass@k.'],
  ];
  return (
    <div className={styles.strip} role="group" aria-label="Group metrics" data-dim={dim ? '' : undefined}>
      <span className={styles.stripTitle}>
        <Text variant="md" as="span">
          Passes
        </Text>
        <Text variant="sm" tone="muted" as="span">
          {k} · 8 items
        </Text>
      </span>
      <Select
        label="Metric"
        hideLabel
        items={[
          { key: 'correct', label: 'correct' },
          { key: 'quality', label: 'quality' },
        ]}
        value="correct"
        onChange={() => undefined}
        width={150}
      />
      <Button variant="neutral" size="sm">
        Pass if ≥ 80%
      </Button>
      <dl className={styles.stats}>
        {stats.map(([label, v, help]) => (
          <div key={label} className={styles.stat} title={help}>
            <dt>{label}</dt>
            <dd>
              <ScoreValue value={v} direction="maximize" digits={1} />
            </dd>
          </div>
        ))}
      </dl>
      <HelpMarker label="group metrics">
        <span>Pass@k, Pass^k, Avg@k, Consistency and Reliability, defined once.</span>
      </HelpMarker>
    </div>
  );
}

/* ───────────────────────────── desktop table mock ───────────────────────────── */

function TableMock({
  rows,
  stripOn,
  open,
  select,
  frozen,
  order,
  scrollTo,
  ariaLabel,
}: {
  rows: MockRow[];
  /** key of the row the strip hangs under (the last child of an open group). */
  stripOn?: string;
  open: Set<string>;
  select?: { selected: Set<string>; partial: Set<string> };
  frozen?: string;
  order?: string[];
  scrollTo?: number;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollTo) return undefined;
    const id = window.setTimeout(() => {
      const els = host.current?.querySelectorAll<HTMLElement>('*') ?? [];
      for (const el of els) {
        if (el.scrollWidth > el.clientWidth + 40 && getComputedStyle(el).overflowX !== 'visible') {
          el.scrollLeft = scrollTo;
          break;
        }
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [scrollTo]);
  const columns = columnsFor({ open, onToggle: () => undefined, frozen, order });
  return (
    <div ref={host} className={styles.host} data-r4="table">
      <DataTable<MockRow>
        aria-label={ariaLabel}
        density="compact"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        zebra={false}
        columnMenu={false}
        expandColumn={false}
        expanded={stripOn ? new Set([stripOn]) : new Set()}
        canExpand={(r) => r.key === stripOn}
        renderExpanded={() => <Strip />}
        rowClassName={(r) =>
          r.kind === 'run' ? (open.has(r.key) ? styles.parentOpen : undefined) : styles.child
        }
        rowProps={(r) => ({
          'data-kind': r.kind,
          'data-run-open': r.kind === 'run' && open.has(r.key) ? '' : undefined,
          'aria-level': r.kind === 'run' ? '1' : '2',
        })}
        selection={
          select
            ? {
                selected: select.selected,
                onChange: () => undefined,
                isIndeterminate: (r) => select.partial.has(r.key),
              }
            : undefined
        }
        rowLabel={(r) => (r.kind === 'pass' ? `Select pass ${r.pass} of run ${r.name}` : `Select ${r.name}`)}
        selectAllLabel="Select all runs on this page"
      />
    </div>
  );
}

const flat = (...parts: MockRow[][]): MockRow[] => parts.flat();

export const COLLAPSED_ROWS = [RUN_A, RUN_B, RUN_C];
export const EXPANDED_ROWS = flat([RUN_A], [RUN_B], B_PASSES, [RUN_C]);

const STATES_ROWS: MockRow[] = [
  RUN_B,
  pass('b', 3, 1, M(0.625, 0.64, 0.5, 0.1)),
  pass('b', 3, 2, M(0.5, 0.58, 0.25, 0.2), { status: 'RUNNING', progress: '62% · 5/8 items' }),
  {
    ...pass('b', 3, 3, M(0, 0, 0, 0)),
    kind: 'queued',
    key: 'b::queued',
    queuedText: 'waiting to start',
  },
  run('q', 'rag-answer-v8', 3, M(0.7, 0.6, 0.4, 0.1)),
  { ...pass('q', 3, 1, M(0, 0, 0, 0)), kind: 'loading', key: 'q::loading1' },
  { ...pass('q', 3, 2, M(0, 0, 0, 0)), kind: 'loading', key: 'q::loading2' },
  run('e', 'rag-answer-v9', 3, M(0.7, 0.6, 0.4, 0.1)),
  { ...pass('e', 3, 1, M(0, 0, 0, 0)), kind: 'error', key: 'e::error' },
];

/* ───────────────────────────── 390 card mock ───────────────────────────── */

function PassLine({ r, selected, selectMode }: { r: MockRow; selected?: boolean; selectMode?: boolean }) {
  return (
    <li className={styles.cardPass} aria-level={2} data-selected={selected ? '' : undefined}>
      <span className={styles.cardPassHead}>
        {selectMode ? (
          <input
            type="checkbox"
            aria-label={`Select pass ${r.pass} of run ${r.name}`}
            defaultChecked={selected}
          />
        ) : null}
        <a
          href="#pass"
          className={styles.passLink}
          aria-label={`Pass ${r.pass} of ${r.samples} of run ${r.name}`}
          onClick={(e) => e.preventDefault()}
        >
          Pass {r.pass}
        </a>
      </span>
      <RunStatusBadge status={r.status} />
      <IconButton label={`More actions for pass ${r.pass}`} icon="more" />
      <span className={styles.cardScore}>
        <span className={styles.mutedSm}>correct</span>
        <ScoreBar value={r.m.correct} type="percentage" direction="maximize" error={null} />
        {r.issues?.length ? <Issues r={r} /> : null}
      </span>
    </li>
  );
}

function CardMock({ selectMode = false }: { selectMode?: boolean }) {
  const card = (r: MockRow, open: boolean, passes?: MockRow[]) => (
    <li
      className={styles.runCard}
      data-open={open ? '' : undefined}
      aria-level={1}
      aria-expanded={r.samples > 1 ? open : undefined}
    >
      <div className={styles.cardTop}>
        {selectMode ? <input type="checkbox" aria-label={`Select ${r.name}`} /> : null}
        <RunCell r={r} open={open} />
        <RunStatusBadge status={r.status} />
      </div>
      <dl className={styles.cardFacts}>
        <dt>Model</dt>
        <dd>
          <ModelTag name={r.model ?? ''} />
        </dd>
        <dt>Date</dt>
        <dd className={styles.mono}>{r.date}</dd>
        <dt>correct</dt>
        <dd>
          <ScoreBar value={r.m.correct} type="percentage" direction="maximize" error={null} />
        </dd>
      </dl>
      {open && passes ? (
        <>
          <ul className={styles.cardPasses} role="group" aria-label={`Passes of ${r.name}`}>
            {passes.map((p, i) => (
              <PassLine key={p.key} r={p} selectMode={selectMode} selected={selectMode && i !== 1} />
            ))}
          </ul>
          <Strip />
        </>
      ) : null}
    </li>
  );
  return (
    <ul className={styles.cards} data-r4="cards" role="treegrid" aria-label="Runs">
      {card(RUN_A, false)}
      {card(RUN_B, true, B_PASSES)}
      {card(RUN_C, false)}
    </ul>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

export function Round4Mocks({
  Section,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  const none = new Set<string>();
  const openB = new Set(['b']);
  return (
    <Section id="round4" title="Round 4 runs-list mocks: passes as rows of the main table (design contract)">
      <Case wide label="r4-collapsed-1440 (default: chevron closed, run rows only)">
        <div className={styles.d1440}>
          <TableMock ariaLabel="Runs" rows={COLLAPSED_ROWS} open={none} />
        </div>
      </Case>
      <Case
        wide
        label="r4-expanded-1440 (3 passes under their run, strip under the passes; scrolled 560 px to the scores)"
      >
        <div className={styles.d1440}>
          <TableMock ariaLabel="Runs" rows={EXPANDED_ROWS} open={openB} stripOn="b::pass3" scrollTo={560} />
        </div>
      </Case>
      <Case wide label="r4-states-1440 (running, queued, loading and error children)">
        <div className={styles.d1440}>
          <TableMock
            ariaLabel="Runs"
            rows={STATES_ROWS}
            open={new Set(['b', 'q', 'e'])}
            stripOn="b::queued"
            scrollTo={560}
          />
        </div>
      </Case>
      <Case wide label="r4-frozen-scrolled-1440 (quality frozen and moved before correct, scrolled 400 px)">
        <div className={styles.d1440}>
          <TableMock
            ariaLabel="Runs"
            rows={EXPANDED_ROWS}
            open={openB}
            stripOn="b::pass3"
            frozen="quality"
            order={[
              'run',
              'status',
              'signals',
              'task',
              'model',
              'dataset',
              'time',
              'analysis',
              'quality',
              'correct',
            ]}
            scrollTo={400}
          />
        </div>
      </Case>
      <Case wide label="r4-select-1440 (select mode: passes 1 and 3 picked, the run is indeterminate)">
        <div className={styles.d1440}>
          <TableMock
            ariaLabel="Runs"
            rows={EXPANDED_ROWS}
            open={openB}
            stripOn="b::pass3"
            select={{ selected: new Set(['b::pass1', 'b::pass3']), partial: new Set(['b']) }}
            scrollTo={560}
          />
        </div>
      </Case>
      <Case label="r4-cards-390 (card mode: passes are lines inside the run card)">
        <div className={styles.m390}>
          <CardMock />
        </div>
      </Case>
      <Case label="r4-cards-select-390 (select mode in card mode)">
        <div className={styles.m390}>
          <CardMock selectMode />
        </div>
      </Case>
      <Case label="r4-loading-skeleton (children while the passes load)">
        <div className={styles.m390}>
          <Skeleton kind="lines" rows={3} label="Loading passes" />
        </div>
      </Case>
    </Section>
  );
}
