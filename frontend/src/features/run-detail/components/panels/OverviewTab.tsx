import { useMemo } from 'react';
import { Tag } from '@/ui';
import { useRunPage } from '../../RunContext';
import { formatNumericValue, metricBand } from '@/lib/metrics';
import { metricCardModel, type MetricCardModel } from '../../lib/overviewModel';
import { BandValue, BoolBars, Histogram, NumericCells } from '../charts/Charts';
import { ChartCard } from '../charts/ChartCard';
import { useChartFilters } from './useChartFilters';
import styles from './Panels.module.css';

function MetricCard({ card }: { card: MetricCardModel }) {
  const filters = useChartFilters();
  const band =
    card.avg !== null && card.kind !== 'numeric' && card.direction
      ? metricBand(card.avg, card.type, card.direction)
      : null;
  return (
    <ChartCard
      title={card.metric}
      titleHint={card.directionLabel}
      band={band ?? undefined}
      meta={<Tag kind="count">{card.badge}</Tag>}
      data-testid="metric-card"
      data-metric={card.metric}
      intro={
        <>
          {card.kind === 'numeric' || card.avg === null ? (
            <span className={styles.plain}>{card.avgText}</span>
          ) : (
            <BandValue value={card.avg} type={card.type} direction={card.direction}>
              {card.avgText}
            </BandValue>
          )}
          {card.errorNote ? (
            <span className={styles.errorNote} title={card.errorNote.title}>
              {card.errorNote.text}
            </span>
          ) : null}
        </>
      }
    >
      {card.kind === 'score' && card.buckets ? (
        <Histogram
          buckets={card.buckets}
          direction={card.direction}
          metric={card.metric}
          onPick={(b) => filters.pickBucket(card.metric, b)}
        />
      ) : null}
      {card.kind === 'boolean' && card.segments ? (
        <BoolBars
          segments={card.segments}
          total={card.segmentTotal ?? 0}
          metric={card.metric}
          onPick={(s) => filters.pickSegment(card.metric, s)}
        />
      ) : null}
      {card.kind === 'numeric' && card.numeric ? (
        <NumericCells
          name={`${card.metric} range`}
          cells={[
            { key: 'min', label: 'Min', value: formatNumericValue(card.numeric.min) },
            { key: 'avg', label: 'Avg', value: formatNumericValue(card.avg) },
            { key: 'max', label: 'Max', value: formatNumericValue(card.numeric.max) },
            { key: 'sum', label: 'Total', value: formatNumericValue(card.numeric.sum) },
          ]}
        />
      ) : null}
      {card.kind === 'empty' ? <p className={styles.slotEmpty}>No scored items</p> : null}
    </ChartCard>
  );
}

export function OverviewTab() {
  const { items, api } = useRunPage();
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const cards = useMemo(
    () =>
      api.ctx.model.metricNames
        .map((m) => metricCardModel(api.ctx, rows, m))
        .filter((c): c is MetricCardModel => !!c),
    [api.ctx, rows],
  );
  if (!cards.length) return <p className={styles.note}>No scored items for the current filters.</p>;
  return (
    <div className={styles.chartGrid} data-count={cards.length}>
      {cards.map((c) => (
        <MetricCard key={c.metric} card={c} />
      ))}
    </div>
  );
}
