/** The one verdict of an item for its bar: "Fail", "Pass", or "7 of 10 passed" for an all-passes repeat item. */
import type { FilterContext } from './filterRules';
import { scopeRowToPass } from './passScope';
import { rowStatus } from './rowDisplay';
import type { Row } from '../types';

export interface ItemVerdict {
  label: string;
  tone: 'success' | 'danger' | 'warning' | undefined;
}

export function itemVerdict(ctx: FilterContext, row: Row, metric: string | null): ItemVerdict {
  const repeatAggregate = ctx.model.isRepeat && !ctx.model.viewPass;
  if (repeatAggregate) {
    const samples = ctx.model.samples;
    let passed = 0;
    for (let p = 1; p <= samples; p++) {
      const s = rowStatus(ctx, scopeRowToPass(row, ctx.model.metricNames, p), metric);
      if (s.kind === 'pass') passed++;
    }
    return {
      label: `${passed} of ${samples} passed`,
      tone: passed === samples ? 'success' : passed === 0 ? 'danger' : 'warning',
    };
  }
  const s = rowStatus(ctx, row, metric);
  return {
    label: s.label,
    tone: s.kind === 'pass' ? 'success' : s.kind === 'fail' || s.kind === 'error' ? 'danger' : undefined,
  };
}
