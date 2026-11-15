/**
 * The item pane of the run page on the compare page. The same frame and blocks: Input, then
 * Expected beside one Output per run, then the metrics as a matrix (a row per metric, a column per run: score, change
 * against the baseline, reason and what the scorer recorded), then execution facts, item metadata and root causes.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { formatLatency, getRowScore, isInternalMetaKey } from '@/lib/metrics';
import { useDelayedPending } from '@/lib/pending';
import { keyWithBreaks } from '@/lib/keyBreaks';
import { textDirAttrs } from '@/lib/text';
import {
  Button,
  DataTable,
  ErrorState,
  Flag,
  Icon,
  ScoreValue,
  SegmentedControl,
  StateTag,
  Tag,
  TextBlock,
  ToggleChips,
  type Column,
} from '@/ui';
import { Act, CopyAct } from '@/features/run-detail/components/items/pane/actions';
import { Block, PaneSection } from '@/features/run-detail/components/items/pane/blocks';
import {
  LinkAct,
  PaneShell,
  PaneSkeleton,
  type PanePeek,
} from '@/features/run-detail/components/items/pane/Frame';
import { ScoreHint, useDetailsOpen } from '@/features/run-detail/components/items/pane/metrics';
import {
  extraMeta,
  passIfText,
  promptLine,
  reasonOf,
} from '@/features/run-detail/components/items/pane/model';
import {
  FieldList,
  JsonToggle,
  Value,
  detailIsCompact,
  isStructuredValue,
  useDiffMarks,
} from '@/features/run-detail/components/items/pane/values';
import p from '@/features/run-detail/components/items/pane/pane.module.css';
import { bodyText, formatCompact } from '@/features/run-detail/lib/itemText';
import { HIDDEN_METADATA_KEYS } from '@/features/run-detail/lib/rowMeta';
import type { Row } from '@/features/run-detail/types';
import { runColor, useCompare } from '../../../CompareContext';
import { useDetailsStore, useEnsureBodies, useResolvedRows } from '../../../hooks/useDetails';
import { useRowPatch } from '../../../hooks/useRowPatch';
import { chipDelta, deltaKind } from '../../../lib/baseline';
import { visibleWhenOnlyDiffering, type FilteredItem } from '../../../lib/filters';
import { runShortName } from '../../../lib/labels';
import type { CompareRun } from '../../../lib/model';
import {
  metricCellFor,
  pillState,
  runReadOnly,
  runScoresLocked,
  type MetricCellView,
  type PillState,
} from '../../../lib/rowCells';
import { metricCtx, verdictOf } from '../../../lib/scoring';
import { CompareScoreEditor } from '../../rd/CompareScoreEditor';
import { RunTag } from '../../RunTag';
import { useItemsUi } from '../ItemsUi';
import { Issues } from './Issues';
import s from './comparePane.module.css';

/** Up to this many runs stand side by side as columns; more runs are rows. */
const MAX_COLUMNS = 4;

interface Col {
  i: number;
  run: CompareRun;
  row: Row;
  state: PillState;
}

const STATE_LABEL: Record<PillState, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Task error',
  none: 'No score',
};

function outputOf(row: Row): unknown {
  if (String(row.status) === 'error' || row.error || row.output_received === false) return undefined;
  return row.output_full ?? row.output ?? undefined;
}

/** The run a column stands for: its colour and letter, its name as a link to the item in that run. */
function RunName({ col }: { col: Col }) {
  const slug = col.run.run.project?.slug;
  const name = runShortName(col.run);
  return (
    <span className={s.runName}>
      <RunTag index={col.i} showName={false} bare />
      {slug ? (
        <Link
          className={s.runLink}
          data-link="name"
          to={`${runPath(slug, col.run.base)}?item=${encodeURIComponent(col.row.item_id)}${col.run.pass ? `&pass=${col.run.pass}` : ''}`}
          title={`${col.run.title}. Open this item in the run`}
        >
          {name}
        </Link>
      ) : (
        <span className={s.runLink} title={col.run.title}>
          {name}
        </span>
      )}
    </span>
  );
}

/** The platform's baseline mark (the blue star Flag of `RunTag`): the run the others are read against. */
const BaselineTag = () => (
  <Flag tone="info" icon="star" data-part="baseline-tag" title="The run the others are read against">
    Baseline
  </Flag>
);

/* ---------- the output of one run ---------- */

function RunOutput({ col, against, isBase }: { col: Col; against: unknown; isBase: boolean }) {
  const ui = useItemsUi();
  const [raw, setRaw] = useState(false);
  const { row, run } = col;
  const failed = col.state === 'error' || String(row.status) === 'error' || !!row.error;
  const value = outputOf(row);
  const errorText = String(row.error || row.__execution_error || 'The task failed');
  const retries = Number(row.retry_count ?? 0);
  return (
    <Block
      title={<RunName col={col} />}
      tone={col.state === 'pass' ? 'success' : col.state === 'none' ? 'neutral' : 'danger'}
      part="output"
      fill
      label={`Output of ${run.label}`}
      after={
        <>
          {col.state === 'none' ? null : (
            <StateTag tone={col.state === 'pass' ? 'success' : 'danger'}>{STATE_LABEL[col.state]}</StateTag>
          )}
          {row.latency_ms != null ? (
            <span className={p.metaNum}>{row.latency_ms === 0 ? '0ms' : formatLatency(row.latency_ms)}</span>
          ) : null}
          {isBase ? <BaselineTag /> : null}
        </>
      }
      actions={
        <>
          <Act
            label={`Open the trace of ${run.label}`}
            icon="trace"
            isDisabled={!row.trace_id}
            disabledReason="No trace was recorded for this item"
            onPress={() => ui.openTrace({ runId: run.base, itemId: row.item_id, pass: run.pass })}
          />
          {value !== undefined && isStructuredValue(value) ? (
            <JsonToggle raw={raw} onChange={setRaw} />
          ) : null}
          <CopyAct text={failed ? errorText : bodyText(value)} label={`Copy the output of ${run.label}`} />
        </>
      }
    >
      {row.output_received === false ? (
        <p className={p.note}>Output not received: the outcome of this item never reached the platform</p>
      ) : run.run.items_restricted ? (
        <p className={p.note}>The item texts of this run are hidden</p>
      ) : failed ? (
        <div className={p.taskError} role="note">
          <p className={p.taskErrorLead}>
            <Icon name="warning" size={12} />
            The task failed before it gave an output
            {retries > 0 ? ` (${retries} ${retries === 1 ? 'retry' : 'retries'})` : ''}
          </p>
          <TextBlock text={errorText} code dir="ltr" className={p.errorText} />
        </div>
      ) : (
        <Value value={value} label={`Output of ${run.label}`} other={against} side="after" raw={raw} />
      )}
    </Block>
  );
}

/* ---------- metrics ---------- */

interface Cell {
  col: Col;
  /** Null when the run did not score the metric. */
  cell: MetricCellView | null;
  verdict: boolean | null;
  meta: Record<string, unknown>;
  details: Record<string, unknown>;
  delta: number | null;
  taskError: boolean;
  canEdit: boolean;
}

interface MetricLine {
  metric: string;
  cells: Cell[];
  passIf: string;
  hasDetails: boolean;
  compact: boolean;
}

/** Every metric of the item with one cell per run: score, verdict, change against the baseline, reason and details. */
function useMetricLines(cols: Col[], baseIdx: number): MetricLine[] {
  const { model, c, metric: pageMetric } = useCompare();
  const ui = useItemsUi();
  const base = cols.find((x) => x.i === baseIdx) ?? null;
  const names = [...model.metrics].sort((a, b) => Number(b === pageMetric) - Number(a === pageMetric));
  return names.map((metric) => {
    const ctx = metricCtx(model, metric, c.thresholds);
    const spec = model.specs[metric];
    const type = model.types[metric] ?? 'score';
    const hasThreshold = spec ? spec.pass_threshold != null : type === 'score';
    const judged = hasThreshold || (ctx.isBoolean && !!ctx.direction);
    const baseCell =
      base && base.run.metricIndex[metric] !== undefined
        ? metricCellFor(model, base.run, base.row, metric)
        : null;
    const cells = cols.map((col): Cell => {
      const idx = col.run.metricIndex[metric];
      const cell = idx === undefined ? null : metricCellFor(model, col.run, col.row, metric);
      const scored = !!cell && (cell.value !== null || !!cell.error);
      const verdict =
        scored && judged && cell.value !== null && !cell.error
          ? (verdictOf(getRowScore(col.row, idx!, metric, ctx.direction), ctx) ?? null)
          : null;
      const meta = (col.row.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
      const details = Object.fromEntries(
        Object.entries(extraMeta(meta)).filter(
          ([k, v]) =>
            !isInternalMetaKey(k) && !ui.hiddenFields.has(k) && v !== null && v !== undefined && v !== '',
        ),
      );
      const delta =
        col.i !== baseIdx &&
        baseCell &&
        baseCell.value !== null &&
        !baseCell.error &&
        cell &&
        cell.value !== null &&
        !cell.error
          ? cell.value - baseCell.value
          : null;
      return {
        col,
        cell: scored ? cell : null,
        verdict,
        meta,
        details,
        delta,
        taskError: col.state === 'error',
        canEdit:
          !runReadOnly(col.run) &&
          !runScoresLocked(col.run) &&
          !col.run.run.items_restricted &&
          String(col.row.status) !== 'not_received',
      };
    });
    return {
      metric,
      cells,
      passIf: hasThreshold ? passIfText(type, ctx.threshold, ctx.direction) : '',
      hasDetails: cells.some((x) => Object.keys(x.details).length > 0 && !x.taskError),
      // short facts only: the tiles of the runs stand side by side at any width
      compact: cells.every((x) => detailIsCompact(x.details)),
    };
  });
}

/** The score of one run on one metric, with its change against the baseline. */
function ScoreLine({ metric, x }: { metric: string; x: Cell }) {
  const { cell, verdict, delta, meta } = x;
  if (!cell) return <span className={s.notScored}>not scored</span>;
  return (
    <>
      <ScoreValue
        variant="plain"
        value={cell.value}
        type={cell.type}
        direction={cell.direction}
        error={cell.error}
        text={cell.text}
        verdict={verdict === null ? null : verdict ? 'pass' : 'fail'}
        className={p.score}
      />
      {delta !== null && !(cell.type === 'boolean' && Math.abs(delta) < 1e-9) ? (
        <span
          className={s.delta}
          data-move={deltaKind(delta, cell.direction)}
          title={`Change against the baseline on ${metric}`}
        >
          {chipDelta(delta, cell.type)}
        </span>
      ) : null}
      {cell.edited ? (
        <Tag
          kind="accent"
          tone="warning"
          title={`Edited${meta.original_score !== undefined ? `. The scorer value was ${String(meta.original_score)}` : ''}`}
        >
          edited
        </Tag>
      ) : null}
    </>
  );
}

function useScoreEdit() {
  const { model } = useCompare();
  const patch = useRowPatch();
  const [editing, setEditing] = useState<string | null>(null);
  const keyOf = (metric: string, x: Cell) => `${metric}|${x.col.run.ref}`;
  return {
    isEditing: (metric: string, x: Cell) => editing === keyOf(metric, x),
    button: (metric: string, x: Cell) =>
      x.cell && x.canEdit ? (
        <Act
          tile
          label={`Edit the ${metric} score of ${x.col.run.label}`}
          icon="edit"
          active={editing === keyOf(metric, x)}
          onPress={() => setEditing(editing === keyOf(metric, x) ? null : keyOf(metric, x))}
        />
      ) : null,
    form: (metric: string, x: Cell) =>
      x.cell ? (
        <div className={s.edit}>
          <CompareScoreEditor
            runId={x.col.run.base}
            filePath={x.col.run.base}
            row={x.col.row}
            metric={metric}
            spec={model.specs[metric]}
            initial={
              x.cell.value === null
                ? ''
                : x.cell.type === 'score'
                  ? `${Math.round(x.cell.value * 1000) / 10}%`
                  : String(x.cell.value)
            }
            passNumber={x.col.run.pass}
            passVersion={Number(x.col.run.run.metadata?.pass_revision ?? 0)}
            edited={x.cell.edited}
            onDone={(updated) => {
              setEditing(null);
              patch(x.col.run.base, updated);
            }}
          />
          <ScoreHint spec={model.specs[metric]} />
        </div>
      ) : null,
  };
}

function Reason({ x }: { x: Cell }) {
  if (x.taskError || !x.cell) return null;
  const text = reasonOf(x.meta);
  return (
    <p
      className={p.reason}
      data-strong={x.verdict === false ? '' : undefined}
      data-empty={text ? undefined : ''}
      {...textDirAttrs(text)}
    >
      {text || (x.cell.error ? 'The scorer failed on this metric' : 'No reason was recorded')}
    </p>
  );
}

function MetricName({ metric, passIf }: { metric: string; passIf: string }) {
  const { metric: pageMetric } = useCompare();
  return (
    <>
      <span
        className={p.metricName}
        data-page={metric === pageMetric ? '' : undefined}
        title={metric === pageMetric ? 'The page metric: it decides Pass or Fail' : undefined}
      >
        {keyWithBreaks(metric)}
      </span>
      {passIf ? <span className={s.passIf}>Pass if {passIf}</span> : null}
    </>
  );
}

function useDetailToggles(keys: string[]) {
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  const [own, setOwn] = useState<Record<string, boolean>>({});
  const isOpen = (key: string) => own[key] ?? detailsOpen;
  const allOpen = keys.length > 0 && keys.every(isOpen);
  return {
    isOpen,
    allButton: (what: string) =>
      keys.length ? (
        <Act
          label={allOpen ? `Hide the details of every ${what}` : `Show the details of every ${what}`}
          icon={allOpen ? 'chevron-down' : 'chevron-right'}
          aria-expanded={allOpen}
          onPress={() => {
            setDetailsOpen(!allOpen);
            setOwn({});
          }}
        />
      ) : null,
    button: (key: string, name: string) => (
      <Act
        label={`${isOpen(key) ? 'Hide' : 'Show'} the details of ${name}`}
        icon={isOpen(key) ? 'chevron-down' : 'chevron-right'}
        aria-expanded={isOpen(key)}
        onPress={() => setOwn((cur) => ({ ...cur, [key]: !isOpen(key) }))}
      />
    ),
  };
}

/** Up to four runs: a row per metric, a column per run. */
function MetricsByMetric({ lines, cols, baseIdx }: { lines: MetricLine[]; cols: Col[]; baseIdx: number }) {
  const edit = useScoreEdit();
  const toggles = useDetailToggles(lines.filter((l) => l.hasDetails).map((l) => l.metric));
  return (
    <div
      className={s.matrix}
      role="table"
      aria-label="Metrics of each run"
      style={{ ['--runs' as string]: cols.length }}
    >
      <div className={s.mhead} role="row">
        <span role="columnheader" className={s.lead}>
          {toggles.allButton('metric')}
        </span>
        <span role="columnheader" className={s.colTitle}>
          Metric
        </span>
        {cols.map((col) => (
          <span key={col.run.ref} role="columnheader" className={s.runHead}>
            <RunName col={col} />
            {col.i === baseIdx ? <BaselineTag /> : null}
          </span>
        ))}
      </div>
      {lines.map(({ metric, cells, passIf, hasDetails, compact }) => {
        const open = hasDetails && toggles.isOpen(metric);
        return (
          <div key={metric} className={s.mrow} role="row">
            <span role="cell" className={s.lead}>
              {hasDetails ? toggles.button(metric, metric) : null}
            </span>
            <span role="rowheader" className={s.nameCell}>
              <MetricName metric={metric} passIf={passIf} />
            </span>
            {cells.map((x) => (
              <div
                key={x.col.run.ref}
                role="cell"
                className={s.cell}
                data-failing={x.verdict === false ? '' : undefined}
                data-editing={edit.isEditing(metric, x) ? '' : undefined}
                style={{ '--run': runColor(x.col.i) } as CSSProperties}
              >
                <div className={s.cellTop}>
                  <span className={s.cellRun}>
                    <RunTag index={x.col.i} showName={false} bare />
                  </span>
                  <ScoreLine metric={metric} x={x} />
                  <span className={s.cellAct}>{edit.button(metric, x)}</span>
                </div>
                {edit.isEditing(metric, x) ? edit.form(metric, x) : <Reason x={x} />}
              </div>
            ))}
            {open ? (
              // what the scorer recorded, a tile per run: side by side while two tiles fit, else one under the other
              <div
                role="cell"
                className={s.details}
                data-part="metric-details"
                data-compact={compact ? '' : undefined}
              >
                {cells.map((x) =>
                  x.taskError || !Object.keys(x.details).length ? null : (
                    <div key={x.col.run.ref} className={s.detail}>
                      <RunName col={x.col} />
                      <FieldList data={x.details} label={`Details of ${metric}, ${x.col.run.label}`} detail />
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Five runs or more: a row per run, a column per metric (scores only, so ten runs read as one table). A run opens to
 * its reasons and to what the scorer recorded, metric by metric.
 */
function MetricsByRun({ lines, cols, baseIdx }: { lines: MetricLine[]; cols: Col[]; baseIdx: number }) {
  const edit = useScoreEdit();
  const toggles = useDetailToggles(cols.map((c) => c.run.ref));
  return (
    <div
      className={s.byRun}
      role="table"
      aria-label="Metrics of each run"
      style={{ ['--metrics' as string]: lines.length }}
    >
      <div className={s.brHead} role="row">
        <span role="columnheader" className={s.lead}>
          {toggles.allButton('run')}
        </span>
        <span role="columnheader" className={s.colTitle}>
          Run
        </span>
        {lines.map((l) => (
          <span key={l.metric} role="columnheader" className={s.brMetric}>
            <MetricName metric={l.metric} passIf={l.passIf} />
          </span>
        ))}
      </div>
      {cols.map((col, n) => {
        const open = toggles.isOpen(col.run.ref);
        return (
          <div key={col.run.ref} className={s.brRow} role="row" data-open={open ? '' : undefined}>
            <span role="cell" className={s.lead}>
              {toggles.button(col.run.ref, col.run.label)}
            </span>
            <span role="rowheader" className={s.brRun}>
              <RunName col={col} />
              {col.i === baseIdx ? <BaselineTag /> : null}
            </span>
            {lines.map((l) => {
              const x = l.cells[n]!;
              return (
                <span
                  key={l.metric}
                  role="cell"
                  className={s.brCell}
                  data-failing={x.verdict === false ? '' : undefined}
                >
                  {x.taskError ? (
                    <span className={s.notScored}>task error</span>
                  ) : (
                    <ScoreLine metric={l.metric} x={x} />
                  )}
                </span>
              );
            })}
            {open ? (
              <div role="cell" className={s.brDetail} data-part="metric-details">
                {col.state === 'error' ? (
                  <p className={p.note}>The task failed on this item, so this run has no scores here.</p>
                ) : (
                  lines.map((l) => {
                    const x = l.cells[n]!;
                    return (
                      <div
                        key={l.metric}
                        className={s.brLine}
                        data-editing={edit.isEditing(l.metric, x) ? '' : undefined}
                      >
                        <span className={s.brLineName}>
                          <span className={p.metricName}>{keyWithBreaks(l.metric)}</span>
                        </span>
                        <span className={s.brLineScore}>
                          <ScoreLine metric={l.metric} x={x} />
                        </span>
                        <div className={s.brLineBody}>
                          {edit.isEditing(l.metric, x) ? edit.form(l.metric, x) : <Reason x={x} />}
                          {Object.keys(x.details).length ? (
                            <FieldList
                              data={x.details}
                              label={`Details of ${l.metric}, ${col.run.label}`}
                              detail
                            />
                          ) : null}
                        </div>
                        <span className={s.act}>{edit.button(l.metric, x)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Metrics({ cols, baseIdx }: { cols: Col[]; baseIdx: number }) {
  const lines = useMetricLines(cols, baseIdx);
  const failed = lines.filter((l) => l.cells.some((x) => x.verdict === false)).length;
  return (
    <PaneSection
      title="Metrics"
      part="metrics-section"
      // a problem count is a count tag in its tone (§3.3)
      description={
        failed ? (
          <Tag kind="count" tone="danger" data-count="failed">
            {failed} failed
          </Tag>
        ) : null
      }
    >
      <section className={p.block} data-tone="neutral" data-part="metrics" aria-label="Metrics">
        {cols.length > MAX_COLUMNS ? (
          <MetricsByRun lines={lines} cols={cols} baseIdx={baseIdx} />
        ) : (
          <MetricsByMetric lines={lines} cols={cols} baseIdx={baseIdx} />
        )}
      </section>
    </PaneSection>
  );
}

/* ---------- execution facts ---------- */

interface Stat {
  label: string;
  /** Lower is better (a change is good or bad); null when a change is neither. */
  lowerBetter: boolean | null;
  value: (row: Row) => number | null;
  text: (n: number) => string;
}

const ts = (row: Row) => (row.trace_stats ?? {}) as Record<string, unknown>;
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const STATS: Stat[] = [
  {
    label: 'Latency',
    lowerBetter: true,
    value: (r) => num(r.latency_ms),
    text: (n) => (n === 0 ? '0ms' : formatLatency(n)),
  },
  { label: 'Tokens', lowerBetter: true, value: (r) => num(ts(r).tokens), text: (n) => formatCompact(n) },
  {
    label: 'Cost',
    lowerBetter: true,
    value: (r) => (Number(ts(r).cost) > 0 ? Number(ts(r).cost) : null),
    text: (n) => '$' + n.toFixed(3),
  },
  { label: 'LLM calls', lowerBetter: null, value: (r) => num(ts(r).llm_calls) || null, text: String },
  { label: 'Tool calls', lowerBetter: null, value: (r) => num(ts(r).tool_calls) || null, text: String },
  {
    label: 'Tool errors',
    lowerBetter: true,
    value: (r) =>
      num(ts(r).tool_calls) ? Number(ts(r).tool_errors || ts(r).malformed_tool_calls || 0) : null,
    text: String,
  },
  { label: 'Retries', lowerBetter: true, value: (r) => num(r.retry_count) || null, text: String },
];

/** A value of one run with its change against the baseline: the arrow and the sign say the direction, the colour says good or bad. */
function StatValue({
  stat,
  value,
  base,
}: {
  stat: Stat;
  value: number | null;
  base: number | null | undefined;
}) {
  if (value === null) return <span className={s.notScored}>—</span>;
  let change: ReactNode = null;
  if (base !== undefined && base !== null) {
    const diff = value - base;
    const rel = base !== 0 ? diff / base : null;
    const same = Math.abs(diff) < 1e-9 || (rel !== null && Math.abs(rel) < 0.005);
    const text = same
      ? '≈ same'
      : `${diff > 0 ? '▲ +' : '▼ −'}${rel !== null ? `${Math.round(Math.abs(rel) * 100)}%` : stat.text(Math.abs(diff))}`;
    const move =
      same || stat.lowerBetter === null ? 'same' : diff < 0 === stat.lowerBetter ? 'improved' : 'regressed';
    change = (
      <span className={s.delta} data-move={move} title={`${stat.label} against the baseline`}>
        {text}
      </span>
    );
  }
  return (
    <span className={s.statValue}>
      <span className={s.statNum} data-bad={stat.label === 'Tool errors' && value > 0 ? '' : undefined}>
        {stat.text(value)}
      </span>
      {change}
    </span>
  );
}

interface FactRow {
  key: string;
  stat?: Stat;
  col?: Col;
}

/**
 * The execution facts of each run against the baseline, in the platform table (`DataTable`): up to four runs a row
 * per fact and a column per run, five runs or more a row per run and a column per fact. Numbers are centred.
 */
function Execution({ cols, baseIdx }: { cols: Col[]; baseIdx: number }) {
  const stats = STATS.filter((st) => cols.some((c) => st.value(c.row) !== null));
  if (!stats.length) return null;
  const base = cols.find((c) => c.i === baseIdx) ?? null;
  const baseOf = (st: Stat, col: Col) => (base && col.i !== baseIdx ? st.value(base.row) : undefined);
  const byRun = cols.length > MAX_COLUMNS;
  const runHead = (col: Col) => (
    <span className={s.runHead}>
      <RunName col={col} />
      {col.i === baseIdx ? <BaselineTag /> : null}
    </span>
  );
  const columns: Column<FactRow>[] = byRun
    ? [
        {
          id: 'run',
          header: 'Run',
          flex: true,
          minWidth: 220,
          wrap: true,
          resizable: false,
          cell: (r) => runHead(r.col!),
        },
        ...stats.map((st): Column<FactRow> => ({
          id: st.label,
          header: st.label,
          align: 'center',
          width: 132,
          resizable: false,
          cell: (r) => <StatValue stat={st} value={st.value(r.col!.row)} base={baseOf(st, r.col!)} />,
        })),
      ]
    : [
        {
          id: 'fact',
          header: 'Fact',
          width: 168,
          resizable: false,
          cell: (r) => <span className={s.factName}>{r.stat!.label}</span>,
        },
        ...cols.map((col): Column<FactRow> => ({
          id: col.run.ref,
          header: runHead(col),
          label: col.run.label,
          align: 'center',
          flex: true,
          minWidth: 160,
          resizable: false,
          cell: (r) => (
            <StatValue stat={r.stat!} value={r.stat!.value(col.row)} base={baseOf(r.stat!, col)} />
          ),
        })),
      ];
  const rows: FactRow[] = byRun
    ? cols.map((col) => ({ key: col.run.ref, col }))
    : stats.map((stat) => ({ key: stat.label, stat }));
  return (
    <PaneSection title="Execution" part="execution">
      <div className={s.facts} data-by-run={byRun ? '' : undefined}>
        <DataTable<FactRow>
          aria-label="Execution of each run"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          density="regular"
          densityLocked
          columnMenu={false}
          stripe="report"
          stickyHeader={false}
          responsive="scroll"
        />
      </div>
    </PaneSection>
  );
}

/* ---------- the pane ---------- */

/** Input or Expected: one text of the item, shared by every run. */
function TextPart({
  title,
  tone,
  part,
  value,
  copyLabel,
  fill,
}: {
  title: string;
  tone: 'info' | 'gold';
  part: string;
  value: unknown;
  copyLabel: string;
  fill?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  return (
    <Block
      title={title}
      tone={tone}
      part={part}
      fill={fill}
      actions={
        <>
          {isStructuredValue(value) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
          <CopyAct text={bodyText(value)} label={copyLabel} />
        </>
      }
    >
      <Value value={value} label={title} raw={raw} />
    </Block>
  );
}

type Against = 'expected' | 'baseline';

/**
 * `ident` stands after the item id in the header (the Sweep gives the passes of each cohort side). With `list` the
 * pane steps through that list (the Sweep table, as filtered and sorted) and its owner turns its own pages; without
 * it the pane steps through the compare page's item list and turns that list's page.
 */
export function ComparePane({
  item,
  at,
  pageSize,
  ident,
  list,
}: {
  item: FilteredItem;
  at: number;
  pageSize: number;
  ident?: ReactNode;
  list?: FilteredItem[];
}) {
  const { model, ctx, baseline, items: pageItems, c } = useCompare();
  const items = list ?? pageItems;
  const ownList = list !== undefined;
  const ui = useItemsUi();
  const store = useDetailsStore();
  const location = useLocation();
  const itemId = item.itemId;
  const resolved = useResolvedRows(model.runs, itemId);
  const ensure = useEnsureBodies(model.runs);
  const prev = at > 0 ? items[at - 1] : undefined;
  const next = at < items.length - 1 ? items[at + 1] : undefined;
  const prevId = prev?.itemId;
  const nextId = next?.itemId;
  // the item's texts, and its neighbours' before they are asked for
  useEffect(() => {
    void ensure([itemId, prevId, nextId].filter((x): x is string => !!x));
  }, [ensure, itemId, prevId, nextId]);

  // ---- one item at a time: a new row replaces the open one
  const { expanded, toggleExpanded } = ui;
  useEffect(() => {
    for (const other of expanded) if (other !== itemId) toggleExpanded(other, false);
  }, [expanded, itemId, toggleExpanded]);

  const step = useCallback(
    (which: 'previous' | 'next') => {
      const target = which === 'next' ? next : prev;
      if (!target) return;
      toggleExpanded(target.itemId, true);
      if (!ownList) {
        const page = Math.floor(items.indexOf(target) / pageSize) + 1;
        if (page !== c.view.page) c.setView({ page }, { keepPage: true });
      }
      requestAnimationFrame(() =>
        document.getElementById(`item-${target.itemId}`)?.scrollIntoView({ block: 'nearest' }),
      );
    },
    [next, prev, toggleExpanded, items, pageSize, c, ownList],
  );
  const close = useCallback(() => {
    toggleExpanded(itemId, false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`#${CSS.escape(`item-${itemId}`)} [data-part="item-head"]`)
        ?.focus(),
    );
  }, [itemId, toggleExpanded]);

  const first = resolved.find((r) => r.row)?.row ?? null;
  const loaded = resolved.every((r) => !r.row || r.loaded);
  const failed = useMemo(
    () =>
      model.runs.filter((run) => {
        const row = run.byItem.get(itemId);
        return row && store.stateOf(run.base, row.item_id)?.status === 'error';
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.runs, itemId, resolved],
  );
  const failedRow = failed[0]?.byItem.get(itemId);
  const failedState = failedRow ? store.stateOf(failed[0]!.base, failedRow.item_id) : undefined;
  const failedCause = failedState?.status === 'error' ? failedState.error : undefined;
  const pending = useDelayedPending(!loaded);
  const cols: Col[] = resolved.flatMap((r, i) =>
    r.row ? [{ i, run: model.runs[i]!, row: r.row, state: pillState(model.runs[i]!, r.row, ctx).state }] : [],
  );
  const baseIdx = baseline.runIdxs[0] ?? 0;
  const baseCol = cols.find((x) => x.i === baseIdx) ?? null;

  const rawInput = first?.input_full ?? first?.input ?? first?.input_preview;
  const rawExpected = first?.expected_full ?? first?.expected;
  const hasExpected = !!bodyText(rawExpected);
  const md = (first?.item_metadata ?? {}) as Record<string, unknown>;
  const metadata = Object.fromEntries(
    Object.entries(md).filter(
      ([k, v]) => !HIDDEN_METADATA_KEYS.has(k) && !ui.hiddenFields.has(k) && v != null && v !== '',
    ),
  );

  // ---- the outputs in view (many runs), and which of them differ from the baseline's
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const differing = useMemo(
    () =>
      visibleWhenOnlyDiffering(
        cols.map((col) => col.row),
        Math.max(
          0,
          cols.findIndex((col) => col.i === baseIdx),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, baseIdx],
  );

  // ---- what the outputs are read against: Expected, or the output of the baseline run
  const [marks, setMarks] = useDiffMarks();
  const [pick, setPick] = useState<Against | null>(null);
  const canBaseline = cols.length > 1 && !!baseCol;
  const against: Against =
    pick === 'baseline' && canBaseline ? 'baseline' : hasExpected ? 'expected' : 'baseline';
  const baseOutput = baseCol ? outputOf(baseCol.row) : undefined;
  const otherFor = (col: Col): unknown =>
    !marks
      ? undefined
      : against === 'expected'
        ? hasExpected
          ? rawExpected
          : undefined
        : col.i === baseIdx
          ? undefined
          : baseOutput;

  const number = model.itemIds.indexOf(itemId) + 1;
  const peek = (target: FilteredItem | undefined): PanePeek | undefined => {
    if (!target) return undefined;
    const row = target.rows.find((r) => r);
    return {
      number: model.itemIds.indexOf(target.itemId) + 1,
      prompt: promptLine(row?.input_full ?? row?.input ?? row?.input_preview),
    };
  };
  const link = `${window.location.origin}${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), item: itemId }).toString()}`;
  const wide = cols.length + (hasExpected ? 1 : 0);

  return (
    <PaneShell
      design="compare-page"
      itemId={itemId}
      label={`Item #${number}`}
      storageKey={`qym:item-pane:compare-page:${Math.min(cols.length, 4)}`}
      // many runs: the tables need the width more than the list does
      defaultWidth={cols.length > MAX_COLUMNS ? 1600 : wide >= 4 ? 1480 : wide === 3 ? 1240 : 1040}
      minWidth={560}
      navSelector="[data-compare-sticky]"
      textMode={ui.textMode}
      ident={
        <>
          <span className={p.num}>#{number}</span>
          <span className={p.itemId} title="Item id">
            {first?.item_id ?? itemId}
          </span>
          {ident}
        </>
      }
      actions={<LinkAct text={link} />}
      title={promptLine(rawInput) || undefined}
      at={at}
      total={items.length}
      prev={peek(prev)}
      next={peek(next)}
      onStep={step}
      onClose={close}
    >
      {failed.length ? (
        // a failed load is never an empty state (§3 "Failed requests"): the platform error state with its Retry
        <ErrorState
          compact
          error={failedCause}
          title={`Couldn’t load this item for ${failed.map((r) => r.label).join(', ')}`}
          onRetry={() => failed.forEach((r) => void store.retry(r.base, r.byItem.get(itemId)!.item_id))}
        />
      ) : !loaded ? (
        pending ? (
          <PaneSkeleton
            blocks={['input', 'pair', 'metrics']}
            metricRows={model.metrics.length}
            outputs={resolved.filter((r) => r.row).length}
            pairClassName={s.outs}
          />
        ) : null
      ) : (
        <>
          <TextPart title="Input" tone="info" part="input" value={rawInput} copyLabel="Copy input" />
          <div className={s.outsWrap}>
            <div className={s.outsBar}>
              {cols.length > 3 ? (
                // many runs: pick the outputs to read
                // each output is on or off and the reader sees them all: the platform's on/off chips (cv5 H4)
                <div className={s.runPick}>
                  <span className={s.outsLabel} id={`outs-${itemId}`}>
                    Outputs
                  </span>
                  <ToggleChips
                    aria-labelledby={`outs-${itemId}`}
                    size="sm"
                    min={1}
                    options={cols.map((col) => ({
                      value: String(col.i),
                      // the chip shows the run's colour and letter; its name is the accessible name
                      label: (
                        <span role="img" aria-label={col.run.label}>
                          <RunTag index={col.i} showName={false} bare />
                        </span>
                      ),
                      title: col.run.label,
                    }))}
                    value={cols.filter((col) => !hidden.has(col.i)).map((col) => String(col.i))}
                    onChange={(on) =>
                      setHidden(
                        new Set(cols.filter((col) => !on.includes(String(col.i))).map((col) => col.i)),
                      )
                    }
                  />
                  <Button size="sm" variant="neutral" onPress={() => setHidden(new Set())}>
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="neutral"
                    onPress={() =>
                      setHidden(new Set(cols.filter((_, n) => !differing[n]).map((col) => col.i)))
                    }
                  >
                    Only the ones that differ from the baseline
                  </Button>
                </div>
              ) : null}
              {hasExpected || canBaseline ? (
                <div className={s.marksPick}>
                  <span className={s.outsLabel} aria-hidden="true">
                    Mark the differences from
                  </span>
                  <SegmentedControl<Against | 'off'>
                    label="Mark the differences from"
                    value={!marks ? 'off' : against}
                    onChange={(v) => {
                      setMarks(v !== 'off');
                      if (v !== 'off') setPick(v);
                    }}
                    options={[
                      ...(hasExpected ? [{ value: 'expected' as const, label: 'Expected' }] : []),
                      ...(canBaseline ? [{ value: 'baseline' as const, label: 'Baseline' }] : []),
                      { value: 'off' as const, label: 'Off' },
                    ]}
                  />
                </div>
              ) : null}
            </div>
            <div className={s.outs} data-expected-row={hasExpected && cols.length > 2 ? '' : undefined}>
              {hasExpected ? (
                <TextPart
                  title="Expected"
                  tone="gold"
                  part="expected"
                  value={rawExpected}
                  copyLabel="Copy expected output"
                  fill
                />
              ) : null}
              {cols
                .filter((col) => !hidden.has(col.i))
                .map((col) => (
                  <RunOutput
                    key={col.run.ref}
                    col={col}
                    against={otherFor(col)}
                    isBase={col.i === baseIdx && cols.length > 1}
                  />
                ))}
            </div>
          </div>
          <Metrics key={itemId} cols={cols} baseIdx={baseIdx} />
          <Execution cols={cols} baseIdx={baseIdx} />
          {Object.keys(metadata).length ? (
            <PaneSection title="Metadata" part="metadata">
              <div className={p.block} data-tone="neutral">
                <div className={p.blockBody} data-top="">
                  <FieldList data={metadata} label="Item metadata" />
                </div>
              </div>
            </PaneSection>
          ) : null}
          <PaneSection title="Root cause" part="root-cause">
            <div className={s.causes}>
              {cols.map((col) => (
                <div key={col.run.ref} className={s.cause}>
                  <Issues run={col.run} row={col.row} head={<RunName col={col} />} />
                </div>
              ))}
            </div>
          </PaneSection>
        </>
      )}
    </PaneShell>
  );
}

/** The pane of the item opened last on the compare page; nothing when no item is open. */
export function ComparePaneHost({ pageSize }: { pageSize: number }) {
  const ui = useItemsUi();
  const { items } = useCompare();
  const open = [...ui.expanded].pop();
  const at = open ? items.findIndex((i) => i.itemId === open) : -1;
  if (at < 0) return null;
  return <ComparePane item={items[at]!} at={at} pageSize={pageSize} />;
}
