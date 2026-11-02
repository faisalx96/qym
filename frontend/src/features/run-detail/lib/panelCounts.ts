import { isErrorRow } from '@/lib/metrics';
import { plural } from '@/features/shell/plural';
import { rowTraceErrorCount } from './rowErrors';
import type { Row } from '../types';

/** The nav's Errors badge (C175). */
export interface NavErrorCount {
  /** Items with a task error or a metric error (in any pass): the rows the Errors filter shows. */
  items: number;
  /** Tool and provider errors inside the traces: shown in the Errors section, not added to the badge. */
  traceErrors: number;
  /** The badge tooltip, e.g. "1 item failed · 11 tool errors inside traces". */
  tip: string;
}

/**
 * The Errors badge counts items, the same number as the Overview strip and the Errors filter (owner: metric errors
 * count too). It used to add every trace error, so one failed item read "Errors 12".
 */
export function navErrorCount(rows: Row[]): NavErrorCount {
  let items = 0;
  let traceErrors = 0;
  for (const row of rows) {
    if (isErrorRow(row)) items += 1;
    traceErrors += rowTraceErrorCount(row);
  }
  const parts = [`${plural(items, 'item')} with a task or metric error`];
  if (traceErrors) parts.push(`${plural(traceErrors, 'tool or provider error')} inside traces`);
  return { items, traceErrors, tip: parts.join(' · ') };
}
