/** Stats strip, winner breakdown and "how many runs were correct" over the filtered items (brief 05 J4). */
import { formatLatency, formatMetricValue } from '@/lib/metrics';
import { Slider, StatStrip, Text, type StatStripItem } from '@/ui';
import { letterOf, runSeries, useCompare } from '../../CompareContext';
import { runShortName } from '../../lib/labels';
import { RunTag, useRunMark } from '../RunTag';
import { statRates } from '../../lib/stats';
import styles from './Panel.module.css';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

/** Pass-if slider for the Overview section header (only for metrics with a threshold and a direction). */
export function OverviewControls() {
  const { model, metric, ctx, c } = useCompare();
  const type = model.types[metric] ?? 'score';
  const dir = ctx.direction;
  if (type === 'boolean' || type === 'numeric' || !dir) return null;
  const threshold = ctx.threshold;
  return (
    <Slider
      key={`${metric}:${threshold}`}
      label={dir === 'minimize' ? 'Pass if ≤' : 'Pass if ≥'}
      unit="%"
      minValue={5}
      maxValue={100}
      step={5}
      width="8rem"
      defaultValue={Math.round(threshold * 100)}
      onChangeEnd={(v) => c.setThreshold(metric, v / 100)}
    />
  );
}

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
      <StatStrip items={items} />
      {dir ? (
        <section aria-label="Winner breakdown">
          <Text variant="md" weight={600}>
            Winner breakdown
          </Text>
          <div className={styles.bar} role="group" aria-label="Items won by each run">
            {stats.wins.map((w, i) =>
              w ? (
                <WinnerSegment
                  key={i}
                  index={i}
                  wins={w}
                  label={model.runs[i]?.label ?? ''}
                  pressed={active === `win_${i}`}
                  onPress={() => setWinner(`win_${i}`)}
                />
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
          <ul className={styles.legend} aria-label="Winner legend">
            {model.runs.map((run, i) => (
              <li key={run.ref} className={styles.legendItem}>
                <RunTag index={i} name={runShortName(run)} title={run.title} compact />
                <span className={styles.legendCount}>{stats.wins[i] ?? 0}</span>
              </li>
            ))}
            <li className={styles.legendItem}>
              <span className={styles.legendTies}>Ties</span>
              <span className={styles.legendCount}>{stats.ties}</span>
            </li>
          </ul>
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
                <span
                  className={styles.distFill}
                  data-band={n > 0 ? 1 + Math.round((4 * k) / n) : undefined}
                  style={{ height: `${(count / maxDist) * 100}%` }}
                />
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

function WinnerSegment({
  index,
  wins,
  label,
  pressed,
  onPress,
}: {
  index: number;
  wins: number;
  label: string;
  pressed: boolean;
  onPress: () => void;
}) {
  const mark = useRunMark(index);
  return (
    <button
      type="button"
      className={styles.seg}
      style={{ flexGrow: wins, background: `var(--chart-${runSeries(index)})` }}
      aria-pressed={pressed}
      aria-label={`${label}: won ${wins} items; filter`}
      onClick={onPress}
      {...mark}
    >
      {letterOf(index)} {wins}
    </button>
  );
}
