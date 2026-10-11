/**
 * Overview trend (Recharts). Dataviz: single series per panel, no dual axis —
 * the daily mean (line, accent) and finished runs/day (bars, de-emphasised) are
 * two stacked panels sharing the X axis (syncId), both with accessibilityLayer
 * so the readout is keyboard-reachable (Tab to the chart, ←/→ moves it).
 */
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Trend } from '@/api/dashboardTypes';
import { Text } from '@/ui';
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

function TrendTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: Point }[]; metric: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className={styles.tooltip} role="status">
      <div className={styles.tipDate}>{p.label}</div>
      <div className={styles.tipRow}>
        <span className={styles.tipKey} data-series="1" aria-hidden="true" />
        <strong>{p.mean === null ? '—' : `${p.mean.toFixed(1)}%`}</strong>
        <span>{metric}</span>
      </div>
      <div className={styles.tipRow}>
        <span className={styles.tipKey} data-series="bar" aria-hidden="true" />
        <strong>{p.runs}</strong>
        <span>run{p.runs === 1 ? '' : 's'}</span>
      </div>
      {p.success !== null ? (
        <div className={styles.tipRow}>
          <span className={styles.tipKey} data-series="none" aria-hidden="true" />
          <strong>{(p.success * 100).toFixed(0)}%</strong>
          <span>execution success</span>
        </div>
      ) : null}
    </div>
  );
}

export function TrendChart({ trend, height = 180 }: { trend: Trend; height?: number }) {
  const metric = (trend.metric ?? 'metric').replace(/_/g, ' ');
  const data: Point[] = trend.points.map((p) => ({
    date: p.date,
    label: short(p.date),
    mean: p.metric_mean === null ? null : Math.round(p.metric_mean * 1000) / 10,
    runs: p.runs,
    success: p.execution_success,
  }));
  const tickEvery = Math.max(1, Math.round(data.length / 6));
  const ticks = data.filter((_, i) => i % tickEvery === 0).map((d) => d.date);
  return (
    <figure className={styles.figure} aria-label={`${metric} daily mean over ${trend.days} days with runs per day`} data-testid="trend-chart">
      <div className={styles.panel} data-panel="line">
        <Text variant="sm" tone="muted" as="div" className={styles.panelLabel}>
          Daily mean · {metric}
        </Text>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} syncId="trend" margin={{ top: 8, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={short} axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} tick={{ fill: 'var(--text-muted)' }} interval={0} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={36} tickFormatter={(v: number) => `${v}%`} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)' }} />
            <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ stroke: 'var(--border-strong)' }} />
            <Line type="monotone" dataKey="mean" stroke="var(--chart-1)" strokeWidth={2} connectNulls dot={{ r: 3.5, fill: 'var(--chart-1)', stroke: 'var(--bg-surface)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--bg-surface)', strokeWidth: 2 }} isAnimationActive={false} name={metric} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.panel} data-panel="bars">
        <Text variant="sm" tone="muted" as="div" className={styles.panelLabel}>
          Finished runs per day
        </Text>
        <ResponsiveContainer width="100%" height={56}>
          <BarChart data={data} syncId="trend" margin={{ top: 2, right: 12, left: 0, bottom: 0 }} barCategoryGap={2} accessibilityLayer>
            <XAxis dataKey="date" hide />
            <YAxis width={36} hide domain={[0, 'dataMax']} />
            <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ fill: 'var(--bg-hover)' }} />
            <Bar dataKey="runs" fill="var(--border-strong)" radius={[2, 2, 0, 0]} isAnimationActive={false} name="runs" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>
        <Text variant="sm" tone="muted" as="span">
          Focus the chart and use ← → to read each day.
        </Text>
      </figcaption>
    </figure>
  );
}
