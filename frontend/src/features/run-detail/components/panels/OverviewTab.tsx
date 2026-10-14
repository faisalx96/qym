/** Metric cards: gauge + mean, error note, histogram / split bar / numeric stats; marks filter the table. */
import { useMemo } from 'react';
import { StatStrip, Text, Card } from '@/ui';
import { useRunPage } from '../../RunContext';
import { formatNumericValue } from '@/lib/metrics';
import { metricCardModel, type MetricCardModel } from '../../lib/overviewModel';
import { BandValue, Gauge, Histogram, SplitBar } from '../charts/Charts';
import { useChartFilters } from './useChartFilters';
import styles from './Panels.module.css';

function MetricCard({ card }: { card: MetricCardModel }) {
  const filters = useChartFilters();
  return (
    <Card as="article" data-testid="metric-card" data-metric={card.metric}>
      <div className={styles.metricStack}>
        <header className={styles.cardHead}>
          {card.avg !== null && card.kind !== 'numeric' ? (
            <Gauge score={card.avg} direction={card.direction} />
          ) : null}
          <div className={styles.cardInfo}>
            {card.kind === 'numeric' || card.avg === null ? (
              <span className={styles.plain}>{card.avgText}</span>
            ) : (
              <BandValue value={card.avg} type={card.type} direction={card.direction}>
                {card.avgText}
              </BandValue>
            )}
            <Text variant="md" tone="primary" title={card.directionLabel}>
              {card.metric}
            </Text>
            {card.errorNote ? (
              <span className={styles.errorNote} title={card.errorNote.title}>
                <span aria-hidden="true">⚠</span> {card.errorNote.text}
              </span>
            ) : null}
          </div>
          <span className={styles.badge}>{card.badge}</span>
        </header>
        {card.kind === 'score' && card.buckets ? (
          <Histogram
            buckets={card.buckets}
            direction={card.direction}
            metric={card.metric}
            onPick={(b) => filters.pickBucket(card.metric, b)}
          />
        ) : null}
        {card.kind === 'boolean' && card.segments ? (
          <>
            <SplitBar
              segments={card.segments}
              total={card.segmentTotal ?? 0}
              metric={card.metric}
              onPick={(s) => filters.pickSegment(card.metric, s)}
            />
            {card.errorLegend ? (
              <p className={styles.note} title={card.errorLegend.title}>
                Error {card.errorLegend.pct}%, {card.errorLegend.label}
              </p>
            ) : null}
          </>
        ) : null}
        {card.kind === 'numeric' && card.numeric ? (
          <StatStrip
            aria-label={`${card.metric} range`}
            items={[
              { key: 'min', label: 'Min', value: formatNumericValue(card.numeric.min) },
              { key: 'avg', label: 'Avg', value: formatNumericValue(card.avg) },
              { key: 'max', label: 'Max', value: formatNumericValue(card.numeric.max) },
              { key: 'sum', label: 'Total', value: formatNumericValue(card.numeric.sum) },
            ]}
          />
        ) : null}
      </div>
    </Card>
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
    <div className={styles.cards} data-count={cards.length}>
      {cards.map((c) => (
        <MetricCard key={c.metric} card={c} />
      ))}
    </div>
  );
}
