/**
 * The metrics of an item as one table: name, score (one column per pass in view and the mean for a multi-pass item),
 * the pass threshold and the reason, all on one line at every width: the pane grows to the table (up to 75% of the
 * page), then the table scrolls sideways with the arrow and the name pinned (I16). What a scorer recorded beside
 * the reason (its model, a rubric, a table of mismatches) shows under the metric over the full width of the table:
 * short facts first, then text, then tables. With several passes in view the reasons and the details show there too,
 * one column per pass. The details are closed until the reader opens one metric (its row) or all of them.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';
import { keyWithBreaks } from '@/lib/keyBreaks';
import { SCORE_EDIT_HINTS, isInternalMetaKey, type MetricSpec } from '@/lib/metrics';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs } from '@/lib/text';
import { Button, ScoreValue, SectionBoundary, SegmentedControl, StateTag, Tag } from '@/ui';
import { useRunPage } from '../../../RunContext';
import type { Row } from '../../../types';
import { ScoreEditor } from '../ScoreEditor';
import { Act } from './actions';
import { PaneSection, PassGlyph } from './blocks';
import {
  editTooltip,
  extraMeta,
  metaOf,
  reasonOf,
  type ItemData,
  type ItemPass,
  type MetricRow,
} from './model';
import { FieldList } from './values';
import { usePaneGrow } from './width';
import s from './pane.module.css';

/* ---------- the "details open" preference (one for every pane) ---------- */

const DETAILS_KEY = 'qym:item-pane:details';
const detailSubs = new Set<() => void>();
let detailMemory: boolean | null = null;

export function useDetailsOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (f) => {
      detailSubs.add(f);
      return () => detailSubs.delete(f);
    },
    () => detailMemory ?? readLocal(DETAILS_KEY) === 'open',
  );
  const set = (next: boolean) => {
    detailMemory = next;
    writeLocal(DETAILS_KEY, next ? 'open' : null);
    detailSubs.forEach((f) => f());
  };
  return [open, set];
}

/** What a judge recorded beside the reason, without the platform's own bookkeeping keys. */
export function detailsOf(meta: Record<string, unknown>, hidden: Set<string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extraMeta(meta)).filter(
      ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
    ),
  );
}

export function initialFor(cell: MetricRow['cells'][number]): string {
  if (cell.value === null) return '';
  if (cell.type === 'score') return String(Math.round(cell.value * 1000) / 10) + '%';
  if (cell.type === 'boolean')
    return cell.value >= 0.9999 ? 'true' : cell.value <= 0.0001 ? 'false' : String(cell.value);
  return String(cell.value);
}

export function Score({ cell, verdict }: { cell: MetricRow['cells'][number]; verdict: boolean | null }) {
  return (
    <ScoreValue
      variant="pill"
      value={cell.value}
      type={cell.type}
      direction={cell.direction}
      error={cell.error}
      text={cell.text}
      verdict={verdict === null ? null : verdict ? 'pass' : 'fail'}
      className={s.score}
    />
  );
}

/* ---------- score edit ---------- */

/** What the score field takes, by the kind of the metric: one quiet line under the platform's score editor. */
export function ScoreHint({ spec }: { spec: MetricSpec | undefined }) {
  const kind = spec?.score_type && spec.score_type in SCORE_EDIT_HINTS ? spec.score_type : 'legacy';
  return <p className={s.hint}>{SCORE_EDIT_HINTS[kind]}</p>;
}

/** The platform's score editor (same request, same checks, same buttons) with the hint line of the pane. */
export function ScoreEdit({
  row,
  item,
  metric,
  spec,
  initial,
  passNumber,
  edited,
  onDone,
}: {
  row: Row;
  item: ItemData;
  metric: string;
  spec: MetricSpec | undefined;
  initial: string;
  passNumber: number | null;
  edited: boolean;
  onDone: () => void;
}) {
  const { payload } = useRunPage();
  return (
    <div className={s.edit}>
      <ScoreEditor
        runId={item.runId}
        filePath={payload.run.file_path ?? payload.run.run_id}
        row={row}
        metric={metric}
        spec={spec}
        initial={initial}
        passNumber={passNumber}
        passVersion={item.model.passRevision}
        edited={edited}
        onDone={onDone}
      />
      <ScoreHint spec={spec} />
    </div>
  );
}

/* ---------- the table ---------- */

/** What decides the columns of the metrics table. */
export interface MetricColumnsInput {
  /** Several passes in view (a score column per pass, then the mean). */
  multi: boolean;
  /** The score columns: one, or the passes in view plus the mean. */
  scores: number;
  /** A metric of the item has a pass threshold: the Pass if column. */
  passIf: boolean;
  /** A reason column (one pass in view and a reason or a scorer error to show). */
  reason: boolean;
  /** The width in px the longest metric name needs on one line (measured); the name column is at least this wide. */
  name?: number;
}

/** The one column layout of the table (pane.module.css `.mgrid`): every metric is one line at every width (I16). */
export interface MetricColumns {
  /** The complete `grid-template-columns`. */
  template: string;
  /** How many tracks the template makes (the sheet puts its column gap between them). */
  tracks: number;
  /** The smallest width of all the tracks together, in px: below it (plus gaps and padding) the table scrolls. */
  min: number;
}

/** The arrow column and the action column at the two ends of a row (the sheet pins the arrow and the name by it). */
const EDGE = 24;
/** The smallest width of the metric name column. */
const NAME_MIN = 148;
/** The widest the longest name may make the column; only a name longer than this wraps (never cut). */
const NAME_MAX = 360;
/** A score column: the widest score pill (`100.0%`) and its tint. */
const SCORE_MIN = 68;
const PASS_IF = 64;
/** The reason column: a few words a line, so a short reason stays short. */
const REASON_MIN = 200;

/**
 * The column template as a complete track list (I13, the malformed metrics table): every track is written out here,
 * with the number of score columns in the text, so no template depends on a custom property that may be empty or
 * missing. An optional column built in CSS (`var(--c-reason)` with no value: React 18 trims a blank inline value
 * and drops the property) made the template invalid, and every cell of a row stacked in one column.
 *
 * One layout for every width (I16, "i want that in one line"): the arrow, the name, a score per pass in view and the
 * mean, Pass if, the reason and the edit button share one line. Every track has a smallest width; the pane grows to
 * the sum (`min`), and past 75% of the page the table scrolls sideways with the arrow and the name pinned.
 */
export function metricColumns({ multi, scores, passIf, reason, name }: MetricColumnsInput): MetricColumns {
  const n = Number.isFinite(scores) && scores >= 1 ? Math.floor(scores) : 1;
  // the longest name stays on one line (the pane grows for it), up to NAME_MAX
  const nameMin = Math.min(
    NAME_MAX,
    Math.max(NAME_MIN, Number.isFinite(name) ? Math.ceil(name as number) : 0),
  );
  const passIfTrack = passIf ? ` ${PASS_IF}px` : '';
  const template =
    multi && !reason
      ? // several passes and no reason column: the score columns share the free width, near their names
        `${EDGE}px minmax(${nameMin}px, 1.4fr) repeat(${n}, minmax(${SCORE_MIN}px, 1fr))${passIfTrack} ${EDGE}px`
      : `${EDGE}px minmax(${nameMin}px, 0.8fr) repeat(${n}, ${SCORE_MIN}px)${passIfTrack}` +
        `${reason ? ` minmax(${REASON_MIN}px, 2fr)` : ''} ${EDGE}px`;
  return {
    template,
    tracks: 3 + n + (passIf ? 1 : 0) + (reason ? 1 : 0),
    min: 2 * EDGE + nameMin + n * SCORE_MIN + (passIf ? PASS_IF : 0) + (reason ? REASON_MIN : 0),
  };
}

/** The template as the inline custom property the sheet reads (always set and never empty). */
export function columnStyle(cols: MetricColumns): CSSProperties {
  return { ['--m-cols' as string]: cols.template } as CSSProperties;
}

/**
 * The pane width the table needs to show on one line without a sideways scroll: the smallest width of its tracks, the
 * sheet's gaps and padding (read from the head row), and what lies between the pane's edges and the table.
 */
export function neededPaneWidth(cols: MetricColumns, grid: HTMLElement, pane: HTMLElement): number | null {
  const head = grid.firstElementChild;
  if (!(head instanceof HTMLElement) || !grid.clientWidth) return null;
  const css = getComputedStyle(head);
  const px = (v: string) => Number.parseFloat(v) || 0;
  const table =
    cols.min + px(css.columnGap) * (cols.tracks - 1) + px(css.paddingInlineStart) + px(css.paddingInlineEnd);
  return Math.ceil(table + pane.getBoundingClientRect().width - grid.clientWidth);
}

/**
 * The width the longest metric name needs on one line: its text in the name's own font, plus a tag beside it. Measured
 * again when the names change and when the fonts have loaded. Undefined where the text cannot be measured.
 */
function useNameWidth(grid: RefObject<HTMLDivElement | null>, key: string): number | undefined {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || typeof CanvasRenderingContext2D === 'undefined') return undefined;
    let live = true;
    const measure = () => {
      const names = el.querySelectorAll<HTMLElement>('[data-part="metric-name"]');
      const ctx = document.createElement('canvas').getContext('2d');
      if (!live || !names.length || !ctx) return;
      const css = getComputedStyle(names[0]!);
      ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      let max = 0;
      names.forEach((n) => {
        const tag = n.nextElementSibling;
        const extra = tag ? tag.getBoundingClientRect().width + (Number.parseFloat(css.fontSize) || 12) : 0;
        max = Math.max(max, ctx.measureText(n.textContent ?? '').width + extra);
      });
      setWidth(Math.ceil(max) + 2);
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
    };
  }, [grid, key]);
  return width;
}

/**
 * Tell a growing pane (the run page's item pane) the width the table needs, now and whenever the table's box
 * changes. The need is withdrawn when the layout changes (a pass leaves the view) or the table goes away.
 */
function useGrowToTable(cols: MetricColumns, grid: RefObject<HTMLDivElement | null>, active: boolean) {
  const grow = usePaneGrow();
  const { template } = cols;
  const latest = useRef(cols);
  useLayoutEffect(() => {
    latest.current = cols;
  });
  useLayoutEffect(() => {
    const el = grid.current;
    if (!grow || !el || !active) return undefined;
    const measure = () => {
      const pane = grow.pane();
      const need = pane ? neededPaneWidth(latest.current, el, pane) : null;
      if (need !== null) grow.need(template, need);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      grow.need(template, null);
    };
  }, [grow, grid, template, active]);
}

/** Marks the table while it is scrolled sideways: the pinned name then shows its edge (also the compare pane). */
export function markScrolled(e: UIEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.toggleAttribute('data-scrolled', Math.abs(el.scrollLeft) > 0);
}

export interface MetricsProps {
  row: Row;
  item: ItemData;
  /** The passes in view (the pass toggles of the pane); a single-pass item has one. */
  open: number[];
}

/** A click on a row opens it, unless it lands on a control, inside the opened details or ends a text selection. */
function rowClickToggles(e: MouseEvent<HTMLElement>): boolean {
  const target = e.target as Element;
  if (
    target.closest(
      'button, a, input, textarea, select, [role="button"], [role="radio"], [data-part="metric-details"]',
    )
  )
    return false;
  if (target.closest('[data-editing]')) return false;
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return !(selection && !selection.isCollapsed && selection.toString().trim());
}

export function MetricTable({ row, item, open }: MetricsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editPass, setEditPass] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  // a metric closed or opened on its own, until the header button moves them all again
  const [own, setOwn] = useState<Record<string, boolean>>({});
  const { passes, multi } = item;
  // the passes in view, in pass order, with their place in the cells of a metric
  const inView = passes.map((p, i) => ({ p, i })).filter(({ p }) => !multi || open.includes(p.pass));
  if (!inView.length) inView.push({ p: passes[0]!, i: 0 });
  const one = inView.length === 1 ? inView[0]! : null;
  const scoreColumns = multi ? inView.length + 1 : 1;
  const none = item.restricted || item.noScores;
  const hidden = item.ui.hiddenMetricFields;

  const rows = item.metrics.map((m) => {
    const perPass = inView.map(({ p, i }) => {
      const meta = metaOf(p.scoped, m.metric);
      return {
        p,
        i,
        meta,
        reason: p.taskError ? '' : reasonOf(meta),
        details: p.taskError ? {} : detailsOf(meta, hidden),
        cell: m.cells[i]!,
        failing: m.verdicts[i] === false,
      };
    });
    const failing = perPass.some((x) => x.failing);
    // one pass in view: its reason has a column, its details open under the row
    // several: the reasons and the details open under the row, one column per pass
    const expandable = one
      ? Object.keys(perPass[0]!.details).length > 0
      : perPass.some((x) => x.reason || x.cell.error || Object.keys(x.details).length > 0);
    return { m, perPass, failing, expandable };
  });
  const expandable = rows.filter((r) => r.expandable);
  const isOpen = (metric: string) => own[metric] ?? detailsOpen;
  const allOpen = expandable.length > 0 && expandable.every((r) => isOpen(r.m.metric));
  const below = rows.filter((r) => r.failing).length;
  // a column shows only when a metric has something for it: a pass threshold, a reason (or a scorer error to report)
  const anyPassIf = rows.some((r) => r.m.passIf);
  const anyReason =
    !!one && !one.p.taskError && rows.some((r) => r.perPass[0]!.reason || r.perPass[0]!.cell.error);
  // a pass whose task failed has no reasons: the block says so once, the Output block shows the error
  const taskError = one?.p.taskError ? 'Task error' : null;
  // the pass a score edit writes to: the one in view, or the one picked above the editor
  const firstBad = inView.find(({ p }) => p.kind !== 'pass')?.p.pass;
  const editTarget = one
    ? one.p.pass
    : editPass !== null && inView.some(({ p }) => p.pass === editPass)
      ? editPass
      : (firstBad ?? inView[0]!.p.pass);
  const toggle = (metric: string, next: boolean) => setOwn((cur) => ({ ...cur, [metric]: next }));
  // one line per metric at every width (I16): the pane grows to the table, then the table scrolls in its block
  const gridRef = useRef<HTMLDivElement>(null);
  const nameKey = rows
    .map((r) => `${r.m.metric}${r.perPass.some((x) => x.cell.edited) ? '*' : ''}`)
    .join('|');
  const nameWidth = useNameWidth(gridRef, nameKey);
  const cols = metricColumns({
    multi,
    scores: scoreColumns,
    passIf: anyPassIf,
    reason: anyReason,
    name: nameWidth,
  });
  useGrowToTable(cols, gridRef, !none);

  const head: ReactNode = (
    <div className={s.mhead} role="row">
      <span role="columnheader" className={s.leadCell} />
      <span role="columnheader" className={s.mtitle}>
        Metric
      </span>
      {none ? null : (
        <>
          {multi ? (
            <>
              {inView.map(({ p }) => (
                <span key={p.pass} role="columnheader" data-center="">
                  <span className={s.passOpt}>
                    Pass {p.pass}
                    <PassGlyph pass={p} />
                  </span>
                </span>
              ))}
              <span role="columnheader" data-center="">
                Mean
              </span>
            </>
          ) : (
            <span role="columnheader" data-center="">
              Score
            </span>
          )}
          {anyPassIf ? (
            <span role="columnheader" data-center="">
              Pass if
            </span>
          ) : null}
          {anyReason ? (
            <span role="columnheader" className={s.reasonHead}>
              {multi ? `Reason, pass ${one!.p.pass}` : 'Reason'}
            </span>
          ) : null}
          <span role="columnheader" className={s.actionCell} />
        </>
      )}
    </div>
  );

  return (
    <PaneSection
      title="Metrics"
      part="metrics-section"
      collapsible
      description={
        // a result is a StateTag; a problem count is a count tag in its tone (§3.3)
        none ? null : taskError ? (
          <StateTag tone="danger">{taskError}</StateTag>
        ) : below ? (
          <Tag kind="count" tone="danger" data-count="failed">
            {below} failed
          </Tag>
        ) : null
      }
      aside={
        // the details of every metric open or close at once: a labelled button, not an arrow
        expandable.length && !none ? (
          <Button
            size="sm"
            variant="neutral"
            aria-expanded={allOpen}
            onPress={() => {
              setDetailsOpen(!allOpen);
              setOwn({});
            }}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        ) : undefined
      }
    >
      <section className={s.block} data-tone="neutral" data-part="metrics" aria-label="Metrics">
        <div
          ref={gridRef}
          className={s.mgrid}
          data-multi={multi ? '' : undefined}
          data-noreason={anyReason ? undefined : ''}
          role="table"
          aria-label="Metrics"
          // the complete column template: one line per metric at every width
          style={columnStyle(cols)}
          onScroll={markScrolled}
        >
          {head}
          {none ? (
            <p className={s.mnone}>
              {item.restricted
                ? 'Scores are hidden for this run'
                : 'No scores: this item gave no output to score'}
            </p>
          ) : (
            rows.map(({ m, perPass, failing, expandable: canOpen }) => {
              const lone = one ? perPass[0]! : null;
              const isEditing = editing === m.metric;
              const opened = canOpen && isOpen(m.metric);
              const target = perPass.find((x) => x.p.pass === editTarget) ?? perPass[0]!;
              return (
                // the whole row opens its details; the arrow that leads it is the same control for the keyboard
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the lead arrow is the keyboard control of the row
                <div
                  key={m.metric}
                  className={s.mrow}
                  role="row"
                  data-failing={failing ? '' : undefined}
                  data-editing={isEditing ? '' : undefined}
                  data-expandable={canOpen ? '' : undefined}
                  data-open={opened ? '' : undefined}
                  onClick={canOpen ? (e) => rowClickToggles(e) && toggle(m.metric, !opened) : undefined}
                >
                  {/* the arrow leads the row, as a disclosure: it opens what the scorer recorded for the metric */}
                  <span role="cell" className={s.leadCell}>
                    {canOpen ? (
                      <Act
                        label={`${opened ? 'Hide' : 'Show'} the details of ${m.metric}`}
                        icon={opened ? 'chevron-down' : 'chevron-right'}
                        aria-expanded={opened}
                        onPress={() => toggle(m.metric, !opened)}
                      />
                    ) : null}
                  </span>
                  <span role="cell" className={s.nameCell}>
                    <span
                      className={s.metricName}
                      data-part="metric-name"
                      data-page={m.isPage ? '' : undefined}
                      title={m.isPage ? 'The page metric: it decides Pass or Fail' : undefined}
                    >
                      {keyWithBreaks(m.metric)}
                    </span>
                    {perPass.some((x) => x.cell.edited) ? (
                      <Tag kind="accent" tone="warning" title={editTooltip(target.meta)}>
                        edited
                      </Tag>
                    ) : null}
                  </span>
                  {multi ? (
                    <>
                      {perPass.map((x) => (
                        <span key={x.p.pass} role="cell" data-center="">
                          <span className={s.cellScore}>
                            <Score cell={x.cell} verdict={m.verdicts[x.i] ?? null} />
                          </span>
                        </span>
                      ))}
                      <span role="cell" data-center="">
                        <span className={s.cellScore}>
                          <Score cell={m.mean} verdict={m.meanVerdict} />
                        </span>
                      </span>
                    </>
                  ) : (
                    <span role="cell" data-center="">
                      <span className={s.cellScore}>
                        <Score cell={lone!.cell} verdict={m.verdicts[lone!.i] ?? null} />
                      </span>
                    </span>
                  )}
                  {anyPassIf ? (
                    <span role="cell" data-center="" className={s.passIf}>
                      {m.passIf}
                    </span>
                  ) : null}
                  {anyReason || isEditing ? (
                    <div role="cell" className={s.reasonCell}>
                      {isEditing ? (
                        <div className={s.editStack}>
                          {one ? null : (
                            <SegmentedControl
                              label="Pass to edit"
                              value={String(editTarget)}
                              onChange={(v) => setEditPass(Number(v))}
                              options={perPass.map((x) => ({
                                value: String(x.p.pass),
                                label: `Pass ${x.p.pass}`,
                              }))}
                            />
                          )}
                          <ScoreEdit
                            key={editTarget}
                            row={row}
                            item={item}
                            metric={m.metric}
                            spec={item.model.metricSpecs[m.metric]}
                            initial={initialFor(target.cell)}
                            passNumber={multi ? editTarget : item.model.viewPass}
                            edited={target.cell.edited}
                            onDone={() => setEditing(null)}
                          />
                        </div>
                      ) : lone && !lone.p.taskError ? (
                        <ReasonText text={lone.reason} failing={lone.failing} error={!!lone.cell.error} />
                      ) : null}
                    </div>
                  ) : null}
                  <span role="cell" className={s.actionCell}>
                    {item.canEdit ? (
                      <Act
                        tile
                        label={`Edit the ${m.metric} score${multi && one ? ` of pass ${one.p.pass}` : ''}`}
                        icon="edit"
                        active={isEditing}
                        onPress={() => setEditing(isEditing ? null : m.metric)}
                      />
                    ) : null}
                  </span>
                  {opened ? (
                    <div
                      role="cell"
                      className={s.mdetail}
                      data-part="metric-details"
                      data-cols={one ? undefined : perPass.length}
                    >
                      {/* a crash in what one scorer recorded stays in its details (I14), never blanks the table */}
                      <SectionBoundary name={`the details of ${m.metric}`}>
                        {one ? (
                          <FieldList data={lone!.details} label={`Details of ${m.metric}`} detail />
                        ) : (
                          perPass.map((x) => <PassDetail key={x.p.pass} metric={m.metric} x={x} />)
                        )}
                      </SectionBoundary>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    </PaneSection>
  );
}

function ReasonText({ text, failing, error }: { text: string; failing: boolean; error: boolean }) {
  const fallback = error ? 'The scorer failed on this metric' : 'No reason was recorded';
  return (
    <p
      className={s.reason}
      data-strong={failing ? '' : undefined}
      data-empty={text ? undefined : ''}
      {...textDirAttrs(text)}
    >
      {text || fallback}
    </p>
  );
}

/** The reason and the details of one metric for one pass in view: one column of the opened row. */
function PassDetail({
  metric,
  x,
}: {
  metric: string;
  x: {
    p: ItemPass;
    reason: string;
    details: Record<string, unknown>;
    cell: MetricRow['cells'][number];
    failing: boolean;
  };
}) {
  const { p } = x;
  return (
    <div className={s.passDetail} role="group" aria-label={`${metric}, pass ${p.pass}`}>
      <div className={s.passDetailHead}>
        <span className={s.passOpt}>
          Pass {p.pass}
          <PassGlyph pass={p} />
        </span>
      </div>
      {p.taskError ? (
        <p className={s.reason} data-empty="">
          Task error: no score
        </p>
      ) : (
        <>
          <ReasonText text={x.reason} failing={x.failing} error={!!x.cell.error} />
          {Object.keys(x.details).length ? (
            <FieldList data={x.details} label={`Details of ${metric}, pass ${p.pass}`} detail />
          ) : null}
        </>
      )}
    </div>
  );
}
