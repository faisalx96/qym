/**
 * Chart marks for the analysis panel (dataviz rules: tokens only, 2px surface
 * gaps, 4px rounded data ends, every mark a real button with an accessible
 * name, a text legend next to colour). All colours are design tokens.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MetricDirection } from '@/lib/metrics';
import { metricBand } from '@/lib/metrics';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { staggerIndex, useEntrance } from '@/ui/motion';
import { bucketTone, type BoolSegment, type ScoreBucket } from '../../lib/overviewModel';
import { COLUMN_GAP, axisLabelShown, columnPitch, countText, isDenseCounts } from './chartLabels';
import styles from './Charts.module.css';

/** Width of an element in CSS px (ResizeObserver); `fallback` until measured. Charts draw at this width so text and marks keep their size. */
export function useMeasuredWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, width];
}

const SEGMENT_TONE: Record<BoolSegment['tone'], string> = {
  pass: 'var(--score-5)',
  fail: 'var(--score-1)',
  true: 'var(--chart-2)',
  false: 'var(--chart-5)',
  error: 'var(--metric-error)',
};

/** One column of the bar plot: a count on top of a bar, an axis label under it, an optional sub label. */
export interface BarSpec {
  key: string | number;
  count: number;
  /** Axis label under the baseline. */
  label: string;
  /** Second line under the axis label (mono, muted): a percentage. */
  sub?: string;
  /** Bar fill: a token expression such as `var(--score-5)`. */
  color: string;
  /** Share (0..1) of the bar drawn as the error hatch. */
  errShare?: number;
  tip?: ReactNode;
  /** Accessible name of the column (button or image). */
  name: string;
  onPick?: (e?: React.SyntheticEvent) => void;
  selected?: boolean;
  /** A button that cannot act (nothing to filter): drawn disabled, count still printed. */
  disabled?: boolean;
  /** Print `0` (pass/fail bars, passes passed) or nothing (score histogram) for an empty column. */
  zero: 'hide' | 'show';
  /** Small note under the axis label that is part of the label, e.g. "always fail". */
  note?: string;
  /** Drawn faded (outside the active range filter). */
  dim?: boolean;
  /** Not a button even when `onPick` is set (an empty histogram bucket). */
  passive?: boolean;
  data?: Record<`data-${string}`, string | number>;
}

/**
 * The one column recipe of every bar chart (round 5 R1: well and foot). A column is a two-row grid:
 * the well (spacer `1 - p`, count, bar `p`; its bottom border is the x axis) and a foot of one constant height
 * (axis label, note, sub label). The foot is rendered for every column, a thinned label as a blank line, so no column
 * can end higher or lower than its neighbours and every bar bottom is the axis line.
 * The count and axis text come from `data-text` (drawn by CSS) so the column's accessible name stays its `name`.
 */
export function BarColumns({
  bars,
  name,
  axis = true,
  className,
}: {
  bars: BarSpec[];
  name: string;
  /** Per-column axis labels; false when the plot has its own axis (latency bins). */
  axis?: boolean;
  className?: string;
}) {
  const [boxRef, width] = useMeasuredWidth<HTMLDivElement>(280);
  const enter = useEntrance();
  const max = Math.max(1, ...bars.map((b) => b.count));
  const pitch = columnPitch(bars.length, width);
  const colWidth = pitch - COLUMN_GAP;
  const showAxis = axisLabelShown(
    bars.map((b) => b.label),
    width,
  );
  const digits = Math.max(1, ...bars.map((b) => countText(b.count, colWidth, b.zero).length));
  const dense = isDenseCounts(pitch, digits);
  const rows = axis ? 1 + (bars.some((b) => b.note) ? 1 : 0) + (bars.some((b) => b.sub) ? 1 : 0) : 0;
  const foot = axis ? 4 + 14 * rows : 4;
  return (
    <div ref={boxRef} className={styles.plotBox}>
      <ChartTooltipHost
        className={[styles.plot, className].filter(Boolean).join(' ')}
        role="group"
        aria-label={name}
        data-dense={dense ? '' : undefined}
        style={{ '--foot': `${foot}px` } as React.CSSProperties}
      >
        {bars.map((b, i) => {
          const text = countText(b.count, colWidth, b.zero);
          const inner = (
            <>
              <span className={styles.well} data-part="well">
                <span
                  className={styles.count}
                  data-part="count"
                  aria-hidden="true"
                  data-text={text}
                  data-zero={b.count === 0 ? '' : undefined}
                  data-enter={enter ? '' : undefined}
                  style={{ '--i': staggerIndex(i) } as React.CSSProperties}
                />
                <span
                  className={styles.bar}
                  data-part="bar"
                  data-enter={enter ? '' : undefined}
                  style={{ background: b.color, '--i': staggerIndex(i) } as React.CSSProperties}
                >
                  {b.errShare ? (
                    <span className={styles.barErr} style={{ height: `${Math.min(1, b.errShare) * 100}%` }} />
                  ) : null}
                </span>
              </span>
              <span className={styles.foot} data-part="foot" aria-hidden="true">
                {axis ? (
                  <>
                    <span
                      className={styles.axis}
                      data-part="axis"
                      data-text={showAxis[i] ? b.label : '\u00a0'}
                    />
                    {bars.some((x) => x.note) ? (
                      <small className={styles.axisNote} data-part="note">
                        {b.note ?? '\u00a0'}
                      </small>
                    ) : null}
                    {bars.some((x) => x.sub) ? (
                      <span className={styles.axisSub} data-part="sub" data-text={b.sub ?? '\u00a0'} />
                    ) : null}
                  </>
                ) : null}
              </span>
            </>
          );
          const style = { '--p': b.count / max } as React.CSSProperties;
          const zero = b.count === 0 ? '' : undefined;
          const dim = b.dim ? '' : undefined;
          const tier = dense && i % 2 === 1 ? '2' : undefined;
          if (b.onPick && !b.passive) {
            return (
              <Mark
                key={b.key}
                as="button"
                className={styles.col}
                style={style}
                data-zero={zero}
                data-out={dim}
                data-tier={tier}
                tip={b.tip}
                aria-label={b.name}
                isSelected={b.selected}
                isDisabled={b.disabled}
                onPick={b.onPick}
                {...b.data}
              >
                {inner}
              </Mark>
            );
          }
          return b.tip !== undefined && !b.passive ? (
            <Mark
              key={b.key}
              className={styles.col}
              style={style}
              data-zero={zero}
              data-out={dim}
              data-tier={tier}
              tip={b.tip}
              role="img"
              aria-label={b.name}
              {...b.data}
            >
              {inner}
            </Mark>
          ) : (
            <span
              key={b.key}
              className={styles.col}
              style={style}
              data-zero={zero}
              data-out={dim}
              data-tier={tier}
              data-empty="true"
              {...b.data}
            >
              {inner}
            </span>
          );
        })}
      </ChartTooltipHost>
    </div>
  );
}

/** Pass / Fail / Error columns of a boolean metric (replaces the thin split bar): same plot as the histograms. */
export function BoolBars({
  segments,
  total,
  metric,
  onPick,
}: {
  segments: BoolSegment[];
  total: number;
  metric: string;
  onPick: (seg: BoolSegment) => void;
}) {
  const bars: BarSpec[] = segments.map((s) => {
    const clickable = s.key === 'passed' || s.key === 'failed' || s.key === 'metric_errors';
    return {
      key: s.key,
      count: s.count,
      label: s.label,
      sub: `${total ? Math.round((s.count / total) * 100) : 0}%`,
      color: SEGMENT_TONE[s.tone],
      tip: s.title,
      name: `${s.label}: ${s.count} of ${total} items${clickable ? ', filter the table' : ''}`,
      onPick: clickable ? () => onPick(s) : undefined,
      disabled: clickable && s.count === 0,
      zero: 'show',
      data: { 'data-segment': s.key },
    };
  });
  return <BarColumns bars={bars} name={`${metric} pass and fail split`} />;
}

export function Histogram({
  buckets,
  direction,
  metric,
  onPick,
}: {
  buckets: ScoreBucket[];
  direction: MetricDirection;
  metric: string;
  onPick: (b: ScoreBucket) => void;
}) {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const bars: BarSpec[] = buckets.map((b) => {
    const pct = total ? Math.round((b.count / total) * 100) : 0;
    const title = `${b.label}: ${b.count} items (${pct}%)${b.note}`;
    const errors = b.scorerErrors + b.taskErrors;
    return {
      key: b.index,
      count: b.count,
      label: b.label,
      color: bucketTone(b.index, direction),
      errShare: b.count && errors > 0 ? errors / b.count : 0,
      tip: b.count > 0 ? `${title} · click to filter` : undefined,
      name: `${title}, filter the table`,
      onPick: b.count > 0 ? () => onPick(b) : undefined,
      passive: b.count === 0,
      zero: 'hide',
      data: { 'data-bucket': b.index },
    };
  });
  return <BarColumns bars={bars} name={`${metric} score distribution`} />;
}

export function BandValue({
  value,
  type,
  direction,
  children,
}: {
  value: number | null;
  type: string;
  direction: MetricDirection;
  children: React.ReactNode;
}) {
  const band = value === null ? null : metricBand(value, type, direction);
  return (
    <span className={styles.bandValue} data-band={band ?? undefined}>
      {children}
    </span>
  );
}

/**
 * Horizontal rate bar (categories, repeat distribution). The fill is a score band (pass `band`, or `direction`
 * and optional `type` to derive it) or a series colour, never the accent; with neither it is neutral grey.
 * The fill grows in once (M2) and morphs when the value changes (M3).
 */
export function RateBar({
  value,
  label,
  band,
  series,
  direction,
  type,
  index,
  tone,
}: {
  value: number | null;
  label: string;
  band?: 1 | 2 | 3 | 4 | 5 | null;
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  direction?: MetricDirection;
  type?: string;
  /** Position among sibling bars: staggers the grow-in. */
  index?: number;
  /** Deprecated: a fixed CSS colour. Prefer `band` or `series`. */
  tone?: string;
}) {
  const enter = useEntrance();
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const resolved =
    band ?? (!series && direction && value !== null ? metricBand(value, type, direction) : null);
  return (
    <span
      className={styles.rate}
      role="img"
      aria-label={label}
      data-band={resolved ?? undefined}
      data-series={resolved ? undefined : series}
    >
      <span
        className={styles.rateFill}
        data-enter={enter ? '' : undefined}
        style={
          {
            width: `${pct}%`,
            ...(tone ? { background: tone } : {}),
            '--i': staggerIndex(index),
          } as React.CSSProperties
        }
      />
    </span>
  );
}

export type ScatterOutcome = 'pass' | 'fail' | 'error';

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  /** Colours the dot: pass = band 5, fail = band 1, error = an open ring on the x axis; none = neutral. */
  outcome?: ScatterOutcome | null;
}

/** Split lines for the two faint quadrant washes (good = success tint, bad = danger tint). */
export interface ScatterQuadrants {
  x: number;
  y: number;
  /** Whether a higher y is better (maximize) or lower is (minimize). */
  goodIsHighY: boolean;
  goodLabel: string;
  badLabel: string;
}

const OUTCOME_LABEL: Record<ScatterOutcome, string> = { pass: 'Pass', fail: 'Fail', error: 'Task error' };

/** Plot height of a scatter: `clamp(220px, width / 1.78, 320px)`. */
export function scatterHeight(width: number): number {
  return Math.round(Math.min(320, Math.max(220, width / 1.78)));
}

/** The dot-colour (and quadrant) legend of a scatter: lives in the header of the card that holds the plot. */
export function ScatterLegend({
  points,
  quadrants,
}: {
  points: ScatterPoint[];
  quadrants?: ScatterQuadrants;
}) {
  const outcomes = (['pass', 'fail', 'error'] as const).filter((o) => points.some((p) => p.outcome === o));
  if (!outcomes.length && !quadrants) return null;
  return (
    <ul className={styles.legend} aria-label="Dot colours">
      {quadrants ? (
        <>
          <li>
            <span className={styles.quadKey} data-q="good" aria-hidden="true" />
            {quadrants.goodLabel}
          </li>
          <li>
            <span className={styles.quadKey} data-q="bad" aria-hidden="true" />
            {quadrants.badLabel}
          </li>
        </>
      ) : null}
      {outcomes.map((o) => (
        <li key={o}>
          <span className={styles.outcomeKey} data-outcome={o} aria-hidden="true" />
          {OUTCOME_LABEL[o]}
        </li>
      ))}
    </ul>
  );
}

export function Scatter({
  points,
  xLabel,
  yLabel,
  onPick,
  fmt,
  fmtX,
  fmtY,
  quadrants,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  onPick: (id: string) => void;
  fmt: (v: number) => string;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  quadrants?: ScatterQuadrants;
}) {
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>(300);
  const H = scatterHeight(W);
  const pad = { l: 46, r: 8, t: 8, b: 28 };
  const enter = useEntrance();
  const shown = useMemo(
    () =>
      points.length > 1500 ? points.filter((_, i) => i % Math.ceil(points.length / 1500) === 0) : points,
    [points],
  );
  const xs = shown.map((p) => p.x);
  const ys = shown.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs, 0), Math.max(...xs, 1)];
  const [y0, y1] = [Math.min(...ys, 0), Math.max(...ys, 1)];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const ticks = [0, 0.5, 1];
  const fx = fmtX ?? fmt;
  const fy = fmtY ?? fmt;
  const qx = quadrants ? Math.max(pad.l, Math.min(W - pad.r, sx(quadrants.x))) : 0;
  const qy = quadrants ? Math.max(pad.t, Math.min(H - pad.b, sy(quadrants.y))) : 0;
  const left = pad.l;
  const right = W - pad.r;
  const top = pad.t;
  const bottom = H - pad.b;
  return (
    <ChartTooltipHost>
      <div ref={boxRef} className={styles.chartBox}>
        <svg
          className={styles.scatter}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${yLabel} versus ${xLabel}, ${points.length} items`}
        >
          {quadrants ? (
            <g aria-hidden="true">
              <rect
                className={styles.quadGood}
                x={left}
                width={Math.max(0, qx - left)}
                y={quadrants.goodIsHighY ? top : qy}
                height={Math.max(0, quadrants.goodIsHighY ? qy - top : bottom - qy)}
              />
              <rect
                className={styles.quadBad}
                x={qx}
                width={Math.max(0, right - qx)}
                y={quadrants.goodIsHighY ? qy : top}
                height={Math.max(0, quadrants.goodIsHighY ? bottom - qy : qy - top)}
              />
            </g>
          ) : null}
          {ticks.map((t) => (
            <g key={t}>
              <line
                className={styles.grid}
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(y0 + t * (y1 - y0))}
                y2={sy(y0 + t * (y1 - y0))}
              />
              <text
                className={styles.tick}
                x={pad.l - 4}
                y={sy(y0 + t * (y1 - y0))}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {fy(y0 + t * (y1 - y0))}
              </text>
              <text className={styles.tick} x={sx(x0 + t * (x1 - x0))} y={H - pad.b + 14} textAnchor="middle">
                {fx(x0 + t * (x1 - x0))}
              </text>
            </g>
          ))}
          {shown.map((p) => (
            // The dots are pointer marks (1500 tab stops would be a trap); the items table is the keyboard route.
            <Mark
              key={p.id}
              as="g"
              className={styles.dotMark}
              pointerOnly
              tip={
                <>
                  <b>{p.id}</b>
                  <br />
                  {xLabel} {fx(p.x)}
                  {p.outcome === 'error' ? ' · task error' : ` · ${yLabel} ${fy(p.y)}`}
                  {p.outcome && p.outcome !== 'error' ? ` · ${OUTCOME_LABEL[p.outcome]}` : ''}
                </>
              }
              onPick={() => onPick(p.id)}
              data-outcome={p.outcome ?? undefined}
            >
              <circle
                className={styles.dot2}
                data-enter={enter ? '' : undefined}
                data-outcome={p.outcome ?? undefined}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={3.5}
              />
              <circle className={styles.dotHit} cx={sx(p.x)} cy={sy(p.y)} r={10} />
            </Mark>
          ))}
          <text className={styles.axisTitle} x={(W + pad.l) / 2} y={H - 2} textAnchor="middle">
            {xLabel}
          </text>
          <text
            className={styles.axisTitle}
            x={10}
            y={H / 2}
            textAnchor="middle"
            transform={`rotate(-90 10 ${H / 2})`}
          >
            {yLabel}
          </text>
        </svg>
      </div>
    </ChartTooltipHost>
  );
}

export interface CurvePoint {
  k: number;
  value: number | null;
  low?: number;
  high?: number;
}

export interface CurveSeries {
  name: string;
  tone: string;
  dash?: boolean;
  points: CurvePoint[];
}

/** Legend of a curve card: one swatch per series. Lives in the header of the card that holds the plot. */
export function CurveLegend({ series }: { series: CurveSeries[] }) {
  return (
    <ul className={styles.legend} aria-label="Series">
      {series.map((s) => (
        <li key={s.name} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: s.tone }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Positions (0-based, within the sorted ks) that carry a value label: first, 3rd, 5th and last; the first and the last when narrow. */
export function labelledPositions(count: number, narrow: boolean): Set<number> {
  const out = new Set<number>([0, count - 1]);
  if (!narrow) [2, 4].forEach((i) => i < count && out.add(i));
  return out;
}

/** X ticks that are drawn: every one, or (narrow) every third and the last. */
export function tickPositions(count: number, narrow: boolean): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) if (!narrow || i % 3 === 0 || i === count - 1) out.add(i);
  return out;
}

export function Curve({
  series,
  label,
  domain = [0, 1],
  format = (v: number) => `${(v * 100).toFixed(1)}%`,
  xLabel = 'k',
}: {
  series: CurveSeries[];
  label: string;
  /** Y range; a score is 0..1, a raw numeric average needs its own. */
  domain?: [number, number];
  format?: (value: number) => string;
  /** X tick prefix: `k` for attempts allowed, `n` for passes observed. */
  xLabel?: string;
}) {
  const [boxRef, W] = useMeasuredWidth<HTMLElement>(480);
  const narrow = W < 500;
  const H = narrow ? 220 : 240;
  const pad = { l: 40, r: narrow ? 16 : 24, t: 20, b: 30 };
  const ks = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.k)))).sort((a, b) => a - b);
  const sx = (k: number) =>
    pad.l +
    (ks.length > 1
      ? ((k - ks[0]!) / (ks[ks.length - 1]! - ks[0]!)) * (W - pad.l - pad.r)
      : (W - pad.l - pad.r) / 2);
  const span = domain[1] - domain[0] || 1;
  const sy = (v: number) => H - pad.b - ((v - domain[0]) / span) * (H - pad.t - pad.b);
  const labelled = labelledPositions(ks.length, narrow);
  const ticks = tickPositions(ks.length, narrow);
  return (
    <ChartTooltipHost>
      <figure ref={boxRef} className={styles.curve}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const t = domain[0] + f * span;
            return (
              <g key={f}>
                <line className={styles.grid} x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
                <text
                  className={styles.tick}
                  x={pad.l - 6}
                  y={sy(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {domain[1] === 1 && domain[0] === 0 ? `${Math.round(t * 100)}%` : format(t)}
                </text>
              </g>
            );
          })}
          {ks.map((k, i) =>
            ticks.has(i) ? (
              <text key={k} className={styles.tick} x={sx(k)} y={H - 8} textAnchor="middle">
                {xLabel}={k}
              </text>
            ) : null,
          )}
          {series.map((s, si) => {
            const pts = s.points.filter((p) => p.value !== null);
            const band = pts.filter((p) => p.low !== undefined && p.high !== undefined);
            return (
              <g key={s.name}>
                {band.length > 1 ? (
                  <path
                    d={`M${band.map((p) => `${sx(p.k)},${sy(p.high!)}`).join('L')}L${[...band]
                      .reverse()
                      .map((p) => `${sx(p.k)},${sy(p.low!)}`)
                      .join('L')}Z`}
                    style={{ fill: s.tone }}
                    className={styles.band}
                  />
                ) : null}
                <path
                  d={`M${pts.map((p) => `${sx(p.k)},${sy(p.value!)}`).join('L')}`}
                  className={styles.line}
                  style={{ stroke: s.tone }}
                  strokeDasharray={s.dash ? '5 4' : undefined}
                />
                {pts.map((p) => (
                  <Mark
                    key={p.k}
                    as="circle"
                    cx={sx(p.k)}
                    cy={sy(p.value!)}
                    r={4}
                    className={styles.marker}
                    style={{ stroke: s.tone }}
                    tip={`${s.name} @${xLabel}=${p.k}: ${format(p.value!)}`}
                    role="img"
                    aria-label={`${s.name} @${xLabel}=${p.k}: ${format(p.value!)}`}
                  />
                ))}
                {pts.map((p) => {
                  const pos = ks.indexOf(p.k);
                  if (!labelled.has(pos)) return null;
                  // The first series reads above its points, the second below (Pass@k above, Pass^k below).
                  let below = si === 1;
                  // Coincident points (k = 1): one label, from the first series.
                  const first = series[0]?.points.find((q) => q.k === p.k)?.value;
                  if (si === 1 && first != null && Math.abs(first - p.value!) < 1e-9) return null;
                  // A label below a point near the baseline would sit on the x tick: put it above instead.
                  if (below && sy(p.value!) + 17 > H - pad.b + 6) below = false;
                  return (
                    <text
                      key={`l${p.k}`}
                      className={styles.pointLabel}
                      data-point-label={s.name}
                      x={sx(p.k)}
                      y={below ? sy(p.value!) + 17 : sy(p.value!) - 9}
                      textAnchor={
                        ks.length > 1 && pos === ks.length - 1
                          ? 'end'
                          : pos === 0 && ks.length > 1
                            ? 'start'
                            : 'middle'
                      }
                      aria-hidden="true"
                    >
                      {format(p.value!)}
                    </text>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </figure>
    </ChartTooltipHost>
  );
}

export function PassCountBars({
  counts,
  total,
  onPick,
  selected,
}: {
  counts: number[];
  total: number;
  onPick: (bucket: number) => void;
  selected: number | null;
}) {
  const last = counts.length - 1;
  const bars: BarSpec[] = counts.map((c, i) => ({
    key: i,
    count: c,
    label: String(i),
    color: i === last ? 'var(--score-5)' : i === 0 ? 'var(--score-1)' : 'var(--score-3)',
    tip: `${i} of ${total} passes passed: ${c} items`,
    name: `${c} ${i}/${total}${i === 0 ? ' always fail' : i === last ? ' always pass' : ''}: ${i} of ${total} passes passed, ${c} items, filter the table`,
    onPick: () => onPick(i),
    selected: selected === i,
    disabled: c === 0,
    zero: 'show',
    data: { 'data-passes': i },
  }));
  return <BarColumns bars={bars} name="Items by number of passes that passed" />;
}
