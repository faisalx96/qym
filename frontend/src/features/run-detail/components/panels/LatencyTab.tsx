/** Latency and traces: response-time distribution (filters the page), quality vs latency, time budget, call sites, steps plot (brief 04 J5). */
import { useMemo, useState } from 'react';
import { useStepLatencyQuery, stepLatencyUrl } from '@/api/runs';
import { platformUrl } from '@/lib/runtime';
import { formatPercent, isErrorRow, isNotReceivedRow } from '@/lib/metrics';
import {
  Button,
  Card,
  ChartTooltipHost,
  Chip,
  ErrorState,
  Icon,
  Mark,
  SearchField,
  SegmentedControl,
  Skeleton,
  useEntrance,
} from '@/ui';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import {
  budgetSegments,
  buildStepsTree,
  durText,
  FAMILY_LABEL,
  FAMILY_ORDER,
  FAMILY_TONE,
  flattenSteps,
  kindPanels,
  latencyFilterLabel,
  latencyHistogram,
  latencySummary,
  normalizeLatency,
  pct,
  stepsAxis,
  stepTone,
  tickLabel,
  type LatencyItem,
  type StepSortKey,
} from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { Scatter, type ScatterPoint, type ScatterQuadrants } from '../charts/Charts';
import styles from './Latency.module.css';
import panel from './Panels.module.css';

function ResponseTime({ items }: { items: LatencyItem[] }) {
  const { api } = useRunPage();
  const filter = api.view.filters.latency;
  const L = useMemo(() => latencySummary(items), [items]);
  const H = useMemo(() => (L ? latencyHistogram(items, L) : null), [items, L]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const enter = useEntrance();
  if (!L || !H) return <p className={panel.note}>No latency recorded for the current items.</p>;
  const apply = (a: number, b: number) => api.setFilters({ latency: { min: a, max: b } });
  const pickBin = (i: number, extend: boolean) => {
    const from = extend && anchor !== null ? Math.min(anchor, i) : i;
    const to = extend && anchor !== null ? Math.max(anchor, i) : i;
    const sel = filter && filter.min === H.bins[from]!.a && filter.max === H.bins[to]!.b;
    setAnchor(i);
    if (sel) api.setFilters({ latency: null });
    else apply(H.bins[from]!.a, H.bins[to]!.b);
  };
  const pins = [
    { key: 'p50', ms: L.p50, tone: 'var(--text-primary)' },
    { key: 'p90', ms: L.p90, tone: 'var(--score-3)' },
    { key: 'p95', ms: L.p95, tone: 'var(--score-2)' },
  ];
  return (
    <section className={panel.stack} aria-label="Response time">
      <h3 className={panel.groupTitle}>Response time</h3>
      <div className={styles.kpis}>
        <div>
          <div className={styles.eyebrow}>Mean</div>
          <div className={styles.hero}>{durText(L.mean)}</div>
          <div className={panel.note}>across {L.count.toLocaleString('en-US')} items</div>
        </div>
        <div className={styles.pins} role="group" aria-label="Latency percentiles">
          {pins.map((p) => (
            <button
              key={p.key}
              type="button"
              className={styles.pin}
              style={{ borderColor: p.tone }}
              onClick={() => apply(p.ms, Infinity)}
              aria-label={`${p.key} ${durText(p.ms)}, filter to items at or above`}
              title="Click to filter the page to items at or above"
            >
              <em>{p.key}</em> <b>{durText(p.ms)}</b>
            </button>
          ))}
        </div>
      </div>
      <ChartTooltipHost
        className={styles.hist}
        role="group"
        aria-label="Latency histogram, click a bar or shift-click to extend the range"
      >
        {H.bins.map((b, i) => {
          const n = b.items.length;
          const inRange = !filter || (b.b > filter.min && b.a < filter.max);
          const tip = `${tickLabel(b.a)}–${tickLabel(b.b)}: ${n} items (${pct(n, items.length).toFixed(0)}%)${b.errors ? `, ${b.errors} task errors` : ''}`;
          return (
            <Mark
              key={i}
              as="button"
              className={styles.bin}
              data-tone={b.tone ?? undefined}
              data-out={!inRange || undefined}
              isDisabled={n === 0}
              tip={tip}
              aria-label={`${tickLabel(b.a)} to ${tickLabel(b.b)}: ${n} items`}
              isSelected={!!filter && inRange}
              onPick={(e) => pickBin(i, Boolean((e as React.MouseEvent | undefined)?.shiftKey))}
            >
              <span
                className={styles.binBar}
                data-enter={enter ? '' : undefined}
                style={
                  {
                    height: n ? `${Math.max(4, (100 * n) / H.max)}%` : 0,
                    '--i': Math.min(i, 10),
                  } as React.CSSProperties
                }
              >
                {b.errors ? (
                  <span className={styles.binErr} style={{ height: `${(100 * b.errors) / n}%` }} />
                ) : null}
              </span>
            </Mark>
          );
        })}
      </ChartTooltipHost>
      <div className={styles.axis} aria-hidden="true">
        {H.ticks.map((t) => (
          <span key={t} style={{ insetInlineStart: `${H.xPct(t)}%` }}>
            {tickLabel(t)}
          </span>
        ))}
      </div>
      {filter ? (
        <Chip
          isSelected
          removeLabel="Clear latency filter"
          onRemove={() => api.setFilters({ latency: null })}
        >
          {latencyFilterLabel(filter)}
        </Chip>
      ) : null}
    </section>
  );
}

function QualityLatency({ items, metric }: { items: LatencyItem[]; metric: string }) {
  const { api } = useRunPage();
  const direction = api.ctx.model.metricDirections[metric] ?? null;
  const points: ScatterPoint[] = items
    .filter((i) => i.score !== null || i.error)
    .map((i) => ({
      id: i.itemId,
      x: i.latency,
      y: i.error ? 0 : (i.score as number),
      outcome: i.error
        ? ('error' as const)
        : i.passed === null
          ? null
          : i.passed
            ? ('pass' as const)
            : ('fail' as const),
    }));
  if (points.filter((p) => p.outcome !== 'error').length < 2) return null;
  const sorted = items.map((i) => i.latency).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const quadrants: ScatterQuadrants | undefined =
    direction === 'maximize' || direction === 'minimize'
      ? {
          x: median,
          y: 0.5,
          goodIsHighY: direction === 'maximize',
          goodLabel: 'Fast and passing',
          badLabel: 'Slow and failing',
        }
      : undefined;
  return (
    <section className={panel.stack} aria-label="Quality versus latency">
      <h3 className={panel.groupTitle}>
        Quality vs latency <span className={panel.note}>{metric}</span>
      </h3>
      <p className={panel.note}>
        One dot per item; task errors sit on the axis as open rings. Select a dot to open the item.
      </p>
      <Scatter
        points={points}
        quadrants={quadrants}
        xLabel="latency"
        yLabel={metric}
        onPick={(id) => api.setItemParam(id)}
        fmt={(v) => String(Math.round(v * 100) / 100)}
        fmtX={(v) => tickLabel(v)}
        fmtY={(v) => formatPercent(v, 0)}
      />
    </section>
  );
}

function TimeBudget({ D }: { D: ReturnType<typeof normalizeLatency> }) {
  const segs = useMemo(() => budgetSegments(D), [D]);
  const total = segs.reduce((t, s) => t + s.ms, 0);
  const byFamily = useMemo(() => {
    const m: Record<string, number> = {};
    segs.forEach((s) => (m[s.family] = (m[s.family] ?? 0) + s.ms));
    return m;
  }, [segs]);
  if (!D.traces || !segs.length) return null;
  return (
    <section className={panel.stack} aria-label="Time budget">
      <h3 className={panel.groupTitle}>Time budget</h3>
      <p className={panel.note}>
        Average trace <b className={panel.stat}>{durText(D.avgTrace ?? total)}</b> ·{' '}
        {D.traces.toLocaleString('en-US')} traces
        {D.failed ? <span className={styles.failPill}> {D.failed} failed</span> : null}
      </p>
      <ChartTooltipHost
        className={styles.budget}
        role="img"
        aria-label={`Time budget of an average trace: ${FAMILY_ORDER.filter((f) => byFamily[f])
          .map((f) => `${FAMILY_LABEL[f]} ${durText(byFamily[f]!)}`)
          .join(', ')}`}
      >
        {segs.map((s, i) => (
          <Mark
            key={i}
            className={styles.seg}
            style={{ flexGrow: s.ms, background: FAMILY_TONE[s.family] }}
            tip={`${s.phase === 'eval' ? 'Eval' : (s.agent ?? 'Agent')} · ${FAMILY_LABEL[s.family]}${s.overhead ? ' · overhead' : ''}: ${durText(s.ms)} (${pct(s.ms, total).toFixed(1)}%)`}
            tabIndex={-1}
          />
        ))}
      </ChartTooltipHost>
      <ul className={panel.note + ' ' + styles.legend}>
        {FAMILY_ORDER.filter((f) => byFamily[f]).map((f) => (
          <li key={f}>
            <span className={styles.swatch} style={{ background: FAMILY_TONE[f] }} aria-hidden="true" />
            {FAMILY_LABEL[f]} <b>{durText(byFamily[f]!)}</b> {pct(byFamily[f]!, total).toFixed(0)}%
          </li>
        ))}
      </ul>
    </section>
  );
}

function Kinds({ D }: { D: ReturnType<typeof normalizeLatency> }) {
  const panels = useMemo(() => kindPanels(D), [D]);
  if (!panels.length) return null;
  return (
    <div className={styles.kinds}>
      {panels.map((p) => (
        <Card as="section" compact key={p.family} aria-label={FAMILY_LABEL[p.family]}>
          <header className={styles.kindHead}>
            <span
              className={styles.swatch}
              style={{ background: FAMILY_TONE[p.family] }}
              aria-hidden="true"
            />
            <b>{FAMILY_LABEL[p.family]}</b>
            <span className={panel.note}>
              {p.rows.length} {p.unitWord}
            </span>
          </header>
          <dl className={styles.kindStats}>
            {p.stats.map((s) => (
              <div key={s.key}>
                <dt>{s.label}</dt>
                <dd>
                  {s.value}
                  {s.unit ? <small>{s.unit}</small> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}

function groupIds(tree: ReturnType<typeof buildStepsTree>): string[] {
  const out: string[] = [];
  const walk = (nodes: ReturnType<typeof buildStepsTree>) =>
    nodes.forEach((n) => {
      if (n.children) {
        out.push(n.id);
        walk(n.children);
      }
    });
  walk(tree);
  return out;
}

function Steps({ D }: { D: ReturnType<typeof normalizeLatency> }) {
  const { runId, model } = useRunPage();
  const [group, setGroup] = useState<'step' | 'kind'>('step');
  const [scale, setScale] = useState<'linear' | 'log'>('linear');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<{ key: StepSortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });
  const tree = useMemo(() => buildStepsTree(D, { group, query }), [D, group, query]);
  const rows = useMemo(() => flattenSteps(D, tree, open, sort), [D, tree, open, sort]);
  const axis = useMemo(() => stepsAxis(rows, scale), [rows, scale]);
  if (!D.steps.length) return null;
  const csv = (extra: string) => platformUrl(stepLatencyUrl(runId, model.viewPass, `&format=csv${extra}`));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className={panel.stack} aria-label="Steps">
      <h3 className={panel.groupTitle}>Steps</h3>
      <div className={panel.controls}>
        <SegmentedControl
          label="Group steps"
          options={[
            { value: 'step', label: 'By step' },
            { value: 'kind', label: 'By kind' },
          ]}
          value={group}
          onChange={setGroup}
        />
        <SegmentedControl
          label="Axis scale"
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'log', label: 'Log' },
          ]}
          value={scale}
          onChange={setScale}
        />
        <Button
          size="sm"
          variant="neutral"
          onPress={() => setOpen(new Set(groupIds(tree)))}
          aria-label="Expand all steps"
        >
          Expand all
        </Button>
        <Button
          size="sm"
          variant="neutral"
          onPress={() => setOpen(new Set())}
          aria-label="Collapse all steps"
        >
          Collapse all
        </Button>
        <SearchField
          label="Search steps"
          hideLabel
          placeholder="Search steps…"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          width="18ch"
        />
      </div>
      <div className={styles.csv}>
        <a href={csv('')} download>
          <Icon name="external" size={12} /> Summary CSV
        </a>
        <a href={csv('&level=spans')} download>
          <Icon name="external" size={12} /> Spans CSV
        </a>
      </div>
      <div className={styles.steps} role="table" aria-label="Step latency by call site">
        <div className={styles.stepsHead} role="row">
          <span role="columnheader">Step</span>
          <span
            role="columnheader"
            aria-sort={sort.key === 'calls' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
          >
            <button
              type="button"
              onClick={() =>
                setSort((s) => ({ key: 'calls', dir: s.key === 'calls' ? (-s.dir as 1 | -1) : -1 }))
              }
            >
              Calls
            </button>
          </span>
          <span
            role="columnheader"
            aria-sort={sort.key === 'time' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
          >
            <button
              type="button"
              onClick={() =>
                setSort((s) => ({ key: 'time', dir: s.key === 'time' ? (-s.dir as 1 | -1) : -1 }))
              }
            >
              Time / trace
            </button>
          </span>
          <span role="columnheader">p5 · median · p95</span>
        </div>
        {rows.map(({ node, depth, isGroup, open: isOpen }) => {
          const st = node.stats;
          const tone = stepTone(node);
          return (
            <div
              key={node.id}
              className={styles.stepRow}
              role="row"
              style={{ paddingInlineStart: `calc(${depth} * var(--space-md))` }}
            >
              <span role="cell" className={styles.stepName}>
                {isGroup ? (
                  <button
                    type="button"
                    className={styles.groupToggle}
                    aria-expanded={isOpen}
                    onClick={() => toggle(node.id)}
                  >
                    <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                    {node.label}
                  </button>
                ) : (
                  <span title={node.model ?? undefined}>{node.label}</span>
                )}
                {node.model ? <small className={panel.note}>{node.model}</small> : null}
              </span>
              <span role="cell" className={`${panel.stat} ${styles.nowrap}`}>
                {st.n + st.err}
                {st.err ? <small className={styles.err}> · {st.err} err</small> : null}
              </span>
              <span role="cell" className={panel.stat}>
                {Number.isFinite(st.mean) && D.traces
                  ? durText(node.type === 'phase' ? st.mean : (st.mean * st.n) / D.traces)
                  : '—'}
              </span>
              <span
                role="cell"
                className={styles.interval}
                aria-label={
                  Number.isFinite(st.med)
                    ? `p5 ${durText(st.p5)}, median ${durText(st.med)}, p95 ${durText(st.p95)}`
                    : 'no timing'
                }
              >
                {Number.isFinite(st.med) ? (
                  <>
                    <span
                      className={styles.whisker}
                      style={{
                        insetInlineStart: `${axis.x(st.p5)}%`,
                        width: `${Math.max(0.5, axis.x(st.p95) - axis.x(st.p5))}%`,
                        background: tone,
                      }}
                    />
                    <span
                      className={styles.box}
                      style={{
                        insetInlineStart: `${axis.x(st.p25)}%`,
                        width: `${Math.max(0.8, axis.x(st.p75) - axis.x(st.p25))}%`,
                        background: tone,
                      }}
                    />
                    <span className={styles.median} style={{ insetInlineStart: `${axis.x(st.med)}%` }} />
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
        <div className={styles.axisRow} aria-hidden="true">
          {axis.ticks.map((t) => (
            <span key={t} style={{ insetInlineStart: `${axis.x(t)}%` }}>
              {tickLabel(t)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LatencyTab() {
  const { items, api, runId, model, payload } = useRunPage();
  const metric = api.selectedMetric;
  const hasSpans =
    !!(model.viewPass ? null : payload.run.trace_stats?.has_spans) ||
    payload.run.trace_stats?.has_spans === true;
  const query = useStepLatencyQuery(runId, model.viewPass, hasSpans);
  const latencyItems = useMemo<LatencyItem[]>(
    () =>
      items
        .filter(
          ({ row }) =>
            Number.isFinite(row.latency_ms) && (row.latency_ms ?? -1) >= 0 && !isNotReceivedRow(row),
        )
        .map(({ row, score }) => {
          const idx = metric ? model.metricNames.indexOf(metric) : -1;
          const outcome = idx >= 0 && metric ? rowScoreFor(api.ctx, row, idx, metric) : null;
          return {
            itemId: row.item_id,
            latency: row.latency_ms as number,
            error: isErrorRow(row),
            score,
            passed: outcome && metric ? rowPassesFor(api.ctx, metric, outcome) : null,
          };
        })
        .filter((i) => i.latency > 0),
    [items, metric, model.metricNames, api.ctx],
  );
  const D = useMemo(() => (query.data ? normalizeLatency(query.data) : null), [query.data]);
  if (!latencyItems.length && !hasSpans)
    return <p className={panel.note}>No latency or trace data for this run.</p>;
  return (
    <div className={`${panel.stack} ${styles.root}`} data-testid="latency-panel">
      <div className={`${panel.twoUp} ${panel.pair}`}>
        <ResponseTime items={latencyItems} />
        {metric ? <QualityLatency items={latencyItems} metric={metric} /> : null}
      </div>
      {hasSpans ? (
        <>
          <h3 className={panel.groupTitle}>Inside the traces</h3>
          {query.isPending ? <Skeleton kind="cards" count={1} label="Loading trace timings" /> : null}
          {query.isError ? (
            <ErrorState
              compact
              error={query.error}
              title="Trace timings did not load"
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {D ? (
            <>
              <TimeBudget D={D} />
              <Kinds D={D} />
              <Steps D={D} />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
