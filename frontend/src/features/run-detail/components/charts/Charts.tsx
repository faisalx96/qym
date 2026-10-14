/**
 * Chart marks for the analysis panel (dataviz rules: tokens only, 2px surface
 * gaps, 4px rounded data ends, every mark a real button with an accessible
 * name, a text legend next to colour). All colours are design tokens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricDirection } from '@/lib/metrics';
import { metricBand } from '@/lib/metrics';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { staggerIndex, useEntrance } from '@/ui/motion';
import { bucketTone, scoreTone, type BoolSegment, type ScoreBucket } from '../../lib/overviewModel';
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

export function Gauge({ score, direction }: { score: number; direction: MetricDirection }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const fill = score >= 1 ? circ : circ * Math.max(0, score - 0.03);
  const tone = direction ? scoreTone(score, direction) : 'var(--text-muted)';
  const enter = useEntrance();
  return (
    <svg className={styles.gauge} viewBox="0 0 48 48" aria-hidden="true">
      <circle className={styles.gaugeTrack} cx="24" cy="24" r={r} />
      <circle
        className={styles.gaugeFill}
        data-enter={enter ? '' : undefined}
        cx="24"
        cy="24"
        r={r}
        style={{ stroke: tone, strokeDasharray: `${fill.toFixed(2)} ${circ.toFixed(2)}` }}
      />
    </svg>
  );
}

export function SplitBar({
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
  const live = segments.filter((s) => s.count > 0);
  return (
    <div className={styles.split}>
      <ChartTooltipHost
        className={styles.splitTrack}
        role="group"
        aria-label={`${metric} pass and fail split`}
      >
        {live.map((s) => {
          const clickable = s.key === 'passed' || s.key === 'failed' || s.key === 'metric_errors';
          const label = `${s.label}: ${s.count} of ${total} items${clickable ? ', filter the table' : ''}`;
          return clickable ? (
            <Mark
              key={s.key}
              as="button"
              className={styles.seg}
              style={{ flexGrow: s.count, background: SEGMENT_TONE[s.tone] }}
              tip={s.title}
              aria-label={label}
              onPick={() => onPick(s)}
              data-segment={s.key}
            >
              <span className={styles.segText}>{s.count > 1 ? s.count : ''}</span>
            </Mark>
          ) : (
            <Mark
              key={s.key}
              className={styles.seg}
              style={{ flexGrow: s.count, background: SEGMENT_TONE[s.tone] }}
              tip={s.title}
              role="img"
              aria-label={label}
            >
              <span className={styles.segText}>{s.count > 1 ? s.count : ''}</span>
            </Mark>
          );
        })}
      </ChartTooltipHost>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.key}>
            <span className={styles.dot} style={{ background: SEGMENT_TONE[s.tone] }} aria-hidden="true" />
            {s.label} {total ? Math.round((s.count / total) * 100) : 0}%
          </li>
        ))}
      </ul>
    </div>
  );
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
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const enter = useEntrance();
  return (
    <ChartTooltipHost className={styles.hist} role="group" aria-label={`${metric} score distribution`}>
      {buckets.map((b) => {
        const h = b.count ? Math.max(3, Math.round((b.count / max) * 100)) : 0;
        const errH =
          b.count && b.scorerErrors + b.taskErrors > 0
            ? Math.max(2, Math.round(((b.scorerErrors + b.taskErrors) / b.count) * h))
            : 0;
        const pct = total ? Math.round((b.count / total) * 100) : 0;
        const title = `${b.label}: ${b.count} items (${pct}%)${b.note}`;
        const bar = (
          <>
            {/* The numerals are drawn from data-* by CSS: the button's name is the aria-label, and text
                that duplicates it would have to match it (axe label-content-name-mismatch). */}
            <span className={styles.count} aria-hidden="true" data-text={b.count || ''} />
            <span className={styles.barArea}>
              <span
                className={styles.bar}
                data-enter={enter ? '' : undefined}
                style={
                  {
                    height: `${h}%`,
                    background: bucketTone(b.index, direction),
                    '--i': staggerIndex(b.index),
                  } as React.CSSProperties
                }
              >
                {errH ? (
                  <span className={styles.barErr} style={{ height: `${(errH / Math.max(h, 1)) * 100}%` }} />
                ) : null}
              </span>
            </span>
            <span className={styles.axis} aria-hidden="true" data-text={b.label} />
          </>
        );
        return b.count > 0 ? (
          <Mark
            key={b.index}
            as="button"
            className={styles.col}
            tip={`${title} · click to filter`}
            aria-label={`${title}, filter the table`}
            onPick={() => onPick(b)}
            data-bucket={b.index}
          >
            {bar}
          </Mark>
        ) : (
          <span key={b.index} className={styles.col} data-empty>
            {bar}
          </span>
        );
      })}
    </ChartTooltipHost>
  );
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
  const H = 220;
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
  const outcomes = (['pass', 'fail', 'error'] as const).filter((o) => shown.some((p) => p.outcome === o));
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
              <text
                className={styles.quadLabel}
                x={left + 6}
                y={quadrants.goodIsHighY ? top + 12 : bottom - 6}
              >
                {quadrants.goodLabel}
              </text>
              <text
                className={styles.quadLabel}
                x={right - 6}
                y={quadrants.goodIsHighY ? bottom - 6 : top + 12}
                textAnchor="end"
              >
                {quadrants.badLabel}
              </text>
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
        {outcomes.length ? (
          <ul className={styles.legend} aria-label="Dot colours">
            {outcomes.map((o) => (
              <li key={o}>
                <span className={styles.outcomeKey} data-outcome={o} aria-hidden="true" />
                {OUTCOME_LABEL[o]}
              </li>
            ))}
          </ul>
        ) : null}
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

export function Curve({
  series,
  label,
  domain = [0, 1],
  format = (v: number) => `${(v * 100).toFixed(1)}%`,
  xLabel = 'k',
}: {
  series: Array<{ name: string; tone: string; dash?: boolean; points: CurvePoint[] }>;
  label: string;
  /** Y range; a score is 0..1, a raw numeric average needs its own. */
  domain?: [number, number];
  format?: (value: number) => string;
  /** X tick prefix: `k` for attempts allowed, `n` for passes observed. */
  xLabel?: string;
}) {
  const [boxRef, W] = useMeasuredWidth<HTMLElement>(320);
  const H = 260;
  const pad = { l: 34, r: 12, t: 8, b: 24 };
  const ks = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.k)))).sort((a, b) => a - b);
  const sx = (k: number) =>
    pad.l +
    (ks.length > 1
      ? ((k - ks[0]!) / (ks[ks.length - 1]! - ks[0]!)) * (W - pad.l - pad.r)
      : (W - pad.l - pad.r) / 2);
  const span = domain[1] - domain[0] || 1;
  const sy = (v: number) => H - pad.b - ((v - domain[0]) / span) * (H - pad.t - pad.b);
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
                  x={pad.l - 4}
                  y={sy(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {domain[1] === 1 && domain[0] === 0 ? `${Math.round(t * 100)}%` : format(t)}
                </text>
              </g>
            );
          })}
          {ks.map((k) => (
            <text key={k} className={styles.tick} x={sx(k)} y={H - pad.b + 14} textAnchor="middle">
              {xLabel}={k}
            </text>
          ))}
          {series.map((s) => {
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
                    aria-label={`${s.name} @${xLabel}=${p.k}: ${format(p.value!)}`}
                  />
                ))}
              </g>
            );
          })}
        </svg>
        <figcaption className={styles.legend}>
          {series.map((s) => (
            <span key={s.name} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: s.tone }} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </figcaption>
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
  const max = Math.max(1, ...counts);
  return (
    <ChartTooltipHost
      className={styles.passBars}
      role="group"
      aria-label="Items by number of passes that passed"
    >
      {counts.map((c, i) => (
        <Mark
          key={i}
          as="button"
          className={styles.passCol}
          isDisabled={c === 0}
          isSelected={selected === i}
          tip={`${i} of ${total} passes passed: ${c} items`}
          aria-label={`${i} of ${total} passes passed: ${c} items, filter the table`}
          onPick={() => onPick(i)}
        >
          <span className={styles.count}>{c}</span>
          <span className={styles.barArea}>
            <span
              className={styles.bar}
              style={{
                height: `${(c / max) * 100}%`,
                background:
                  i === counts.length - 1 ? 'var(--score-5)' : i === 0 ? 'var(--score-1)' : 'var(--score-3)',
              }}
            />
          </span>
          <span className={styles.axis}>
            {i}/{total}
            {i === 0 || i === counts.length - 1 ? (
              <small className={styles.axisNote}>{i === 0 ? 'always fail' : 'always pass'}</small>
            ) : null}
          </span>
        </Mark>
      ))}
    </ChartTooltipHost>
  );
}
