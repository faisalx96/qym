import { useMemo } from 'react';
import { Tag } from '@/ui';
import { useRunPage } from '../../RunContext';
import { formatNumericValue, metricBand } from '@/lib/metrics';
import { metricEntries, traceEntries, MIN_TRACE_ITEMS } from '../../lib/boxEntries';
import { metricCardModel, type MetricCardModel } from '../../lib/overviewModel';
import { formatCost } from '../../lib/boxFormat';
import { BandValue, BoolBars, Histogram } from '../charts/Charts';
import { BOX_HELP, BoxCardBody, BoxTotal, type BoxEntry } from '../charts/BoxCard';
import { ChartCard } from '../charts/ChartCard';
import { useChartFilters } from './useChartFilters';
import styles from './Panels.module.css';

function MetricCard({ card, entries }: { card: MetricCardModel; entries?: BoxEntry[] }) {
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
      meta={
        <>
          {card.kind === 'numeric' ? (
            <BoxTotal values={(entries ?? []).map((e) => e.v)} kind="numeric" />
          ) : null}
          <Tag kind="count">{card.badge}</Tag>
        </>
      }
      help={card.kind === 'numeric' && card.numeric ? BOX_HELP : undefined}
      slot={card.kind === 'numeric' ? 'box' : true}
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
        <BoxCardBody
          entries={entries ?? []}
          kind="numeric"
          name={card.metric}
          field={`metric:${card.metric}`}
        />
      ) : null}
      {card.kind === 'empty' ? <p className={styles.slotEmpty}>No scored items</p> : null}
    </ChartCard>
  );
}

/** Per-item tokens or cost (from the trace stats): a box plot card after the metric cards. */
function TraceCard({
  title,
  kind,
  entries,
}: {
  title: string;
  kind: 'tokens' | 'cost';
  entries: BoxEntry[];
}) {
  const mean = entries.reduce((a, e) => a + e.v, 0) / entries.length;
  return (
    <ChartCard
      title={title}
      meta={
        <>
          <BoxTotal values={entries.map((e) => e.v)} kind={kind} />
          <Tag kind="count">{entries.length} items</Tag>
        </>
      }
      help={BOX_HELP}
      slot="box"
      data-testid="trace-card"
      data-metric={kind}
      intro={
        <>
          <span className={styles.plain}>
            {kind === 'cost' ? formatCost(mean) : formatNumericValue(mean, 0)}
          </span>
          <span className={styles.errorNote}>Mean per item, from the trace stats</span>
        </>
      }
    >
      <BoxCardBody entries={entries} kind={kind} name={title} field={kind} />
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
  const numeric = useMemo(
    () =>
      new Map(
        cards
          .filter((c) => c.kind === 'numeric')
          .map((c) => [c.metric, metricEntries(api.ctx, rows, c.metric)]),
      ),
    [cards, api.ctx, rows],
  );
  const tokens = useMemo(() => traceEntries(rows, 'tokens'), [rows]);
  const cost = useMemo(() => traceEntries(rows, 'cost'), [rows]);
  if (!cards.length) return <p className={styles.note}>No scored items for the current filters.</p>;
  // Box plot cards (numeric metrics, tokens, cost) share their own rows: a short plot never sits beside a tall histogram,
  // so no card stretches over dead space (round 5 R2).
  const scoreCards = cards.filter((c) => c.kind !== 'numeric');
  const numericCards = cards.filter((c) => c.kind === 'numeric');
  const showTokens = tokens.length >= MIN_TRACE_ITEMS;
  const showCost = cost.length >= MIN_TRACE_ITEMS;
  return (
    <div className={styles.overviewStack}>
      {scoreCards.length ? (
        <div className={styles.chartGrid} data-count={scoreCards.length}>
          {scoreCards.map((c) => (
            <MetricCard key={c.metric} card={c} entries={numeric.get(c.metric)} />
          ))}
        </div>
      ) : null}
      {numericCards.length || showTokens || showCost ? (
        <div className={styles.chartGrid} data-count={numericCards.length + +showTokens + +showCost}>
          {numericCards.map((c) => (
            <MetricCard key={c.metric} card={c} entries={numeric.get(c.metric)} />
          ))}
          {showTokens ? <TraceCard title="Tokens per item" kind="tokens" entries={tokens} /> : null}
          {showCost ? <TraceCard title="Cost per item" kind="cost" entries={cost} /> : null}
        </div>
      ) : null}
    </div>
  );
}
