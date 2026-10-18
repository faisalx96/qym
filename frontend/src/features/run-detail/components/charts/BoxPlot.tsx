/**
 * The box plot mark (round 3 P7): one glyph set across the page. Box p25..p75, median line, whiskers p5..p95 with caps, a hollow
 * mean diamond, dots for the values outside the whiskers. `BoxPlot` is the SVG plot drawn at the measured width; `BoxTrack` is the
 * same glyph as a positioned row (per-pass rows, Step timings). Round 5 R2: one tone per plot (`data-band` of the median for a
 * directed score, else `data-series="1"`), no number row; the median is printed above its line, the data minimum and maximum
 * under the baseline ends, all six numbers are in the box tooltip and the `aria-label`.
 */
import { useId, type CSSProperties } from 'react';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { useEntrance, staggerIndex } from '@/ui/motion';
import { axisPosition, type BoxAxis } from '../../lib/boxAxis';
import type { BoxStats } from '../../lib/boxStats';
import { SERIES_TONE, type BoxTone } from '../../lib/boxTone';
import { useMeasuredWidth } from './Charts';
import styles from './BoxPlot.module.css';

export type BoxPart = 'box' | 'low' | 'high';

/** The one sentence that names a plot for assistive tech. */
export function boxSentence(
  name: string,
  s: BoxStats,
  fmt: (v: number) => string,
  opts: { total?: string; unit?: string; band?: number } = {},
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
  const band = opts.band ? `; band ${opts.band} of 5` : '';
  return `${head}: ${parts.join(', ')}${tail}${band}.`;
}

export interface BoxPlotProps {
  stats: BoxStats;
  axis: BoxAxis;
  format: (v: number) => string;
  /** Values above p95 take the slow-tail tone (latency). */
  tailTone?: boolean;
  /** Accessible name of the plot (a sentence from `boxSentence`). */
  name: string;
  /** One tone for the whole glyph: a score band or series 1 (default). */
  tone?: BoxTone;
  /** `strip`: 40px, no axis and no median label (the response-time strip under its histogram). */
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
  tailTone,
  name,
  tone = SERIES_TONE,
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
  const H = strip ? 40 : 80;
  const px = padX ?? (strip ? 0 : 14);
  const cy = strip ? 20 : 34;
  const base = 62;
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
  const single = s.n === 1;
  const flat = s.min === s.max;
  const p95x = sx(Math.min(s.p95, axis.domain[1]));
  const clipMax = axis.clipped && s.max > axis.domain[1];
  const clipTip = `${axis.beyond || s.highCount} values beyond ${fmt(axis.domain[1])}, up to ${fmt(s.max)}`;
  const boxW = Math.max(3, sx(s.p75) - sx(s.p25));
  const lowDots = s.low.filter((v) => v !== s.min);
  const highDots = s.high.filter((v) => v !== s.max && inside(v));
  const interactive = !single && !flat;
  // data minimum and maximum, printed under the baseline at the ends of the data (one merged label when they would collide)
  const minX = sx(s.min);
  const maxX = clipMax ? W - px : sx(Math.min(s.max, axis.domain[1]));
  const minText = fmt(s.min);
  const maxText = clipMax ? `→ ${fmt(s.max)}` : fmt(s.max);
  const merged = maxX + 3 - maxText.length * 6.6 - (Math.max(0, minX - 3) + minText.length * 6.6) < 8;
  return (
    <div
      ref={ref}
      className={[styles.plotBox, className].filter(Boolean).join(' ')}
      data-band={tone.band}
      data-series={tone.band ? undefined : (tone.series ?? 1)}
    >
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
          {strip || single || flat ? null : (
            <>
              <line
                className={styles.axisLine}
                x1={sx(axis.domain[0])}
                x2={sx(axis.domain[1])}
                y1={base}
                y2={base}
              />
              <line
                className={styles.axisTick}
                x1={sx(axis.domain[0])}
                x2={sx(axis.domain[0])}
                y1={base - 3}
                y2={base + 3}
              />
              <line
                className={styles.axisTick}
                x1={sx(axis.domain[1])}
                x2={sx(axis.domain[1])}
                y1={base - 3}
                y2={base + 3}
              />
            </>
          )}
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
              {strip ? null : merged ? (
                <text className={styles.endLabel} x={(minX + maxX) / 2} y={base + 16} textAnchor="middle">
                  {`${minText} to ${maxText}`}
                </text>
              ) : (
                <>
                  <text
                    className={styles.endLabel}
                    x={Math.max(0, minX - 3)}
                    y={base + 16}
                    textAnchor="start"
                  >
                    {minText}
                  </text>
                  <text className={styles.endLabel} x={Math.min(W, maxX + 3)} y={base + 16} textAnchor="end">
                    {maxText}
                  </text>
                </>
              )}
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
              tip={<BoxTip s={s} fmt={fmt} />}
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
              as="path"
              className={styles.hit}
              tabIndex={-1}
              tip={`Mean ${fmt(s.mean)}`}
              d={diamond(meanX, cy)}
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

/** The tooltip of the box: the middle half and all six numbers (the number row's replacement, round 5 R2). */
function BoxTip({ s, fmt }: { s: BoxStats; fmt: (v: number) => string }) {
  const cells: Array<[string, number]> = [
    ['Min', s.min],
    ['P25', s.p25],
    ['Median', s.median],
    ['Mean', s.mean],
    ['P75', s.p75],
    ['Max', s.max],
  ];
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>
        {`Middle 50%: ${fmt(s.p25)} to ${fmt(s.p75)} (IQR ${fmt(s.p75 - s.p25)})`}
      </div>
      <dl className={styles.tipGrid}>
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{fmt(v)}</dd>
          </div>
        ))}
      </dl>
      {s.percentiles ? null : <div className={styles.tipNote}>Percentiles need 20 or more values.</div>}
    </div>
  );
}

/** The sentence behind the "How to read the box plot" help marker in a card header. */
export const HOW_TO_READ =
  'The box is the middle half of the items, the line is the median, the diamond the mean. Whiskers reach the 5th and 95th percentile; dots are items outside them. Hover or focus the box for all six numbers.';

/** One muted key line under a card that stacks rows (per pass, step timings). */
export function BoxKey() {
  return (
    <p className={styles.key}>
      Box: middle 50%. Line: median. Diamond: mean. Whiskers: p5 to p95. Dots: outside the whiskers.
    </p>
  );
}

/** The glyph as a positioned row: whiskers, box, median tick and mean diamond on a 0..1 scale (per-pass rows, Step timings). */
export function BoxTrack({
  stats,
  x,
  tone = SERIES_TONE,
  height = 20,
  className,
}: {
  stats: Pick<BoxStats, 'p5' | 'p25' | 'median' | 'mean' | 'p75' | 'p95'>;
  /** Value to a 0..1 position. */
  x: (v: number) => number;
  /** One tone for the row: the band of its own median, or series 1. */
  tone?: BoxTone;
  height?: number;
  className?: string;
}) {
  const pos = (v: number) => `${Math.min(1, Math.max(0, x(v))) * 100}%`;
  return (
    <span
      className={[styles.track, className].filter(Boolean).join(' ')}
      style={{ blockSize: height } as CSSProperties}
      data-band={tone.band}
      data-series={tone.band ? undefined : (tone.series ?? 1)}
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
