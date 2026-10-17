/** The (item, value) pairs behind a box plot card (round 3 P7): the same values the card's header mean averages over. */
import type { BoxEntry } from '../components/charts/BoxCard';
import { rowScoreFor, type FilterContext } from './filterRules';
import type { Row, RowTraceStats } from '../types';

/** One entry per item with a score for the metric (errored items count as 0 or are left out, exactly as `metricCardModel`). */
export function metricEntries(ctx: FilterContext, rows: Row[], metric: string): BoxEntry[] {
  const idx = ctx.model.metricNames.indexOf(metric);
  if (idx < 0) return [];
  const out: BoxEntry[] = [];
  for (const row of rows) {
    const { score } = rowScoreFor(ctx, row, idx, metric);
    if (score !== null) out.push({ id: row.item_id, v: score });
  }
  return out;
}

/** Per-item trace values (tokens or cost): items without a number are left out. */
export function traceEntries(rows: Row[], key: keyof Pick<RowTraceStats, 'tokens' | 'cost'>): BoxEntry[] {
  const out: BoxEntry[] = [];
  for (const row of rows) {
    const v = row.trace_stats?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ id: row.item_id, v });
  }
  return out;
}

/** The Tokens and Cost cards need at least two items that carry the value. */
export const MIN_TRACE_ITEMS = 2;
