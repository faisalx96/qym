/** Setting-vs-metric chart model: one swept setting on x, one metric on y, a line per environment. */
import type { ExperimentDetail, ExperimentJob } from '@/api/experiments';
import { formatMetric, formatParam } from './format';
import { currentJobs, usableRun, type MatrixEnv } from './matrix';

export const CHART = { width: 640, height: 240, left: 52, right: 16, top: 12, bottom: 40 } as const;

/** Names of metrics reported by current runs, the most common headline metric first. */
export function metricNames(jobs: ExperimentJob[]): string[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    for (const [name, value] of Object.entries(job.run?.metric_means ?? {})) {
      if (typeof value === 'number' && !counts.has(name)) counts.set(name, 0);
    }
    const headline = job.run?.headline_metric;
    if (headline && counts.has(headline.name))
      counts.set(headline.name, (counts.get(headline.name) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

/** Series colour slot: environments 1-5 use --chart-1..5, the rest share one neutral. */
export function seriesSlot(envIndex: number): string {
  return envIndex < 5 ? String(envIndex + 1) : 'other';
}

export interface ChartPoint {
  jobId: string;
  comboLabel: string;
  x: unknown;
  xLabel: string;
  y: number;
  px: number;
  py: number;
}

export interface ChartSeries {
  envId: string;
  name: string;
  slot: string;
  points: ChartPoint[];
  /** Mean per x value, ordered left to right (the polyline). */
  line: { px: number; py: number }[];
}

export interface ChartModel {
  empty: boolean;
  numeric: boolean;
  series: ChartSeries[];
  xTicks: { px: number; label: string }[];
  yTicks: { py: number; label: string }[];
  plot: { left: number; right: number; top: number; bottom: number };
}

export function buildChart(
  detail: ExperimentDetail,
  envs: MatrixEnv[],
  pointer: string,
  metric: string | null,
): ChartModel {
  const plot = {
    left: CHART.left,
    right: CHART.width - CHART.right,
    top: CHART.top,
    bottom: CHART.height - CHART.bottom,
  };
  const raw: { job: ExperimentJob; x: unknown; y: number; envIndex: number }[] = [];
  if (metric) {
    for (const job of currentJobs(detail)) {
      if (!usableRun(job)) continue;
      const y = job.run?.metric_means?.[metric];
      const sweep = job.params?.sweep ?? {};
      if (typeof y !== 'number' || !Number.isFinite(y) || !(pointer in sweep)) continue;
      raw.push({ job, x: sweep[pointer], y, envIndex: envs.findIndex((e) => e.id === job.environment_id) });
    }
  }
  if (!raw.length) return { empty: true, numeric: true, series: [], xTicks: [], yTicks: [], plot };

  const numeric = raw.every((p) => typeof p.x === 'number' && Number.isFinite(p.x));
  const categories: string[] = [];
  if (!numeric)
    for (const p of raw) if (!categories.includes(formatParam(p.x))) categories.push(formatParam(p.x));
  // Keep points off the axes: pad the x range inside the plot.
  const padX = 20;
  const w = plot.right - plot.left - padX * 2;
  const h = plot.bottom - plot.top;
  const xs = raw.map((p) => p.x as number);
  const xMin = numeric ? Math.min(...xs) : 0;
  const xMax = numeric ? Math.max(...xs) : 0;
  const ys = raw.map((p) => p.y);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const pad = yMax === yMin ? Math.abs(yMax) * 0.1 || 0.5 : (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;
  const xPos = (value: unknown): number => {
    if (numeric)
      return plot.left + padX + (xMax === xMin ? w / 2 : (((value as number) - xMin) / (xMax - xMin)) * w);
    const i = categories.indexOf(formatParam(value));
    return plot.left + padX + (categories.length === 1 ? w / 2 : (i / (categories.length - 1)) * w);
  };
  const yPos = (value: number) => plot.top + h - ((value - yMin) / (yMax - yMin)) * h;

  const series: ChartSeries[] = [];
  envs.forEach((env, envIndex) => {
    const own = raw.filter((p) => p.envIndex === envIndex);
    if (!own.length) return;
    const points: ChartPoint[] = own.map((p) => ({
      jobId: p.job.id,
      comboLabel: p.job.combo_label,
      x: p.x,
      xLabel: formatParam(p.x),
      y: p.y,
      px: xPos(p.x),
      py: yPos(p.y),
    }));
    const groups = new Map<string, { x: unknown; ys: number[] }>();
    for (const p of own) {
      const k = numeric ? String(p.x) : formatParam(p.x);
      const g = groups.get(k) ?? { x: p.x, ys: [] };
      g.ys.push(p.y);
      groups.set(k, g);
    }
    const line = [...groups.values()]
      .map((g) => ({ px: xPos(g.x), py: yPos(g.ys.reduce((a, b) => a + b, 0) / g.ys.length) }))
      .sort((a, b) => a.px - b.px);
    series.push({ envId: env.id, name: env.name, slot: seriesSlot(envIndex), points, line });
  });

  const xTicks = numeric
    ? [...new Set(xs)].sort((a, b) => a - b).map((v) => ({ px: xPos(v), label: String(v) }))
    : categories.map((c) => ({ px: xPos(c), label: c }));
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = yMin + ((yMax - yMin) * i) / 4;
    return { py: yPos(v), label: formatMetric(v) };
  });
  return { empty: false, numeric, series, xTicks, yTicks, plot };
}

export interface ChartTableRow {
  environment: string;
  x: string;
  y: string;
  combo: string;
}

/** The chart as a text table (screen-reader alternative). */
export function chartTableRows(model: ChartModel): ChartTableRow[] {
  return model.series.flatMap((s) =>
    s.points.map((p) => ({ environment: s.name, x: p.xLabel, y: formatMetric(p.y), combo: p.comboLabel })),
  );
}
