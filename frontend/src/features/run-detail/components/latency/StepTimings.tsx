/**
 * Step timings card. By step is the average trace: the trace's tree in trace order (indent, fold arrows and the
 * trace's kind icons), one row per step whatever the model, each plot the step's time in one trace. By kind is each
 * kind's time inside one trace; a kind opens to its steps. Every visible row shares one time axis (Linear or Log).
 * Sort by trace order (By step's default), Median, Calls / trace, Time / trace or Errors. A run whose traces do not
 * merge into one tree shows its step sites instead, one call each.
 */
import { forwardRef, useMemo, type Dispatch, type SetStateAction } from 'react';
import { stepLatencyUrl } from '@/api/runs';
import { platformUrl } from '@/lib/runtime';
import {
  ActionTile,
  Button,
  Card,
  CardTitle,
  ChartTooltipHost,
  CountTile,
  DropdownMenu,
  Icon,
  SearchField,
  SegmentedControl,
  useMarkTip,
  Tag,
} from '@/ui';
import {
  allStepRows,
  durText,
  flattenSteps,
  fmtK,
  fmtMs,
  pct,
  stepIcon,
  stepsAxis,
  stepsCsv,
  stepsModel,
  stepsSvg,
  stepTone,
  tickLabel,
  walkSteps,
  type LatencyData,
  type StepNode,
  type StepSortKey,
  type StepsAxis,
} from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { Glyph } from './kinds';
import { TipBody, cssVars } from './Tip';
import styles from './Steps.module.css';

export interface StepsView {
  group: 'step' | 'kind';
  scale: 'linear' | 'log';
  query: string;
  /** Groups the reader opened (By kind starts with every kind folded). */
  opened: ReadonlySet<string>;
  /** Groups the reader folded (By step starts with the trace open, as the trace drawer). */
  folded: ReadonlySet<string>;
  sort: { key: StepSortKey; dir: 1 | -1 };
}

const DEFAULT_SORT: Record<StepsView['group'], StepsView['sort']> = {
  step: { key: 'order', dir: -1 },
  kind: { key: 'time', dir: -1 },
};

export const STEPS_VIEW: StepsView = {
  group: 'step',
  // Spans (tens of seconds) and calls (milliseconds) share one axis: Log keeps both readable.
  scale: 'log',
  query: '',
  opened: new Set(),
  folded: new Set(),
  sort: DEFAULT_SORT.step,
};

/** A run with more rows than this opens only the top two levels of its average trace at first. */
const OPEN_ALL_MAX = 300;

/** The By step view with these groups open (a kind card's "Open in Step timings"). */
export function openInSteps(v: StepsView, open: readonly string[]): StepsView {
  const fromKind = v.group !== 'step';
  const folded = new Set(fromKind ? [] : v.folded);
  const opened = new Set(fromKind ? [] : v.opened);
  open.forEach((id) => {
    folded.delete(id);
    opened.add(id);
  });
  return { ...v, group: 'step', query: '', folded, opened, sort: fromKind ? DEFAULT_SORT.step : v.sort };
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function trackTip(node: StepNode, traces: number, perTrace: boolean, byKind: boolean) {
  const st = node.stats;
  const title = node.name + (node.models.length ? ` · ${node.models.join(' · ')}` : '');
  const rows: Array<[string, string]> = [
    ['p5 · p25', `${fmtMs(st.p5)} · ${fmtMs(st.p25)}`],
    ['Median', fmtMs(st.med)],
    ['Mean', fmtMs(st.mean)],
    ['p75 · p95', `${fmtMs(st.p75)} · ${fmtMs(st.p95)}`],
  ];
  if (node.inTraces != null) rows.push(['Runs in', `${fmtInt(node.inTraces)} of ${fmtInt(traces)} traces`]);
  rows.push(['Calls / trace', (traces ? node.calls / traces : 0).toFixed(1)]);
  if (byKind && node.children) rows.push(['Steps', fmtInt(node.children.length)]);
  rows.push(['Errors', st.err ? `${fmtInt(st.err)} (${pct(st.err, st.n + st.err).toFixed(1)}%)` : '—']);
  if (st.tok && traces) rows.push(['Tokens / trace', fmtK(st.tok / traces)]);
  const hint =
    perTrace && node.inTraces != null
      ? byKind && node.children
        ? 'The kind’s time in one trace (all its calls).'
        : 'The time in one trace, over the traces it runs in.'
      : 'One call.';
  return <TipBody title={title} rows={rows} hint={hint} />;
}

function Track({
  node,
  axis,
  traces,
  perTrace,
  byKind,
}: {
  node: StepNode;
  axis: StepsAxis;
  traces: number;
  perTrace: boolean;
  byKind: boolean;
}) {
  const st = node.stats;
  const { handlers, describedBy } = useMarkTip(trackTip(node, traces, perTrace, byKind));
  const timed = Number.isFinite(st.med);
  const unit = perTrace && node.inTraces != null ? 'time in one trace' : 'one call';
  return (
    <div
      className={styles.track}
      role="img"
      aria-label={
        timed
          ? `p5 ${durText(st.p5)}, median ${durText(st.med)}, p95 ${durText(st.p95)} (${unit})`
          : 'no timing'
      }
      aria-describedby={describedBy}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
    >
      <div className={styles.gridLines} aria-hidden="true">
        {axis.ticks.map((t) => (
          <i key={t} style={cssVars({ '--x': axis.x(t) })} />
        ))}
      </div>
      {timed ? (
        <div className={styles.iv} style={cssVars({ '--tone': stepTone(node) })} aria-hidden="true">
          <span className={styles.whisker} style={cssVars({ '--a': axis.x(st.p5), '--b': axis.x(st.p95) })} />
          <span className={styles.ivBox} style={cssVars({ '--a': axis.x(st.p25), '--b': axis.x(st.p75) })} />
          {Number.isFinite(st.mean) ? (
            <span className={styles.ivMean} style={cssVars({ '--a': axis.x(st.mean) })} />
          ) : null}
          <span className={styles.ivMed} style={cssVars({ '--a': axis.x(st.med) })} />
        </div>
      ) : null}
    </div>
  );
}

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadText(text: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  download(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const StepTimings = forwardRef<
  HTMLElement,
  {
    D: LatencyData;
    view: StepsView;
    setView: Dispatch<SetStateAction<StepsView>>;
    /** Rows a kind card pointed at, flashed once (`n` restarts the flash). */
    flash: { ids: ReadonlySet<string>; n: number } | null;
  }
>(function StepTimings({ D, view, setView, flash }, ref) {
  const { runId, model: page } = useRunPage();
  const model = useMemo(() => stepsModel(D), [D]);
  const byKind = view.group === 'kind';
  const roots = byKind ? model.kinds : model.roots;
  const big = useMemo(() => walkSteps(model.roots).length > OPEN_ALL_MAX, [model]);
  const rows = useMemo(
    () =>
      flattenSteps(roots, {
        query: view.query,
        sort: view.sort,
        traces: model.traces,
        isOpen: (node, depth) =>
          view.opened.has(node.id) || (!byKind && !view.folded.has(node.id) && (!big || depth < 2)),
      }),
    [roots, view.query, view.sort, view.opened, view.folded, model.traces, byKind, big],
  );
  const axis = useMemo(
    () =>
      stepsAxis(
        rows.map((r) => r.node.stats),
        view.scale,
      ),
    [rows, view.scale],
  );
  const patch = (p: Partial<StepsView>) => setView((v) => ({ ...v, ...p }));
  const toggle = (id: string, open: boolean) =>
    setView((v) => {
      const opened = new Set(v.opened);
      const folded = new Set(v.folded);
      if (open) {
        opened.delete(id);
        folded.add(id);
      } else {
        folded.delete(id);
        opened.add(id);
      }
      return { ...v, opened, folded };
    });
  const sortBy = (key: StepSortKey) =>
    setView((v) => ({ ...v, sort: { key, dir: v.sort.key === key ? (-v.sort.dir as 1 | -1) : -1 } }));
  const ariaSort = (key: StepSortKey) => {
    if (view.sort.key !== key) return 'none';
    // Trace order reads top to bottom: its first direction is ascending.
    if (key === 'order') return view.sort.dir < 0 ? 'ascending' : 'descending';
    return view.sort.dir < 0 ? 'descending' : 'ascending';
  };
  const caption = !model.perTrace
    ? 'Each plot is one call. Errors are counted, not timed.'
    : byKind
      ? 'Each plot is the kind’s time in one trace (all its calls), not one call.'
      : 'Each plot is the step’s time in one trace, over the traces it runs in. Errors are counted, not timed.';
  const csv = (extra: string) => platformUrl(stepLatencyUrl(runId, page.viewPass, `&format=csv${extra}`));
  const onExport = (id: string) => {
    if (id === 'csv-summary') {
      const all = allStepRows(roots, { query: view.query, sort: view.sort, traces: model.traces });
      downloadText(
        stepsCsv(all, model),
        'text/csv',
        byKind ? 'step_timings_by_kind.csv' : 'step_timings.csv',
      );
    } else if (id === 'csv-sites') download(csv(''), 'step_timings_by_model.csv');
    else if (id === 'csv-spans') download(csv('&level=spans'), 'step_timings_spans.csv');
    else if (id === 'svg') {
      const host = document.querySelector('[data-testid="latency-panel"]') ?? document.documentElement;
      const cs = getComputedStyle(host);
      const color = (token: string) => {
        const m = /^var\((--[\w-]+)\)$/.exec(token.trim());
        return (m ? cs.getPropertyValue(m[1]!).trim() : token) || 'gray';
      };
      downloadText(stepsSvg(rows, axis, color, caption), 'image/svg+xml', 'step_timings.svg');
    }
  };
  const head = (key: StepSortKey, label: string, className: string | undefined) => (
    <div role="columnheader" className={className} aria-sort={ariaSort(key)}>
      <button
        type="button"
        className={styles.headButton}
        data-sort={ariaSort(key)}
        onClick={() => sortBy(key)}
      >
        {label}
      </button>
    </div>
  );
  const description = !model.perTrace
    ? 'How long one call of each step takes. This run’s traces do not merge into one average trace.'
    : byKind
      ? 'How much time each kind of work takes inside one trace. Open a kind to see its steps.'
      : 'The average trace, step by step, in trace order. Each plot is the time a step takes in one trace.';
  const tableLabel = byKind
    ? 'Time per trace by kind'
    : model.perTrace
      ? 'The average trace, step by step'
      : 'Step latency by call site';
  return (
    <Card as="section" ref={ref} id="lt-steps" className={styles.box} aria-label="Step timings">
      <div className={styles.inner}>
        <div className={styles.head}>
          <CardTitle as="h4" title="Step timings" description={description} />
          {/* cv4 C2-1: the table toolbar on its own row, as the Items bar: search first, the toggles, Export at the end */}
          <div className={styles.tools} role="toolbar" aria-label="Step timings view">
            <SearchField
              label="Search steps and models"
              hideLabel
              placeholder="Search steps and models"
              value={view.query}
              onChange={(query) => patch({ query })}
              onClear={() => patch({ query: '' })}
              width="var(--search-width)"
            />
            <SegmentedControl
              label="Group steps"
              options={[
                { value: 'step', label: 'By step' },
                { value: 'kind', label: 'By kind' },
              ]}
              value={view.group}
              onChange={(group) =>
                patch({ group, opened: new Set(), folded: new Set(), sort: DEFAULT_SORT[group] })
              }
            />
            <SegmentedControl
              label="Time axis scale"
              options={[
                { value: 'linear', label: 'Linear' },
                { value: 'log', label: 'Log' },
              ]}
              value={view.scale}
              onChange={(scale) => patch({ scale })}
            />
            <span className={styles.toolsEnd}>
              <DropdownMenu
                label="Export step timings"
                trigger={
                  <Button variant="accent" icon={<Icon name="download" size={12} />}>
                    Export
                  </Button>
                }
                items={[
                  {
                    id: 'csv-summary',
                    label: 'CSV summary',
                    icon: <ActionTile icon="sheet" />,
                    disabled: !rows.length,
                    disabledReason: rows.length ? undefined : 'No step matches the search',
                  },
                  { id: 'csv-sites', label: 'CSV by step and model', icon: <ActionTile icon="sheet" /> },
                  { id: 'csv-spans', label: 'CSV raw spans', icon: <ActionTile icon="sheet" /> },
                  {
                    id: 'svg',
                    label: 'SVG plot',
                    icon: <ActionTile icon="picture" />,
                    disabled: !rows.length,
                    disabledReason: rows.length ? undefined : 'No step matches the search',
                  },
                ]}
                onAction={onExport}
              />
            </span>
          </div>
        </div>
        {rows.length ? (
          <ChartTooltipHost>
            <div className={styles.scroller}>
              <div role="table" aria-label={tableLabel} className={styles.table}>
                <div role="row" className={`${styles.row} ${styles.axisRow}`}>
                  {byKind ? (
                    <div role="columnheader" className={styles.stepHead}>
                      Kind
                    </div>
                  ) : (
                    head('order', model.perTrace ? 'Step · trace order' : 'Step', styles.stepHead)
                  )}
                  <div
                    role="columnheader"
                    className={styles.cell}
                    aria-label={model.perTrace ? 'Time in one trace' : 'Time of one call'}
                  >
                    <div className={styles.ticks}>
                      {axis.ticks.map((t) => (
                        <span key={t} style={cssVars({ '--x': axis.x(t) })}>
                          {tickLabel(t)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {head('med', 'Median', styles.num)}
                  {head('calls', 'Calls / trace', styles.num)}
                  {head('time', 'Time / trace', styles.num)}
                  {head('err', 'Errors', styles.num)}
                </div>
                {rows.map(({ node, depth, isGroup, open }) => {
                  const st = node.stats;
                  const perTrace = model.traces ? node.calls / model.traces : 0;
                  const flashed = !!flash && flash.ids.has(node.id);
                  const models = node.models.filter((m) => m !== node.name);
                  const text = (
                    <span className={styles.text}>
                      <span className={styles.labelText}>
                        <Highlight text={node.name} query={view.query} />
                        {models.length ? (
                          <>
                            {' '}
                            <small>
                              <Highlight text={models.join(' · ')} query={view.query} />
                            </small>
                          </>
                        ) : null}
                        {isGroup && byKind ? (
                          <CountTile className={styles.count}>{node.children!.length}</CountTile>
                        ) : null}
                      </span>
                      {node.facts ? <span className={styles.fact}>{node.facts}</span> : null}
                    </span>
                  );
                  const indent = cssVars({ '--depth': depth });
                  return (
                    <div
                      key={flashed ? `${node.id}#${flash.n}` : node.id}
                      role="row"
                      className={styles.row}
                      data-group={isGroup ? '' : undefined}
                      data-words={node.words ? '' : undefined}
                      data-flash={flashed ? '' : undefined}
                      data-id={node.id}
                    >
                      <div role="cell" className={styles.cell}>
                        {isGroup ? (
                          <button
                            type="button"
                            className={styles.label}
                            style={indent}
                            aria-expanded={open}
                            onClick={() => toggle(node.id, open)}
                          >
                            <Icon name="chevron-right" size={12} className={styles.chev} />
                            <Glyph icon={stepIcon(node)} tone={stepTone(node)} small />
                            {text}
                          </button>
                        ) : (
                          <div className={styles.label} style={indent}>
                            <span className={styles.chevSpace} />
                            <Glyph icon={stepIcon(node)} tone={stepTone(node)} small />
                            {text}
                          </div>
                        )}
                      </div>
                      <div role="cell" className={styles.cell}>
                        <Track
                          node={node}
                          axis={axis}
                          traces={model.traces}
                          perTrace={model.perTrace}
                          byKind={byKind}
                        />
                      </div>
                      <div role="cell" className={`${styles.num} ${styles.key}`}>
                        {fmtMs(st.med)}
                      </div>
                      <div role="cell" className={styles.num}>
                        {perTrace.toFixed(perTrace >= 10 ? 0 : 1)}
                      </div>
                      <div role="cell" className={styles.num}>
                        {/* A step whose calls all failed has no time: a dash, not "0ms". */}
                        {st.n ? fmtMs(node.perTrace) : <span className={styles.none}>–</span>}
                      </div>
                      <div role="cell" className={styles.num}>
                        {st.err ? (
                          <Tag kind="count" tone="danger">
                            {fmtInt(st.err)}
                          </Tag>
                        ) : (
                          <span className={styles.none}>–</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartTooltipHost>
        ) : (
          <div className={styles.empty}>No step matches “{view.query}”.</div>
        )}
        <div className={styles.foot}>
          <span className={styles.legendKey}>
            <i className={styles.kWhisker} aria-hidden="true" />
            p5–p95
          </span>
          <span className={styles.legendKey}>
            <i className={styles.kBox} aria-hidden="true" />
            middle 50%
          </span>
          <span className={styles.legendKey}>
            <i className={styles.kMed} aria-hidden="true" />
            median
          </span>
          <span className={styles.legendKey}>
            <i className={styles.kMean} aria-hidden="true" />
            mean
          </span>
          <span className={styles.note}>{caption}</span>
        </div>
      </div>
    </Card>
  );
});
