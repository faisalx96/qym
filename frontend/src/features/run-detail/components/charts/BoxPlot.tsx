/**
 * The box plot mark (round 3 P7): one glyph set across the page. Box p25..p75, median line, whiskers p5..p95 with caps, a hollow
 * mean diamond, dots for the values outside the whiskers. `BoxPlot` is the SVG plot drawn at the measured width; `BoxTrack` is the
 * same glyph as a positioned row (per-pass rows, Step timings); `BoxNumbers` the readable number row; `BoxLegend` the key.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { HelpMarker } from '@/ui';
import { useEntrance, staggerIndex } from '@/ui/motion';
import { axisPosition, type BoxAxis } from '../../lib/boxAxis';
import type { BoxStats } from '../../lib/boxStats';
import { useMeasuredWidth } from './Charts';
import styles from './BoxPlot.module.css';

export type BoxPart = 'box' | 'low' | 'high';

/** The one sentence that names a plot for assistive tech. */
export function boxSentence(
  name: string,
  s: BoxStats,
  fmt: (v: number) => string,
  opts: { total?: string; unit?: string } = {},
): string {
  if (!s.n) return `${name}: no values`;
  const head = `${name}, ${s.n} ${opts.unit ?? 'items'}`;
  if (s.n === 1) return `${head}: ${fmt(s.median)}`;
  const parts = [
    `minimum ${fmt(s.min)}`,
    `25th percentile ${fmt(s.p25)}`,
    `median ${fmt(s.median)}`,
    `mean ${fmt(s.mean)}`,
    `75th percentile ${fmt(s.p75)}`,
    `maximum ${fmt(s.max)}`,
  ];
  if (opts.total) parts.push(`total ${opts.total}`);
  const tail = s.highCount ? `; ${s.highCount} values above the 95th percentile` : '';
  return `${head}: ${parts.join(', ')}${tail}.`;
}

export interface BoxPlotProps {
  stats: BoxStats;
  axis: BoxAxis;
  format: (v: number) => string;
  /** Axis tick labels (coarser than `format`); default `format`. */
  tickFormat?: (v: number) => string;
  /** Values above p95 take the slow-tail tone (latency). */
  tailTone?: boolean;
  /** Accessible name of the plot (a sentence from `boxSentence`). */
  name: string;
  /** `strip`: 40px, no ticks and no median label (the response-time strip under its histogram). */
  variant?: 'full' | 'strip';
  /** Horizontal padding; the strip uses 0 so it lines up with the histogram above. */
  padX?: number;
  selected?: BoxPart | null;
  /** A region was picked: box = p25..p75, low = min..p25, high = p75..max. */
  onRange?: (part: BoxPart, min: number, max: number) => void;
  /** A dot was picked (open its item). */
  onItem?: (value: number) => void;
  /** Item label for a dot's tooltip. */
  itemLabel?: (value: number) => string | undefined;
  className?: string;
}

export function BoxPlot({
  stats: s,
  axis,
  format: fmt,
  tickFormat,
  tailTone,
  name,
  variant = 'full',
  padX,
  selected,
  onRange,
  onItem,
  itemLabel,
  className,
}: BoxPlotProps) {
  const [ref, W] = useMeasuredWidth<HTMLDivElement>(320);
  const enter = useEntrance();
  const uid = useId();
  const strip = variant === 'strip';
  const H = strip ? 40 : 84;
  const px = padX ?? (strip ? 0 : 14);
  const cy = strip ? 20 : 36;
  const bh = strip ? 16 : 24;
  const sx = (v: number) => px + axisPosition(v, axis.domain) * (W - 2 * px);
  const inside = (v: number) => v <= axis.domain[1];
  if (!s.n) {
    return (
      <div ref={ref} className={styles.empty} role="img" aria-label={name}>
        No values
      </div>
    );
  }
  const medX = sx(s.median);
  const meanX = sx(s.mean);
  const labelAnchor = medX < 40 ? 'start' : medX > W - 40 ? 'end' : 'middle';
  const ticks =
    W < 320 ? axis.ticks.filter((_, i) => i % 2 === 0 || i === axis.ticks.length - 1) : axis.ticks;
  const single = s.n === 1;
  const flat = s.min === s.max;
  const p95x = sx(Math.min(s.p95, axis.domain[1]));
  const clipMax = axis.clipped && s.max > axis.domain[1];
  const clipTip = `${axis.beyond || s.highCount} values beyond ${fmt(axis.domain[1])}, up to ${fmt(s.max)}`;
  const boxW = Math.max(3, sx(s.p75) - sx(s.p25));
  const lowDots = s.low.filter((v) => v !== s.min);
  const highDots = s.high.filter((v) => v !== s.max && inside(v));
  const interactive = !single && !flat;
  return (
    <div ref={ref} className={[styles.plotBox, className].filter(Boolean).join(' ')}>
      <ChartTooltipHost className={styles.stack}>
        {/* The picture: one image named by a sentence. It has no focusable children (nested-interactive). */}
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className={styles.box}
          role="img"
          aria-label={name}
          data-variant={variant}
        >
          {strip
            ? null
            : ticks.map((t) => (
                <g key={t}>
                  <line className={styles.grid} x1={sx(t)} x2={sx(t)} y1={cy - 22} y2={H - 22} />
                  <text
                    className={styles.tick}
                    x={sx(t)}
                    y={H - 6}
                    textAnchor={t === axis.domain[0] ? 'start' : t === axis.domain[1] ? 'end' : 'middle'}
                  >
                    {(tickFormat ?? fmt)(t)}
                  </text>
                </g>
              ))}
          {single ? (
            <>
              <path className={styles.meanMark} d={diamond(meanX, cy)} />
              {strip ? null : (
                <text className={styles.medianLabel} x={meanX} y={cy - 14} textAnchor={labelAnchor}>
                  {fmt(s.median)}
                </text>
              )}
            </>
          ) : flat ? (
            <>
              <line className={styles.median} x1={medX} x2={medX} y1={cy - bh / 2} y2={cy + bh / 2} />
              <text
                className={styles.medianLabel}
                x={medX}
                y={cy - bh / 2 - 6}
                textAnchor={medX > W / 2 ? 'end' : 'start'}
              >
                {`All ${s.n} values are ${fmt(s.median)}`}
              </text>
            </>
          ) : (
            <>
              <line className={styles.whisker} x1={sx(s.p5)} x2={p95x} y1={cy} y2={cy} />
              <line className={styles.cap} x1={sx(s.p5)} x2={sx(s.p5)} y1={cy - 7} y2={cy + 7} />
              <line className={styles.cap} x1={p95x} x2={p95x} y1={cy - 7} y2={cy + 7} />
              {[...lowDots, ...highDots].map((v, i) => (
                <circle
                  key={`d${i}`}
                  className={styles.outlier}
                  data-tail={v > s.p95 && tailTone ? '' : undefined}
                  data-enter={enter ? '' : undefined}
                  style={{ '--i': staggerIndex(i) } as CSSProperties}
                  cx={sx(v)}
                  cy={cy}
                  r={2.5}
                />
              ))}
              <circle className={styles.outlier} data-tail={undefined} cx={sx(s.min)} cy={cy} r={3} />
              {clipMax ? (
                <path
                  className={styles.arrow}
                  data-tail={tailTone ? '' : undefined}
                  d={`M${W - px - 8},${cy - 5}L${W - px},${cy}L${W - px - 8},${cy + 5}Z`}
                />
              ) : (
                <circle
                  className={styles.outlier}
                  data-tail={tailTone && s.max > s.p95 ? '' : undefined}
                  cx={sx(Math.min(s.max, axis.domain[1]))}
                  cy={cy}
                  r={3}
                />
              )}
              <rect
                className={styles.iqr}
                data-enter={enter ? '' : undefined}
                style={{ transformOrigin: `${medX}px ${cy}px` }}
                x={sx(s.p25)}
                y={cy - bh / 2}
                width={boxW}
                height={bh}
                rx={3}
              />
              <line className={styles.median} x1={medX} x2={medX} y1={cy - bh / 2} y2={cy + bh / 2} />
              <path className={styles.meanMark} d={diamond(meanX, cy)} />
              {strip ? null : (
                <text className={styles.medianLabel} x={medX} y={cy - bh / 2 - 6} textAnchor={labelAnchor}>
                  {fmt(s.median)}
                </text>
              )}
              {clipMax && !strip ? (
                <text className={styles.clipLabel} x={W - px - 12} y={cy + 20} textAnchor="end">
                  {`→ ${fmt(s.max)}`}
                </text>
              ) : null}
            </>
          )}
        </svg>
        {/* The marks: transparent hit shapes over the picture, in tab order box, low whisker, high whisker, min, max. */}
        {interactive ? (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.overlay}
            role="group"
            aria-label={`${name.split(',')[0]} marks`}
          >
            <Mark
              as="rect"
              className={styles.hit}
              tip={`Middle 50%: ${fmt(s.p25)} to ${fmt(s.p75)} (IQR ${fmt(s.p75 - s.p25)}${s.p75 === s.p25 ? ', IQR 0' : ''})${s.percentiles ? '' : '. Percentiles need 20 or more values.'}`}
              aria-label={`Middle half, ${fmt(s.p25)} to ${fmt(s.p75)}, filter the items`}
              isSelected={selected === 'box'}
              onPick={onRange ? () => onRange('box', s.p25, s.p75) : undefined}
              tabIndex={onRange ? 0 : -1}
              x={sx(s.p25)}
              y={cy - bh / 2}
              width={boxW}
              height={bh}
              data-mark-kind="box"
            />
            <Mark
              as="rect"
              className={styles.hit}
              tip={`5th percentile ${fmt(s.p5)}. Lower quarter: ${fmt(s.min)} to ${fmt(s.p25)}`}
              aria-label={`Low whisker, ${fmt(s.min)} to ${fmt(s.p25)}, filter the items`}
              isSelected={selected === 'low'}
              onPick={onRange ? () => onRange('low', s.min, s.p25) : undefined}
              tabIndex={onRange ? 0 : -1}
              x={sx(s.p5) - 2}
              y={cy - 8}
              width={Math.max(4, sx(s.p25) - sx(s.p5) + 2)}
              height={16}
              data-mark-kind="cap-low"
            />
            <Mark
              as="rect"
              className={styles.hit}
              tip={`95th percentile ${fmt(s.p95)}. Upper quarter: ${fmt(s.p75)} to ${fmt(s.max)}`}
              aria-label={`High whisker, ${fmt(s.p75)} to ${fmt(s.max)}, filter the items`}
              isSelected={selected === 'high'}
              onPick={onRange ? () => onRange('high', s.p75, s.max) : undefined}
              tabIndex={onRange ? 0 : -1}
              x={sx(s.p75)}
              y={cy - 8}
              width={Math.max(4, p95x - sx(s.p75) + 2)}
              height={16}
              data-mark-kind="cap-high"
            />
            <Mark
              as="circle"
              className={styles.hit}
              tip={`${itemLabel?.(s.min) ?? 'minimum'} · ${fmt(s.min)}`}
              aria-label={`Minimum ${fmt(s.min)}, open the item`}
              onPick={onItem ? () => onItem(s.min) : undefined}
              tabIndex={onItem ? 0 : -1}
              cx={sx(s.min)}
              cy={cy}
              r={6}
              data-mark-kind="dot-min"
            />
            <Mark
              as="circle"
              className={styles.hit}
              tip={clipMax ? clipTip : `${itemLabel?.(s.max) ?? 'maximum'} · ${fmt(s.max)}`}
              aria-label={`Maximum ${fmt(s.max)}, ${clipMax ? clipTip : 'open the item'}`}
              onPick={onItem ? () => onItem(s.max) : undefined}
              tabIndex={onItem ? 0 : -1}
              cx={clipMax ? W - px - 4 : sx(Math.min(s.max, axis.domain[1]))}
              cy={cy}
              r={6}
              data-mark-kind="dot-max"
            />
            <Mark
              as="rect"
              className={styles.hit}
              tabIndex={-1}
              tip={`Median ${fmt(s.median)}`}
              x={medX - 4}
              y={cy - bh / 2}
              width={8}
              height={bh}
              data-mark-kind="median"
            />
            <Mark
              as="rect"
              className={styles.hit}
              tabIndex={-1}
              tip={`Mean ${fmt(s.mean)}`}
              x={meanX - 6}
              y={cy - 6}
              width={12}
              height={12}
              data-mark-kind="mean"
            />
            {[...lowDots, ...highDots].map((v, i) => (
              <Mark
                key={`o${uid}${i}`}
                as="circle"
                className={styles.hit}
                pointerOnly
                tip={`${itemLabel?.(v) ?? 'value'} · ${fmt(v)}`}
                onPick={() => onItem?.(v)}
                cx={sx(v)}
                cy={cy}
                r={5}
                data-mark-kind="dot"
              />
            ))}
          </svg>
        ) : null}
      </ChartTooltipHost>
    </div>
  );
}

const diamond = (x: number, cy: number) => `M${x},${cy - 5}L${x + 5},${cy}L${x},${cy + 5}L${x - 5},${cy}Z`;

/** Six equal cells (Min, P25, Median, Mean, P75, Max) and, for additive quantities, a Total row. Visible text, never hover-only. */
export function BoxNumbers({
  stats: s,
  format: fmt,
  total,
}: {
  stats: BoxStats;
  format: (v: number) => string;
  /** Formatted total; undefined when the quantity is not additive. */
  total?: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDListElement>(300);
  const abbreviate = width < 300;
  const one = s.n === 1;
  // two rows of three when the longest value cannot fit a sixth of the width (mono, about 8px a character)
  const longest = Math.max(...[s.min, s.p25, s.median, s.mean, s.p75, s.max].map((v) => fmt(v).length));
  const wrap = width / 6 < longest * 8 + 6;
  const cells: Array<[string, string, string]> = [
    ['Min', fmt(s.min), 'Min'],
    ['P25', one ? '-' : fmt(s.p25), 'P25'],
    [abbreviate ? 'Med' : 'Median', fmt(s.median), 'Median'],
    ['Mean', fmt(s.mean), 'Mean'],
    ['P75', one ? '-' : fmt(s.p75), 'P75'],
    ['Max', fmt(s.max), 'Max'],
  ];
  if (!s.n) return null;
  return (
    <div className={styles.numsWrap}>
      <dl
        ref={ref}
        className={styles.nums}
        data-wrap={wrap ? '' : undefined}
        aria-label="Distribution values"
      >
        {cells.map(([label, value, full]) => (
          <div key={full} className={styles.num}>
            <dt title={full}>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {total !== undefined ? (
        <dl className={styles.total} aria-label="Total">
          <dt title="Sum of all values across all items and runs">Total</dt>
          <dd>{total}</dd>
        </dl>
      ) : null}
    </div>
  );
}

const HOW_TO_READ =
  'The box is the middle half of the items, the line is the median, the diamond the mean. Whiskers reach the 5th and 95th percentile; dots are items outside them.';

/** The one-line key under every plot (same shapes as the plot) with the "How to read" help. */
export function BoxLegend({ children }: { children?: ReactNode }) {
  return (
    <ul className={styles.legend} aria-label="How to read the box plot">
      <li>
        <span className={styles.lgBox} aria-hidden="true" />
        middle 50%
      </li>
      <li>
        <span className={styles.lgWhisker} aria-hidden="true" />
        p5 to p95
      </li>
      <li>
        <span className={styles.lgMedian} aria-hidden="true" />
        median
      </li>
      <li>
        <span className={styles.lgMean} aria-hidden="true" />
        mean
      </li>
      <li>
        <span className={styles.lgDot} aria-hidden="true" />
        outside p5 to p95
      </li>
      <li>
        <HelpMarker label="How to read the box plot">{HOW_TO_READ}</HelpMarker>
      </li>
      {children}
    </ul>
  );
}

/** The glyph as a positioned row: whiskers, box, median tick and mean diamond on a 0..1 scale (per-pass rows, Step timings). */
export function BoxTrack({
  stats,
  x,
  tone,
  height = 20,
  className,
}: {
  stats: Pick<BoxStats, 'p5' | 'p25' | 'median' | 'mean' | 'p75' | 'p95'>;
  /** Value to a 0..1 position. */
  x: (v: number) => number;
  /** Colour token for the glyph in the slow tail (`--score-*`); default neutral grey. */
  tone?: string;
  height?: number;
  className?: string;
}) {
  const pos = (v: number) => `${Math.min(1, Math.max(0, x(v))) * 100}%`;
  return (
    <span
      className={[styles.track, className].filter(Boolean).join(' ')}
      style={{ blockSize: height, ...(tone ? { '--box-tone': tone } : {}) } as CSSProperties}
      data-box-track=""
    >
      <span
        className={styles.tWhisker}
        style={{ '--a': pos(stats.p5), '--b': pos(stats.p95) } as CSSProperties}
      />
      <span
        className={styles.tBox}
        style={{ '--a': pos(stats.p25), '--b': pos(stats.p75) } as CSSProperties}
      />
      <span className={styles.tMedian} style={{ '--a': pos(stats.median) } as CSSProperties} />
      <span className={styles.tMean} style={{ '--a': pos(stats.mean) } as CSSProperties} />
    </span>
  );
}
