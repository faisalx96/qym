/**
 * Overview trend, drawn with the app's own chart parts (C082: no chart library, so it loads with the page). Dataviz:
 * single series per panel, no dual axis — the daily mean (line, accent) and finished runs/day (bars, de-emphasised) are
 * two stacked panels sharing the X axis. The plot is one tab stop: ← → (Home, End) move the readout from day to day,
 * and pointing at a day shows the same readout.
 */
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Trend } from '@/api/dashboardTypes';
import { useMeasuredWidth } from '@/features/run-detail/components/charts/Charts';
import { Text } from '@/ui';
import { TipBody } from '@/ui/Chart';
import { trendDomain, trendFormat, trendIsRate } from './trendModel';
import styles from './TrendChart.module.css';

interface Point {
  date: string;
  label: string;
  mean: number | null;
  runs: number;
  success: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function short(date: string): string {
  const [, m, d] = date.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** At most this many date labels on the X axis: the first, the last and evenly spaced ones between. */
const X_LABELS = 6;
const BARS_H = 56;
const BARS_GAP = 22;

function Readout({ p, metric, rate }: { p: Point; metric: string; rate: boolean }) {
  const rows: Array<[string, string]> = [
    [metric, trendFormat(p.mean, rate)],
    ['Finished runs', String(p.runs)],
  ];
  if (p.success !== null) rows.push(['Execution success', `${(p.success * 100).toFixed(0)}%`]);
  return <TipBody title={p.label} rows={rows} />;
}

export function TrendChart({ trend, height = 180 }: { trend: Trend; height?: number }) {
  const metric = (trend.metric ?? 'metric').replace(/_/g, ' ');
  const data: Point[] = trend.points.map((p) => ({
    date: p.date,
    label: short(p.date),
    mean: p.metric_mean,
    runs: p.runs,
    success: p.execution_success,
  }));
  const rate = trendIsRate(data.map((p) => p.mean));
  const [low, high] = trendDomain(
    data.map((p) => p.mean),
    rate,
  );
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>(600);
  const [active, setActive] = useState<number | null>(null);
  const withMean = data.filter((p) => p.mean !== null);
  const totalRuns = data.reduce((n, p) => n + p.runs, 0);
  const summary = withMean.length
    ? `${metric}: ${withMean.length} days with finished runs, lowest ${trendFormat(
        Math.min(...withMean.map((p) => p.mean as number)),
        rate,
      )}, highest ${trendFormat(Math.max(...withMean.map((p) => p.mean as number)), rate)}, latest ${trendFormat(
        withMean[withMean.length - 1]!.mean,
        rate,
      )} on ${withMean[withMean.length - 1]!.label}. ${totalRuns} finished runs in ${data.length} days.`
    : `${totalRuns} finished runs in ${data.length} days, none with a ${metric} score.`;

  const pad = { l: rate ? 40 : 56, r: 24, t: 8, b: 22 };
  const total = height + BARS_GAP + BARS_H;
  const n = data.length;
  const step = n > 1 ? (W - pad.l - pad.r) / (n - 1) : 0;
  const sx = (i: number) => (n > 1 ? pad.l + i * step : (pad.l + W - pad.r) / 2);
  const sy = (v: number) => pad.t + (1 - (v - low) / (high - low || 1)) * (height - pad.t - pad.b);
  const yTicks = [low, (low + high) / 2, high];
  const maxRuns = Math.max(1, ...data.map((p) => p.runs));
  const barW = Math.max(2, Math.min(18, (n > 1 ? step : W - pad.l - pad.r) - 2));
  const labelEvery = Math.max(1, Math.ceil(n / X_LABELS));
  const xLabels = data
    .map((p, i) => ({ i, label: p.label }))
    .filter(({ i }) => i === 0 || i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery / 2));
  // The line joins the days with a mean; a day without one is skipped.
  const line = data
    .map((p, i) => (p.mean === null ? null : `${sx(i).toFixed(1)},${sy(p.mean).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setActive(Math.max(0, Math.min(n - 1, Math.round(n > 1 ? (x - pad.l) / step : 0))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    const at = active ?? 0;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(n - 1, at + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, at - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };
  const shown = active === null ? null : data[active];
  const tipLeft = active === null ? 0 : Math.min(Math.max(sx(active) + 12, 0), W - 180);

  return (
    <figure
      className={styles.figure}
      aria-label={`${metric} daily mean over ${trend.days} days with runs per day`}
      data-testid="trend-chart"
    >
      <Text variant="sm" tone="muted" as="div" className={styles.panelLabel}>
        Daily mean · {metric}
      </Text>
      <div ref={boxRef} className={styles.panel}>
        <svg
          className={styles.plot}
          width={W}
          height={total}
          viewBox={`0 0 ${W} ${total}`}
          // a keyboard-operable plot: ← → move the readout (role=img would hide that it acts)
          role="application"
          aria-roledescription="chart"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? (n ? 0 : null))}
          onBlur={() => setActive(null)}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line className={styles.grid} x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text
                className={styles.tick}
                x={pad.l - 6}
                y={sy(t)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {rate ? `${Math.round(t * 100)}%` : trendFormat(t, false)}
              </text>
            </g>
          ))}
          <line className={styles.axis} x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} />
          {xLabels.map(({ i, label }) => (
            <text
              key={i}
              className={styles.tick}
              data-x-label=""
              x={sx(i)}
              y={height - pad.b + 14}
              textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
            >
              {label}
            </text>
          ))}
          {active !== null ? (
            <line className={styles.cursor} x1={sx(active)} x2={sx(active)} y1={pad.t} y2={total} />
          ) : null}
          {line ? <polyline className={styles.line} points={line} /> : null}
          {data.map((p, i) =>
            p.mean === null ? null : (
              <circle
                key={p.date}
                className={styles.dot}
                data-active={active === i ? '' : undefined}
                cx={sx(i)}
                cy={sy(p.mean)}
                r={active === i ? 5 : 3.5}
              />
            ),
          )}
          <g transform={`translate(0 ${height + BARS_GAP})`}>
            <text className={styles.tick} x={pad.l} y={-6}>
              Finished runs per day
            </text>
            {data.map((p, i) => {
              const h = (p.runs / maxRuns) * (BARS_H - 4);
              return (
                <rect
                  key={p.date}
                  className={styles.bar}
                  data-active={active === i ? '' : undefined}
                  x={sx(i) - barW / 2}
                  y={BARS_H - h}
                  width={barW}
                  height={h}
                  rx={2}
                />
              );
            })}
          </g>
        </svg>
        {shown ? (
          <div className={styles.tooltip} style={{ left: tipLeft }} aria-hidden="true">
            <Readout p={shown} metric={metric} rate={rate} />
          </div>
        ) : null}
        <div className={styles.srOnly} role="status" aria-live="polite">
          {shown
            ? `${shown.label}: ${trendFormat(shown.mean, rate)} ${metric}, ${shown.runs} run${shown.runs === 1 ? '' : 's'}`
            : ''}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <Text variant="sm" tone="muted" as="span">
          Focus the chart and use ← → to read each day.
        </Text>
      </figcaption>
    </figure>
  );
}
