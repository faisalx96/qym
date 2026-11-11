/**
 * Overview: one card per metric. Round 10 restores the first qym's card: a score ring and the mean on the first line,
 * the metric name under them, the scored count at the top end, then one line with the error note and the hatch key
 * (C012), then the plot. No side rail, no
 * header band. A plain-number metric (and tokens, when the traces carry them) is the same frame with the mean and a
 * Total, Min, Median and Max line over the box plot. Cost per item is not shown: every attempt reports it by default,
 * so it says nothing about the run. Where the metric has a pass threshold, the ring and the mean are plain green
 * (passes) or red (fails) against it instead of a band (C220).
 */
import { useMemo } from 'react';
import { Card, EmptyState, HelpMarker, Icon, Tag } from '@/ui';
import { useRunPage } from '../../RunContext';
import { metricBand } from '@/lib/metrics';
import { metricPassesFor } from '../../lib/filterRules';
import { metricHasPassThreshold } from '../../lib/runModel';
import { metricEntries, traceEntries, MIN_TRACE_ITEMS } from '../../lib/boxEntries';
import { metricCardModel, type MetricCardModel } from '../../lib/overviewModel';
import { boxStats } from '../../lib/boxStats';
import { boxFormatter, type BoxKind } from '../../lib/boxFormat';
import { BandValue, BoolBars, Histogram } from '../charts/Charts';
import { BOX_HELP, BoxCardBody, type BoxEntry } from '../charts/BoxCard';
import { useChartFilters } from './useChartFilters';
import styles from './Panels.module.css';

/** A 36px ring filled to the score, in the score's band colour or its pass/fail tone (the first qym's gauge). */
function ScoreRing({
  value,
  band,
  tone,
}: {
  value: number;
  band: number | null;
  tone?: 'success' | 'danger' | null;
}) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const share = Math.max(0, Math.min(1, value));
  return (
    <svg
      className={styles.ring}
      viewBox="0 0 36 36"
      aria-hidden="true"
      data-band={tone ? undefined : (band ?? undefined)}
      data-tone={tone ?? undefined}
    >
      <circle cx="18" cy="18" r={r} className={styles.ringTrack} />
      <circle
        cx="18"
        cy="18"
        r={r}
        className={styles.ringFill}
        strokeDasharray={`${share * c} ${c}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

/** The hatch the bars use for errored items, as a key beside the error note. */
function HatchKey() {
  return (
    <span className={styles.hatchKey} title="Hatched part of a bar: items counted with an error">
      <span className={styles.hatchSwatch} aria-hidden="true" />
      in the bars
    </span>
  );
}

function ErrorNote({ note, hatch }: { note: MetricCardModel['errorNote']; hatch?: boolean }) {
  if (!note) return null;
  return (
    <span className={styles.cardNote} title={note.title}>
      <Icon name="warning" size={12} />
      <span>{note.text}</span>
      {hatch ? <HatchKey /> : null}
    </span>
  );
}

function ScoreCard({ card }: { card: MetricCardModel }) {
  const filters = useChartFilters();
  const { api } = useRunPage();
  const band =
    card.avg !== null && card.kind !== 'empty' && card.direction
      ? metricBand(card.avg, card.type, card.direction)
      : null;
  const passes =
    card.avg !== null && card.kind !== 'empty' && metricHasPassThreshold(api.ctx.model, card.metric)
      ? metricPassesFor(api.ctx, card.metric, card.avg)
      : null;
  const verdict = passes === null ? null : passes ? 'pass' : 'fail';
  return (
    <Card
      as="section"
      fill
      aria-label={card.metric}
      className={styles.metricCard}
      data-testid="metric-card"
      data-metric={card.metric}
    >
      <div className={styles.metricHead}>
        {card.avg !== null && card.kind !== 'empty' ? (
          <ScoreRing
            value={card.avg}
            band={band}
            tone={verdict ? (verdict === 'pass' ? 'success' : 'danger') : null}
          />
        ) : null}
        <div className={styles.metricTitle}>
          {card.avg === null ? (
            <span className={styles.plain}>{card.avgText}</span>
          ) : (
            <BandValue value={card.avg} type={card.type} direction={card.direction} verdict={verdict}>
              {card.avgText}
            </BandValue>
          )}
          <span className={styles.metricName} title={card.directionLabel}>
            {card.metric}
          </span>
        </div>
        <Tag kind="count">{card.badge}</Tag>
      </div>
      {/* C012: the error note and the hatch key share one full-width line under the head */}
      <ErrorNote note={card.errorNote} hatch={card.kind === 'score'} />
      <div className={styles.metricPlot}>
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
        {card.kind === 'empty' ? <p className={styles.slotEmpty}>No scored items</p> : null}
      </div>
    </Card>
  );
}

/**
 * A plain-number quantity (a numeric metric, tokens per item): the mean as the value, "mean per item" beside the
 * name, a Total · Min · Median · Max line, then the box plot. The help marker explains the plot.
 */
function NumberCard({
  title,
  kind,
  entries,
  field,
  note,
}: {
  title: string;
  kind: BoxKind;
  entries: BoxEntry[];
  field: string;
  note?: MetricCardModel['errorNote'];
}) {
  const values = useMemo(() => entries.map((e) => e.v), [entries]);
  const stats = useMemo(() => boxStats(values), [values]);
  const fmt = boxFormatter(kind);
  const additive = values.length > 0 && values.every((v) => v >= 0);
  const facts: Array<[string, string]> = [
    ...(additive ? ([['Total', fmt(stats.sum)]] as Array<[string, string]>) : []),
    ['Min', fmt(stats.min)],
    ['Median', fmt(stats.median)],
    ['Max', fmt(stats.max)],
  ];
  const metric = field.startsWith('metric:') ? field.slice(7) : null;
  return (
    <Card
      as="section"
      fill
      aria-label={title}
      className={styles.metricCard}
      data-testid={metric ? 'metric-card' : 'trace-card'}
      data-metric={metric ?? kind}
    >
      <div className={styles.metricHead}>
        <div className={styles.metricTitle}>
          <span className={styles.plain}>{entries.length ? fmt(stats.mean) : '—'}</span>
          <span className={styles.metricName}>
            {title} <span className={styles.metricSub}>· mean per item</span>
          </span>
        </div>
        <span className={styles.metricEnd}>
          <Tag kind="count">{entries.length} items</Tag>
          <HelpMarker label={BOX_HELP.label}>{BOX_HELP.text}</HelpMarker>
        </span>
      </div>
      <ErrorNote note={note ?? null} />
      {entries.length ? (
        <dl className={styles.numberFacts}>
          {facts.map(([k, v]) => (
            <div key={k} className={styles.numberFact}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className={styles.metricBox}>
        <BoxCardBody entries={entries} kind={kind} name={title} field={field} />
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
  if (!cards.length) return <EmptyState compact title="No scored items for these filters" />;
  // Box plot cards (numeric metrics, tokens) share their own rows: a short plot never sits beside a tall histogram,
  // so no card stretches over dead space (round 5 R2).
  const scoreCards = cards.filter((c) => c.kind !== 'numeric');
  const numericCards = cards.filter((c) => c.kind === 'numeric');
  // tokens only when the traces carry token counts (round 10: not applicable means not shown)
  const showTokens = tokens.length >= MIN_TRACE_ITEMS && tokens.some((t) => t.v > 0);
  return (
    <div className={styles.overviewStack}>
      {scoreCards.length ? (
        <div className={styles.metricGrid} data-count={scoreCards.length}>
          {scoreCards.map((c) => (
            <ScoreCard key={c.metric} card={c} />
          ))}
        </div>
      ) : null}
      {numericCards.length || showTokens ? (
        <div className={styles.metricGrid} data-count={numericCards.length + +showTokens}>
          {numericCards.map((c) => (
            <NumberCard
              key={c.metric}
              title={c.metric}
              kind="numeric"
              entries={numeric.get(c.metric) ?? []}
              field={`metric:${c.metric}`}
              note={c.errorNote}
            />
          ))}
          {showTokens ? (
            <NumberCard title="Tokens per item" kind="tokens" entries={tokens} field="tokens" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
