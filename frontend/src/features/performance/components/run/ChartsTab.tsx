/** Performance run page, Charts tab: answer time against users, errors by level, p95 by kind. */
import type { PerformanceRunRead, PerformanceTier } from '@/api/performance';
import { EmptyState } from '@/ui';
import { KINDS, KIND_NAME, KIND_SERIES } from '../../lib/format';
import { ErrorBars, Legend, LineChart, PlotCard } from '../shared';
import { P99_MIN_ANSWERS, tierP95 } from './levels';
import styles from './run.module.css';

interface ChartLevel {
  level: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_pct: number | null;
  by_kind: Record<PerformanceTier, number | null> | null;
}

/** One point per level that has answers: from the result, or while the run goes on from its last report. */
export function chartLevels(read: Pick<PerformanceRunRead, 'summary' | 'progress'>): ChartLevel[] {
  if (read.summary)
    return read.summary.levels.map((item) =>
      item.has_data
        ? {
            level: item.level,
            p50_ms: item.p50_ms,
            p95_ms: item.p95_ms,
            p99_ms: (item.answers ?? 0) >= P99_MIN_ANSWERS ? item.p99_ms : null,
            error_pct: item.error_pct,
            by_kind: tierP95(item),
          }
        : { level: item.level, p50_ms: null, p95_ms: null, p99_ms: null, error_pct: null, by_kind: null },
    );
  // The live report has no p99 and no p95 by kind: those lines fill in with the result.
  return (read.progress?.levels ?? []).map((item) => ({
    level: item.level,
    p50_ms: item.p50_ms,
    p95_ms: item.p95_ms,
    p99_ms: null,
    error_pct: item.answers ? item.error_pct : null,
    by_kind: null,
  }));
}

/** ms -> seconds with one decimal, as a number for a chart. */
const inSeconds = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

/** The top of an axis: a round number above every value and the limit, in steps the grid can label. */
export function axisTop(values: (number | null)[], limit: number, step: number): number {
  const top = Math.max(limit, ...values.filter((value): value is number => value !== null));
  return Math.max(step, Math.ceil((top * 1.04) / step) * step);
}

export function ChartsTab({ read }: { read: PerformanceRunRead }) {
  const levels = chartLevels(read);
  if (!levels.length)
    return (
      <EmptyState
        compact
        title="No charts yet"
        body={
          read.config.test_type === 'breakpoint'
            ? 'The charts are drawn level by level. They show here once the first level reports.'
            : 'These charts compare levels. This test holds one number of users, so it has none.'
        }
      />
    );
  const xs = levels.map((item) => String(item.level));
  const limit = read.config.plan.limit_ms / 1000;
  const errorLimit = read.config.plan.max_error_rate_pct;
  const limitLine = { value: limit, label: `time limit ${limit}s` };
  const errorLine = { value: errorLimit, label: `error limit ${errorLimit}%` };
  const p50 = levels.map((item) => inSeconds(item.p50_ms));
  const p95 = levels.map((item) => inSeconds(item.p95_ms));
  const p99 = levels.map((item) => inSeconds(item.p99_ms));
  const byKind = KINDS.map((kind) => levels.map((item) => inSeconds(item.by_kind?.[kind] ?? null)));
  const errors = levels.map((item) => item.error_pct);
  const live = !read.summary;
  return (
    <div className={styles.chartGrid}>
      <PlotCard
        className={styles.span}
        title="Answer time against users"
        caption={
          live
            ? 'How the answer time grows as users are added. p50, p95, p99: half, 95% and 99% of the answers were faster than this. p99 is added with the result.'
            : 'How the answer time grows as users are added. p50, p95, p99: half, 95% and 99% of the answers were faster than this.'
        }
        legend={
          <Legend
            items={[
              { label: 'p50', series: 1 },
              { label: 'p95', series: 4 },
              { label: 'p99', series: 8 },
              { label: limitLine.label, tone: 'danger', line: true },
            ]}
          />
        }
      >
        <LineChart
          label="p50, p95 and p99 of the answer time at each level"
          xs={xs}
          xTitle="users"
          unit="s"
          yMax={axisTop([...p50, ...p95, ...p99], limit, 40)}
          height={240}
          limit={limitLine}
          empty={{
            title: 'No answer times yet',
            body: 'A level’s point is drawn once it has answers.',
          }}
          series={[
            { name: 'p50', series: 1, values: p50 },
            { name: 'p95', series: 4, values: p95 },
            { name: 'p99', series: 8, values: p99 },
          ]}
        />
      </PlotCard>
      <PlotCard
        title="Errors by level"
        caption="Share of the answers that failed at each level."
        legend={<Legend items={[{ label: errorLine.label, tone: 'danger', line: true }]} />}
      >
        <ErrorBars
          xs={xs}
          values={errors}
          yMax={axisTop(errors, errorLimit, 3)}
          limit={errorLine}
          empty={{ title: 'No errors to draw yet', body: 'A level’s bar is drawn once it has answers.' }}
        />
      </PlotCard>
      <PlotCard
        title="p95 by kind"
        caption={
          live
            ? 'Simple, medium and complex questions apart. Drawn when the run has its result.'
            : 'Simple, medium and complex questions apart.'
        }
        legend={
          <Legend
            items={[
              ...KINDS.map((kind) => ({ label: KIND_NAME[kind], series: KIND_SERIES[kind] })),
              { label: limitLine.label, tone: 'danger' as const, line: true },
            ]}
          />
        }
      >
        <LineChart
          label="p95 of the answer time at each level, by kind of question"
          xs={xs}
          xTitle="users"
          unit="s"
          yMax={axisTop(byKind.flat(), limit, 40)}
          height={210}
          limit={limitLine}
          empty={{
            title: live ? 'Drawn with the result' : 'No answer times by kind',
            body: live
              ? 'The runner sends the answer times by kind with its result.'
              : 'The result names no answer time for a kind of question.',
          }}
          series={KINDS.map((kind, index) => ({
            name: KIND_NAME[kind],
            series: KIND_SERIES[kind],
            values: byKind[index]!,
          }))}
        />
      </PlotCard>
    </div>
  );
}
