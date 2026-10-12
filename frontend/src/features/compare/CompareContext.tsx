/** Everything the compare sections read: the model, the URL view, the filtered items and their stats. */
import { createContext, useContext } from 'react';
import type { CompareController } from './hooks/useCompareController';
import type { MetricColumn } from './lib/baseline';
import type { CohortGroups } from './lib/cohort';
import type { FieldDef, FilteredItem } from './lib/filters';
import type { CompareModel } from './lib/model';
import type { MetricCtx } from './lib/scoring';
import type { ComparisonStats } from './lib/stats';

export interface CompareValue {
  c: CompareController;
  model: CompareModel;
  metric: string;
  ctx: MetricCtx;
  columns: MetricColumn[];
  baseline: MetricColumn;
  /** Items after every filter, in display order. */
  items: FilteredItem[];
  itemIds: string[];
  /** Stats over the filtered items. */
  stats: ComparisonStats;
  defs: FieldDef[];
  cohorts: CohortGroups | null;
  slug: string | undefined;
  searchPending: boolean;
}

export const CompareCtx = createContext<CompareValue | null>(null);

export function useCompare(): CompareValue {
  const v = useContext(CompareCtx);
  if (!v) throw new Error('useCompare outside <ComparePage>');
  return v;
}

export const letterOf = (i: number) =>
  i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
/** First five runs get a chart colour; the letter is the identity key, colour is never the only signal. */
export const runColor = (i: number) => `var(--chart-${(i % 5) + 1})`;
