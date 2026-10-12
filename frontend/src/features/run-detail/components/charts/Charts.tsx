/**
 * Chart marks for the analysis panel (dataviz rules: tokens only, 2px surface
 * gaps, 4px rounded data ends, every mark a real button with an accessible
 * name, a text legend next to colour). All colours are design tokens.
 */
import { useMemo } from 'react';
import type { MetricDirection } from '@/lib/metrics';
import { metricBand } from '@/lib/metrics';
import { bucketTone, scoreTone, type BoolSegment, type ScoreBucket } from '../../lib/overviewModel';
import styles from './Charts.module.css';

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
  return (
    <svg className={styles.gauge} viewBox="0 0 48 48" aria-hidden="true">
      <circle className={styles.gaugeTrack} cx="24" cy="24" r={r} />
      <circle
        className={styles.gaugeFill}
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
      <div className={styles.splitTrack} role="group" aria-label={`${metric} pass and fail split`}>
        {live.map((s) => {
          const clickable = s.key === 'passed' || s.key === 'failed' || s.key === 'metric_errors';
          const label = `${s.label}: ${s.count} of ${total} items${clickable ? ', filter the table' : ''}`;
          return clickable ? (
            <button
              key={s.key}
              type="button"
              className={styles.seg}
              style={{ flexGrow: s.count, background: SEGMENT_TONE[s.tone] }}
              title={s.title}
              aria-label={label}
              onClick={() => onPick(s)}
              data-segment={s.key}
            >
              <span className={styles.segText}>{s.count > 1 ? s.count : ''}</span>
            </button>
          ) : (
            <span
              key={s.key}
              className={styles.seg}
              style={{ flexGrow: s.count, background: SEGMENT_TONE[s.tone] }}
              title={s.title}
              role="img"
              aria-label={label}
            >
              <span className={styles.segText}>{s.count > 1 ? s.count : ''}</span>
            </span>
          );
        })}
      </div>
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
  return (
    <div className={styles.hist} role="group" aria-label={`${metric} score distribution`}>
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
            <span className={styles.count}>{b.count || ''}</span>
            <span className={styles.barArea}>
              <span
                className={styles.bar}
                style={{ height: `${h}%`, background: bucketTone(b.index, direction) }}
              >
                {errH ? (
                  <span className={styles.barErr} style={{ height: `${(errH / Math.max(h, 1)) * 100}%` }} />
                ) : null}
              </span>
            </span>
            <span className={styles.axis}>{b.label}</span>
          </>
        );
        return b.count > 0 ? (
          <button
            key={b.index}
            type="button"
            className={styles.col}
            title={`${title} — click to filter`}
            aria-label={`${title}, filter the table`}
            onClick={() => onPick(b)}
            data-bucket={b.index}
          >
            {bar}
          </button>
        ) : (
          <span key={b.index} className={styles.col} data-empty title={`${b.label}: no items`}>
            {bar}
          </span>
        );
      })}
    </div>
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

/** Horizontal rate bar (categories, repeat distribution). */
export function RateBar({
  value,
  label,
  tone = 'var(--chart-1)',
}: {
  value: number | null;
  label: string;
  tone?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className={styles.rate} role="img" aria-label={label}>
      <span className={styles.rateFill} style={{ width: `${pct}%`, background: tone }} />
    </span>
  );
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
}

export function Scatter({
  points,
  xLabel,
  yLabel,
  onPick,
  fmt,
  fmtX,
  fmtY,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  onPick: (id: string) => void;
  fmt: (v: number) => string;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
}) {
  const W = 300;
  const H = 220;
  const pad = { l: 46, r: 8, t: 8, b: 28 };
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
  return (
    <svg
      className={styles.scatter}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${yLabel} versus ${xLabel}, ${points.length} items`}
    >
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
            {(fmtY ?? fmt)(y0 + t * (y1 - y0))}
          </text>
          <text className={styles.tick} x={sx(x0 + t * (x1 - x0))} y={H - pad.b + 14} textAnchor="middle">
            {(fmtX ?? fmt)(x0 + t * (x1 - x0))}
          </text>
        </g>
      ))}
      {shown.map((p) => (
        <circle
          key={p.id}
          className={styles.dot2}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={3.5}
          onClick={() => onPick(p.id)}
        >
          <title>{`${p.id}: ${(fmtX ?? fmt)(p.x)}, ${(fmtY ?? fmt)(p.y)}`}</title>
        </circle>
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
  const W = 320;
  const H = 180;
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
    <figure className={styles.curve}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
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
                <circle
                  key={p.k}
                  cx={sx(p.k)}
                  cy={sy(p.value!)}
                  r={4}
                  className={styles.marker}
                  style={{ stroke: s.tone }}
                >
                  <title>{`${s.name} @${xLabel}=${p.k}: ${format(p.value!)}`}</title>
                </circle>
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
    <div className={styles.passBars} role="group" aria-label="Items by number of passes that passed">
      {counts.map((c, i) => (
        <button
          key={i}
          type="button"
          className={styles.passCol}
          disabled={c === 0}
          aria-pressed={selected === i}
          aria-label={`${i} of ${total} passes passed: ${c} items, filter the table`}
          onClick={() => onPick(i)}
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
          </span>
        </button>
      ))}
    </div>
  );
}
