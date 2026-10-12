/** Stats strip, winner breakdown and "how many runs were correct" over the filtered items (brief 05 J4). */
import { formatLatency, formatMetricValue, metricDirectionLabel, passThresholdLabel } from '@/lib/metrics';
import { Slider, StatStrip, Text, type StatStripItem } from '@/ui';
import { letterOf, runColor, useCompare } from '../../CompareContext';
import { statRates } from '../../lib/stats';
import styles from './Panel.module.css';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function OverviewTab() {
  const { model, metric, ctx, stats, c } = useCompare();
  const type = model.types[metric] ?? 'score';
  const dir = ctx.direction;
  const n = model.runs.length;
  const rates = statRates(stats);
  const errors = stats.failedCount;
  const items: StatStripItem[] =
    type === 'numeric'
      ? [
          { key: 'min', label: 'Min', value: formatMetricValue(stats.allScoresMin, type, 1) },
          { key: 'avg', label: 'Avg', value: formatMetricValue(stats.overallAvgScore, type, 1) },
          { key: 'max', label: 'Max', value: formatMetricValue(stats.allScoresMax, type, 1) },
          { key: 'total', label: 'Total', value: formatMetricValue(stats.allScoresTotal, type, 1) },
          { key: 'lat', label: 'Avg latency', value: formatLatency(stats.overallAvgLatency) },
          { key: 'err', label: 'Errors', value: String(errors), tone: errors ? 'danger' : undefined },
        ]
      : [
          {
            key: 'pass',
            label: `Pass@${n}`,
            value: dir ? pct(rates.passAtK) : '—',
            help: 'Share of items on which at least one run passes.',
          },
          {
            key: 'hat',
            label: `Pass^${n}`,
            value: dir ? pct(rates.passHatK) : '—',
            help: 'Share of items on which every run passes.',
          },
          {
            key: 'max',
            label: dir === 'minimize' ? `Min@${n}` : `Max@${n}`,
            value: dir ? pct(rates.maxAtK) : '—',
            help: 'Average of the best score per item across runs.',
          },
          {
            key: 'cons',
            label: 'Consistency',
            value: pct(rates.consistency),
            help: 'Do runs agree on pass or fail? 0% is a 50/50 split, 100% is full agreement.',
          },
          {
            key: 'rel',
            label: 'Reliability',
            value: pct(rates.reliability),
            help: 'When any run can solve an item, how often does a run do it?',
          },
          { key: 'avg', label: 'Avg score', value: formatMetricValue(stats.overallAvgScore, type, 1) },
          { key: 'lat', label: 'Avg latency', value: formatLatency(stats.overallAvgLatency) },
          { key: 'err', label: 'Errors', value: String(errors), tone: errors ? 'danger' : undefined },
        ];
  const showThreshold = type !== 'boolean' && type !== 'numeric' && !!dir;
  const threshold = ctx.threshold;
  const active = c.view.winner;
  const setWinner = (value: string) => c.setView({ winner: active === value ? 'any' : value });
  const passRate = c.view.filters.passRate;
  const setDist = (k: number) =>
    c.setView({
      filters: {
        ...c.view.filters,
        passRate: passRate && passRate[0] === 'eq' && passRate[1] === k ? null : ['eq', k],
      },
    });
  const maxDist = Math.max(1, ...stats.correctDistribution);
  return (
    <div className={styles.stack}>
      <Text variant="sm" tone="muted">
        {metricDirectionLabel(dir)}
      </Text>
      {showThreshold ? (
        <Slider
          key={`${metric}:${threshold}`}
          label={dir === 'minimize' ? 'Pass if ≤' : 'Pass if ≥'}
          unit="%"
          minValue={5}
          maxValue={100}
          step={5}
          defaultValue={Math.round(threshold * 100)}
          onChangeEnd={(v) => c.setThreshold(metric, v / 100)}
        />
      ) : null}
      {showThreshold ? (
        <Text variant="sm" tone="muted">
          A run passes when its score is {passThresholdLabel(threshold, dir)}.
        </Text>
      ) : null}
      <StatStrip items={items} />
      {dir ? (
        <section aria-label="Winner breakdown">
          <Text variant="md" weight={600}>
            Winner breakdown
          </Text>
          <div className={styles.bar} role="group" aria-label="Items won by each run">
            {stats.wins.map((w, i) =>
              w ? (
                <button
                  key={i}
                  type="button"
                  className={styles.seg}
                  style={{ flexGrow: w, background: runColor(i) }}
                  aria-pressed={active === `win_${i}`}
                  aria-label={`${model.runs[i]?.label}: won ${w} items; filter`}
                  onClick={() => setWinner(`win_${i}`)}
                >
                  {letterOf(i)} {w}
                </button>
              ) : null,
            )}
            {stats.ties ? (
              <button
                type="button"
                className={styles.seg}
                data-tie
                style={{ flexGrow: stats.ties }}
                aria-pressed={active === 'tie'}
                aria-label={`${stats.ties} ties; filter`}
                onClick={() => setWinner('tie')}
              >
                tie {stats.ties}
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <Text variant="sm" tone="muted">
          Winners, passes and Max@K need a declared direction on this metric.
        </Text>
      )}
      {dir ? (
        <section aria-label="Correct distribution">
          <Text variant="md" weight={600}>
            Runs correct per item
          </Text>
          <div className={styles.dist}>
            {stats.correctDistribution.map((count, k) => (
              <button
                key={k}
                type="button"
                className={styles.distBar}
                aria-pressed={!!passRate && passRate[0] === 'eq' && passRate[1] === k}
                aria-label={`${count} items with ${k} of ${n} runs correct; filter`}
                onClick={() => setDist(k)}
              >
                <span className={styles.distFill} style={{ height: `${(count / maxDist) * 100}%` }} />
                <span className={styles.distLabel}>{k}</span>
                <span className={styles.distCount}>{count}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
