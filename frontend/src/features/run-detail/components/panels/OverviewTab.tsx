/**
 * Overview: one card per metric. cv4 C1-3 and C1-4 give every card one anatomy, top to bottom: the metric name as the
 * card title with the count at the end; the main number (a score's ring and mean in its band colour, or plain green or
 * red against a pass threshold, C220; a plain number's mean in the box plot's tone, keyed by the plot's mean diamond);
 * the plot (histogram with its hatch key at the end of the number row, or the Total, Min, Median and Max strip over the
 * box plot); then a foot under a hairline with the error note. No side rail, no header band. Tokens show only when the
 * traces carry them. Cost per item is not shown: every attempt reports it by default, so it says nothing about the run.
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

/** The hatch the bars use for errored items: the plot's key, at the end of the main number's row. */
function HatchKey() {
  return (
    <span className={styles.hatchKey} title="Hatched part of a bar: items counted with an error">
      <span className={styles.hatchSwatch} aria-hidden="true" />
      Errored items
    </span>
  );
}

/**
 * cv4 C1-3: the card's foot, under the plot after a hairline: the error note (how errors count in the mean).
 * `reserve` keeps an empty foot's line, so the plots of a row stay level when one card has no note.
 */
function CardFoot({ note, reserve }: { note: MetricCardModel['errorNote']; reserve?: boolean }) {
  if (!note && !reserve) return null;
  return (
    <div className={styles.cardFoot} data-empty={note ? undefined : ''}>
      {note ? (
        <span className={styles.cardNote} title={note.title}>
          <Icon name="warning" size={12} />
          <span>{note.text}</span>
        </span>
      ) : (
        '\u00a0'
      )}
    </div>
  );
}

/** cv4 C1-3, C1-4: the card's title row: the name as the card title, the count at the end. */
function CardHead({ title, hint, end }: { title: string; hint?: string; end: React.ReactNode }) {
  return (
    <div className={styles.metricHead}>
      <h3 className={styles.metricName} title={hint}>
        {title}
      </h3>
      <span className={styles.metricEnd}>{end}</span>
    </div>
  );
}

function ScoreCard({ card, reserveFoot }: { card: MetricCardModel; reserveFoot: boolean }) {
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
      <CardHead title={card.metric} hint={card.directionLabel} end={<Tag kind="count">{card.badge}</Tag>} />
      <div className={styles.metricScore}>
        {card.avg !== null && card.kind !== 'empty' ? (
          <ScoreRing
            value={card.avg}
            band={band}
            tone={verdict ? (verdict === 'pass' ? 'success' : 'danger') : null}
          />
        ) : null}
        {card.avg === null ? (
          <span className={styles.heroValue}>{card.avgText}</span>
        ) : (
          <BandValue
            value={card.avg}
            type={card.type}
            direction={card.direction}
            verdict={verdict}
            className={styles.heroValue}
          >
            {card.avgText}
          </BandValue>
        )}
        {card.kind === 'score' && card.errorNote ? <HatchKey /> : null}
      </div>
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
      <CardFoot note={card.errorNote} reserve={reserveFoot} />
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
  reserveFoot = false,
}: {
  title: string;
  kind: BoxKind;
  entries: BoxEntry[];
  field: string;
  note?: MetricCardModel['errorNote'];
  reserveFoot?: boolean;
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
      <CardHead
        title={title}
        end={
          <>
            <Tag kind="count">{entries.length} items</Tag>
            <HelpMarker label={BOX_HELP.label}>{BOX_HELP.text}</HelpMarker>
          </>
        }
      />
      {/* C1-4: the mean is the main number; its key is the plot's hollow diamond, so the number names a mark */}
      <div className={styles.metricScore} data-tone={entries.length ? 'series' : undefined}>
        <span className={styles.heroValue}>{entries.length ? fmt(stats.mean) : '—'}</span>
        <span className={styles.meanKey}>
          <span className={styles.meanGlyph} aria-hidden="true" />
          mean per item
        </span>
      </div>
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
      <CardFoot note={note ?? null} reserve={reserveFoot} />
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
  // a row whose cards all lack a note has no foot; one note keeps the foot line on every card of that grid
  const scoreNotes = scoreCards.some((c) => c.errorNote);
  const numberNotes = numericCards.some((c) => c.errorNote);
  return (
    <div className={styles.overviewStack}>
      {scoreCards.length ? (
        <div className={styles.metricGrid} data-count={scoreCards.length}>
          {scoreCards.map((c) => (
            <ScoreCard key={c.metric} card={c} reserveFoot={scoreNotes} />
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
              reserveFoot={numberNotes}
            />
          ))}
          {showTokens ? (
            <NumberCard
              title="Tokens per item"
              kind="tokens"
              entries={tokens}
              field="tokens"
              reserveFoot={numberNotes}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
