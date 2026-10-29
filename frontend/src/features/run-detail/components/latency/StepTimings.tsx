/**
 * Step timings card (legacy renderSteps): how long one call of each step takes and how much it varies. Rows are the
 * phases, then the sub-agents and call sites inside them; the plot shares one time axis (Linear or Log) across every
 * visible row. Sort by Median, Calls / trace, Time / trace (default) or Errors.
 */
import { forwardRef, useMemo, type Dispatch, type SetStateAction } from 'react';
import { stepLatencyUrl } from '@/api/runs';
import { platformUrl } from '@/lib/runtime';
import {
  Button,
  Card,
  ChartTooltipHost,
  DropdownMenu,
  Icon,
  SearchField,
  SegmentedControl,
  Text,
  useMarkTip,
} from '@/ui';
import {
  buildStepsTree,
  callsPerTrace,
  countLeaves,
  durText,
  flattenSteps,
  fmtK,
  fmtMs,
  pct,
  PHASE_LABEL,
  stepsAxis,
  stepsSvg,
  stepTone,
  tickLabel,
  timePerTrace,
  type LatencyData,
  type StepNode,
  type StepSortKey,
  type StepsAxis,
} from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { Glyph, nodeGlyph } from './kinds';
import { TipBody, cssVars } from './Tip';
import styles from './Steps.module.css';

export interface StepsView {
  group: 'step' | 'kind';
  scale: 'linear' | 'log';
  query: string;
  open: ReadonlySet<string>;
  sort: { key: StepSortKey; dir: 1 | -1 };
}

export const STEPS_VIEW: StepsView = {
  group: 'step',
  // Spans (tens of seconds) and calls (milliseconds) share one axis: Log keeps both readable.
  scale: 'log',
  query: '',
  open: new Set(),
  sort: { key: 'time', dir: -1 },
};

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

function trackTip(node: StepNode, traces: number) {
  const st = node.stats;
  const title =
    node.type === 'phase'
      ? `${node.label} span`
      : node.type === 'agent'
        ? `${node.label} (sub-agent span)`
        : node.label + (node.model && node.model !== node.label ? ` · ${node.model}` : '');
  const kind =
    node.type === 'step'
      ? String(node.kind ?? '').toLowerCase()
      : node.type === 'agent'
        ? 'agent'
        : `${PHASE_LABEL[node.phase].toLowerCase()} phase`;
  const rows: Array<[string, string]> = [
    ['Kind', kind],
    ['p5 · p25', `${fmtMs(st.p5)} · ${fmtMs(st.p25)}`],
    ['Median', fmtMs(st.med)],
    ['Mean', fmtMs(st.mean)],
    ['p75 · p95', `${fmtMs(st.p75)} · ${fmtMs(st.p95)}`],
    ['Calls', fmtInt(st.n + st.err)],
    ['Errors', st.err ? `${fmtInt(st.err)} (${pct(st.err, st.n + st.err).toFixed(1)}%)` : '—'],
  ];
  if (st.tok && traces) rows.push(['Tokens / trace', fmtK(st.tok / traces)]);
  return <TipBody title={title} rows={rows} />;
}

function Track({ node, axis, traces }: { node: StepNode; axis: StepsAxis; traces: number }) {
  const st = node.stats;
  const { handlers, describedBy } = useMarkTip(trackTip(node, traces));
  const timed = Number.isFinite(st.med);
  return (
    <div
      className={styles.track}
      role="img"
      aria-label={
        timed ? `p5 ${durText(st.p5)}, median ${durText(st.med)}, p95 ${durText(st.p95)}` : 'no timing'
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
  const { runId, model } = useRunPage();
  const tree = useMemo(
    () => buildStepsTree(D, { group: view.group, query: view.query }),
    [D, view.group, view.query],
  );
  const rows = useMemo(() => flattenSteps(D, tree, view.open, view.sort), [D, tree, view.open, view.sort]);
  const axis = useMemo(() => stepsAxis(rows, view.scale), [rows, view.scale]);
  const patch = (p: Partial<StepsView>) => setView((v) => ({ ...v, ...p }));
  const toggle = (id: string) =>
    setView((v) => {
      const open = new Set(v.open);
      if (open.has(id)) open.delete(id);
      else open.add(id);
      return { ...v, open };
    });
  const sortBy = (key: StepSortKey) =>
    setView((v) => ({ ...v, sort: { key, dir: v.sort.key === key ? (-v.sort.dir as 1 | -1) : -1 } }));
  const ariaSort = (key: StepSortKey) =>
    view.sort.key === key ? (view.sort.dir < 0 ? 'descending' : 'ascending') : 'none';
  const csv = (extra: string) => platformUrl(stepLatencyUrl(runId, model.viewPass, `&format=csv${extra}`));
  const onExport = (id: string) => {
    if (id === 'csv-summary') download(csv(''), 'step_timings.csv');
    else if (id === 'csv-spans') download(csv('&level=spans'), 'step_timings_spans.csv');
    else if (id === 'svg') {
      const host = document.querySelector('[data-testid="latency-panel"]') ?? document.documentElement;
      const cs = getComputedStyle(host);
      const color = (token: string) => {
        const m = /^var\((--[\w-]+)\)$/.exec(token.trim());
        return (m ? cs.getPropertyValue(m[1]!).trim() : token) || 'gray';
      };
      const url = URL.createObjectURL(new Blob([stepsSvg(rows, axis, color)], { type: 'image/svg+xml' }));
      download(url, 'step_timings.svg');
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  const head = (key: StepSortKey, label: string) => (
    <div role="columnheader" className={styles.num} aria-sort={ariaSort(key)}>
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
  return (
    <Card as="section" ref={ref} id="lt-steps" className={styles.box} aria-label="Step timings">
      <div className={styles.inner}>
        <div className={styles.head}>
          <div className={styles.titles}>
            <Text variant="md" weight={600} as="h4" className={styles.title}>
              Step timings
            </Text>
            <Text variant="sm" tone="muted" as="p" className={styles.desc}>
              How long one call of each step takes, and how much it varies.
            </Text>
          </div>
          <div className={styles.tools}>
            <SearchField
              label="Find a step or model"
              hideLabel
              placeholder="Find a step or model"
              value={view.query}
              onChange={(query) => patch({ query })}
              onClear={() => patch({ query: '' })}
              width={200}
            />
            <SegmentedControl
              label="Group steps"
              options={[
                { value: 'step', label: 'By step' },
                { value: 'kind', label: 'By kind' },
              ]}
              value={view.group}
              onChange={(group) => patch({ group })}
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
            <DropdownMenu
              label="Export step timings"
              trigger={
                <Button variant="accent" icon={<Icon name="download" size={12} />}>
                  Export
                </Button>
              }
              items={[
                { id: 'csv-summary', label: 'CSV summary' },
                { id: 'csv-spans', label: 'CSV raw spans' },
                { id: 'svg', label: 'SVG plot', disabled: !rows.length },
              ]}
              onAction={onExport}
            />
          </div>
        </div>
        {tree.length ? (
          <ChartTooltipHost>
            <div className={styles.scroller}>
              <div role="table" aria-label="Step latency by call site" className={styles.table}>
                <div role="row" className={`${styles.row} ${styles.axisRow}`}>
                  <div role="columnheader" className={styles.stepHead}>
                    {view.group === 'kind' ? 'Kind' : 'Step'}
                  </div>
                  <div role="columnheader" className={styles.cell} aria-label="Time axis">
                    <div className={styles.ticks}>
                      {axis.ticks.map((t) => (
                        <span key={t} style={cssVars({ '--x': axis.x(t) })}>
                          {tickLabel(t)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {head('med', 'Median')}
                  {head('calls', 'Calls / trace')}
                  {head('time', 'Time / trace')}
                  {head('err', 'Errors')}
                </div>
                {rows.map(({ node, depth, isGroup, open }) => {
                  const st = node.stats;
                  const glyph = nodeGlyph(node);
                  const perTrace = callsPerTrace(node, D.traces);
                  const flashed = !!flash && flash.ids.has(node.id);
                  const showModel = !!node.model && view.group === 'step' && node.model !== node.label;
                  const text = (
                    <span className={styles.labelText}>
                      <Highlight text={node.label} query={view.query} />
                      {showModel ? (
                        <>
                          {' '}
                          <small>
                            <Highlight text={node.model!} query={view.query} />
                          </small>
                        </>
                      ) : null}
                      {isGroup ? <span className={styles.count}>{countLeaves(node)}</span> : null}
                    </span>
                  );
                  return (
                    <div
                      key={flashed ? `${node.id}#${flash.n}` : node.id}
                      role="row"
                      className={styles.row}
                      data-group={isGroup ? '' : undefined}
                      data-phase={node.type === 'phase' ? '' : undefined}
                      data-words={isGroup || node.family ? '' : undefined}
                      data-flash={flashed ? '' : undefined}
                      data-id={node.id}
                    >
                      <div role="cell" className={styles.cell}>
                        {isGroup ? (
                          <button
                            type="button"
                            className={styles.label}
                            style={cssVars({ '--depth': depth })}
                            aria-expanded={open}
                            onClick={() => toggle(node.id)}
                          >
                            <Icon name="chevron-right" size={14} className={styles.chev} />
                            <Glyph icon={glyph.icon} tone={glyph.tone} small />
                            {text}
                          </button>
                        ) : (
                          <div className={styles.label} style={cssVars({ '--depth': depth })}>
                            <span className={styles.chevSpace} />
                            <Glyph icon={glyph.icon} tone={glyph.tone} small />
                            {text}
                          </div>
                        )}
                      </div>
                      <div role="cell" className={styles.cell}>
                        <Track node={node} axis={axis} traces={D.traces} />
                      </div>
                      <div role="cell" className={`${styles.num} ${styles.key}`}>
                        {fmtMs(st.med)}
                      </div>
                      <div role="cell" className={styles.num}>
                        {perTrace.toFixed(perTrace >= 10 ? 0 : 1)}
                      </div>
                      <div role="cell" className={styles.num}>
                        {fmtMs(timePerTrace(node, D.traces))}
                      </div>
                      <div role="cell" className={styles.num}>
                        {st.err ? (
                          <span className={styles.errPill}>{fmtInt(st.err)}</span>
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
          <span className={styles.note}>Errors are counted, not timed.</span>
        </div>
      </div>
    </Card>
  );
});
