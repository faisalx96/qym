/** Stats strip, winner breakdown and "how many runs were correct" over the filtered items (brief 05 J4). */
import { formatLatency, formatMetricValue, metricBand } from '@/lib/metrics';
import type { CSSProperties } from 'react';
import { HelpMarker, Slider } from '@/ui';
import { MetricTabs } from '../SelectionBar';
import { scrollToSection } from '../sectionIds';
import { runSeries, useCompare } from '../../CompareContext';
import { runShortName } from '../../lib/labels';
import { RunTag, useRunMark } from '../RunTag';
import { statRates } from '../../lib/stats';
import styles from './Overview.module.css';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

/** Section-head controls: the pass threshold, then the analysis metric (round 8, C-ov-1). */
export function OverviewControls() {
  const { model, metric, ctx, c } = useCompare();
  const type = model.types[metric] ?? 'score';
  const dir = ctx.direction;
  const slider =
    type === 'boolean' || type === 'numeric' || !dir ? null : (
      <Slider
        key={`${metric}:${ctx.threshold}`}
        label={dir === 'minimize' ? 'Pass if ≤' : 'Pass if ≥'}
        unit="%"
        minValue={5}
        maxValue={100}
        step={5}
        width="16rem"
        className={styles.passSlider}
        defaultValue={Math.round(ctx.threshold * 100)}
        onChangeEnd={(v) => c.setThreshold(metric, v / 100)}
      />
    );
  return (
    <>
      {slider}
      <MetricTabs />
    </>
  );
}

interface StatItem {
  key: string;
  label: string;
  value: string;
  help?: string;
  /** Score ratio 0..1 for the band colour; null = primary text. */
  ratio?: number | null;
  bad?: boolean;
}

export function OverviewTab() {
  const { model, metric, ctx, stats, c } = useCompare();
  const type = model.types[metric] ?? 'score';
  const dir = ctx.direction;
  const n = model.runs.length;
  const rates = statRates(stats);
  const errors = stats.failedCount;
  const items: StatItem[] =
    type === 'numeric'
      ? [
          { key: 'min', label: 'Min', value: formatMetricValue(stats.allScoresMin, type, 1) },
          { key: 'avg', label: 'Avg', value: formatMetricValue(stats.overallAvgScore, type, 1) },
          { key: 'max', label: 'Max', value: formatMetricValue(stats.allScoresMax, type, 1) },
          { key: 'total', label: 'Total', value: formatMetricValue(stats.allScoresTotal, type, 1) },
          { key: 'lat', label: 'Avg latency', value: formatLatency(stats.overallAvgLatency) },
          { key: 'err', label: 'Errors', value: String(errors), bad: errors > 0 },
        ]
      : [
          {
            key: 'pass',
            ratio: dir ? rates.passAtK : rates.passAtK,
            label: `Pass@${n}`,
            value: dir ? pct(rates.passAtK) : '—',
            help: 'Share of items on which at least one run passes.',
          },
          {
            key: 'hat',
            ratio: dir ? rates.passHatK : rates.passHatK,
            label: `Pass^${n}`,
            value: dir ? pct(rates.passHatK) : '—',
            help: 'Share of items on which every run passes.',
          },
          {
            key: 'max',
            ratio: dir ? rates.maxAtK : rates.maxAtK,
            label: dir === 'minimize' ? `Min@${n}` : `Max@${n}`,
            value: dir ? pct(rates.maxAtK) : '—',
            help: 'Average of the best score per item across runs.',
          },
          {
            key: 'cons',
            ratio: rates.consistency,
            label: 'Consistency',
            value: pct(rates.consistency),
            help: 'Do runs agree on pass or fail? 0% is a 50/50 split, 100% is full agreement.',
          },
          {
            key: 'rel',
            ratio: rates.reliability,
            label: 'Reliability',
            value: pct(rates.reliability),
            help: 'When any run can solve an item, how often does a run do it?',
          },
          {
            key: 'avg',
            label: 'Avg score',
            value: formatMetricValue(stats.overallAvgScore, type, 1),
            ratio: stats.overallAvgScore,
          },
          { key: 'lat', label: 'Avg latency', value: formatLatency(stats.overallAvgLatency) },
          { key: 'err', label: 'Errors', value: String(errors), bad: errors > 0 },
        ];
  const active = c.view.winner;
  const setWinner = (value: string) => {
    c.setView({ winner: active === value ? 'any' : value });
    if (active !== value) scrollToSection('items');
  };
  const passRate = c.view.filters.passRate;
  const setDist = (k: number) => {
    const same = !!passRate && passRate[0] === 'eq' && passRate[1] === k;
    c.setView({ filters: { ...c.view.filters, passRate: same ? null : ['eq', k] } });
    if (!same) scrollToSection('items');
  };
  return (
    <div className={styles.stack}>
      <div className={styles.statGrid} data-part="stat-grid" role="group" aria-label="Comparison statistics">
        {items.map((it) => (
          <div key={it.key} className={styles.stat} data-part="stat-box">
            <span className={styles.statLabel}>
              {it.label}
              {it.help ? <HelpMarker label={it.label}>{it.help}</HelpMarker> : null}
            </span>
            <b
              className={styles.statValue}
              data-band={
                it.ratio === null || it.ratio === undefined
                  ? undefined
                  : (metricBand(it.ratio, 'score', it.key === 'avg' ? dir : 'maximize') ?? undefined)
              }
              data-bad={it.bad ? '' : undefined}
            >
              {it.value}
            </b>
          </div>
        ))}
      </div>
      {dir ? (
        <section className={styles.block} aria-label="Winner breakdown">
          <h3 className={styles.h3}>Winner breakdown</h3>
          <div className={styles.winBar} data-part="winner-bar" role="group" aria-label="Items won by each run">
            {stats.wins.map((w, i) =>
              w ? (
                <WinnerSegment
                  key={i}
                  index={i}
                  wins={w}
                  name={runShortName(model.runs[i]!)}
                  pressed={active === `win_${i}`}
                  onPress={() => setWinner(`win_${i}`)}
                />
              ) : null,
            )}
            {stats.ties ? (
              <button
                type="button"
                className={styles.winSeg}
                data-tie
                style={{ flexGrow: stats.ties }}
                aria-pressed={active === 'tie'}
                aria-label={`${stats.ties} ties; filter`}
                onClick={() => setWinner('tie')}
              >
                <span>{stats.ties}</span>
              </button>
            ) : null}
          </div>
          <ul className={styles.legend} aria-label="Winner legend" data-part="winner-legend">
            {model.runs.map((run, i) => (
              <li key={run.ref}>
                <RunTag index={i} name={runShortName(run)} title={run.title} compact bare />
                <b>{stats.wins[i] ?? 0}</b>
              </li>
            ))}
            <li>
              Ties <b>{stats.ties}</b>
            </li>
          </ul>
        </section>
      ) : (
        <p className={styles.note}>Winners, passes and Max@K need a declared direction on this metric.</p>
      )}
      {dir ? (
        <section className={styles.block} aria-label="Correct distribution">
          <h3 className={styles.h3}>Runs correct per item</h3>
          <div className={styles.distBar} data-part="distribution-bar" role="group" aria-label="Runs correct per item">
            {stats.correctDistribution.map((count, k) =>
              count ? (
                <button
                  key={k}
                  type="button"
                  className={styles.distSeg}
                  data-band={n > 0 ? Math.min(5, 1 + Math.round((4 * k) / n)) : undefined}
                  style={{ flexGrow: count }}
                  aria-pressed={!!passRate && passRate[0] === 'eq' && passRate[1] === k}
                  aria-label={`${count} items with ${k} of ${n} runs correct; filter`}
                  onClick={() => setDist(k)}
                >
                  <span>
                    {k}
                    <i>{count}</i>
                  </span>
                </button>
              ) : null,
            )}
          </div>
          <p className={styles.note}>
            Segment label: runs correct, then items. {stats.correctDistribution.reduce((a, b) => a + b, 0)} items in
            all.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function WinnerSegment({
  index,
  wins,
  name,
  pressed,
  onPress,
}: {
  index: number;
  wins: number;
  name: string;
  pressed: boolean;
  onPress: () => void;
}) {
  const mark = useRunMark(index);
  return (
    <button
      type="button"
      className={styles.winSeg}
      style={{ flexGrow: wins, '--run': `var(--chart-${runSeries(index)})` } as CSSProperties}
      aria-pressed={pressed}
      aria-label={`${name} won ${wins} items; filter`}
      onClick={onPress}
      {...mark}
    >
      <span>{wins}</span>
    </button>
  );
}
