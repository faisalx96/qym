/** Category cards (legacy view): a card per metadata value, a row per run with a bar and a tick at the baseline average. */
import { formatLatency, formatMetricValue } from '@/lib/metrics';
import { Card, ScoreBar, Text } from '@/ui';
import { runSeries, useCompare } from '../../CompareContext';
import { categoryDelta, type CategoryGroup } from '../../lib/breakdown';
import { columnName } from '../../lib/columnName';
import { DeltaTag } from '../common';
import { RunTag, useRunMark } from '../RunTag';
import styles from './CategoryCards.module.css';

function RunRow({
  index,
  name,
  title,
  score,
  latency,
  isBase,
  type,
  max,
  marker,
  delta,
}: {
  index: number;
  name: string;
  title: string;
  score: number | null;
  latency: number | null;
  isBase: boolean;
  type: string;
  max: number | undefined;
  marker: number | null;
  delta: React.ReactNode;
}) {
  const mark = useRunMark(index);
  return (
    <li className={styles.run} data-testid="category-run" {...mark}>
      <div className={styles.line}>
        <RunTag index={index} name={name} title={title} baseline={isBase} compact bare />
        <span className={styles.value}>{score === null ? '—' : formatMetricValue(score, type, 0)}</span>
        <span className={styles.latency}>{latency === null ? '' : formatLatency(latency)}</span>
        <span className={styles.delta}>
          {isBase ? (
            <Text variant="sm" tone="muted">
              Baseline
            </Text>
          ) : (
            delta
          )}
        </span>
      </div>
      <span className={styles.bar} aria-hidden>
        <ScoreBar
          value={score}
          series={runSeries(index)}
          max={max}
          text=""
          height="md"
          marker={isBase ? null : marker}
        />
      </span>
    </li>
  );
}

export function CategoryCards({
  keyName,
  groups,
  rank,
  active,
  onPick,
}: {
  keyName: string;
  groups: CategoryGroup[];
  /** Position of the key among the shown keys (rail colour). */
  rank: number;
  active: (value: string) => boolean;
  onPick: (value: string) => void;
}) {
  const { model, columns, baseline, ctx, metric } = useCompare();
  const type = model.types[metric] ?? 'score';
  const baseIdx = columns.indexOf(baseline);
  const numeric = type === 'numeric';
  let max = 0;
  if (numeric)
    for (const g of groups)
      for (const cell of g.cells) if (cell.score !== null) max = Math.max(max, cell.score);
  return (
    <ul className={styles.cards} aria-label={`By ${keyName}`}>
      {groups.map((g) => {
        const base = g.cells[baseIdx];
        return (
          <li key={g.value} className={styles.item}>
            <Card
              series={runSeries(rank)}
              compact
              onPress={() => onPick(g.value)}
              isSelected={active(g.value)}
              data-testid="category-card"
              data-value={g.value}
            >
              <div className={styles.head}>
                <span className={styles.title}>{g.value}</span>
                <span className={styles.count}>{g.itemIds.size}</span>
              </div>
              <ul className={styles.runs}>
                {columns.map((col, i) => {
                  const cell = g.cells[i]!;
                  const d =
                    i !== baseIdx && base && cell.score !== null && base.score !== null
                      ? categoryDelta(model, col, baseline, ctx, cell, base)
                      : null;
                  return (
                    <RunRow
                      key={col.key}
                      index={col.runIdxs[0] ?? 0}
                      name={columnName(model, col)}
                      title={col.title}
                      score={cell.score}
                      latency={cell.latency}
                      isBase={i === baseIdx}
                      type={type}
                      max={numeric ? max || 1 : undefined}
                      marker={base?.score ?? null}
                      delta={d ? <DeltaTag stats={d} type={type} metric={metric} /> : null}
                    />
                  );
                })}
              </ul>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
