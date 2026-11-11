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
  /** Stats over every aligned item (C011): filters pick the rows to read, not the statistics. */
  stats: ComparisonStats;
  defs: FieldDef[];
  cohorts: CohortGroups | null;
  slug: string | undefined;
  searchPending: boolean;
  /** The letter of the run at a position: A, B, C... or, in a cohort compare, A1-An and B1-Bn (C162). */
  letter: (index: number) => string;
}

export const CompareCtx = createContext<CompareValue | null>(null);

export function useCompare(): CompareValue {
  const v = useContext(CompareCtx);
  if (!v) throw new Error('useCompare outside <ComparePage>');
  return v;
}

/**
 * Run letters by position. A cohort compare letters its sides A and B and numbers their runs (A1-A5, B1-B5), so a side
 * B run never carries a letter like 'F' (C162).
 */
export function runLetters(refs: string[], cohorts: Pick<CohortGroups, 'left' | 'right'> | null): string[] {
  if (!cohorts) return refs.map((_, i) => letterOf(i));
  const counter = { A: 0, B: 0 };
  const sideOf = (ref: string): 'A' | 'B' | null =>
    cohorts.left.includes(ref) ? 'A' : cohorts.right.includes(ref) ? 'B' : null;
  const numbered = cohorts.left.length > 1 || cohorts.right.length > 1;
  return refs.map((ref, i) => {
    const side = sideOf(ref);
    if (!side) return letterOf(i);
    counter[side] += 1;
    return numbered ? `${side}${counter[side]}` : side;
  });
}

export const letterOf = (i: number) =>
  i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
/** Series 1..8 (--chart-1..8); runs beyond 8 wrap. The letter is the identity key, colour is never the only signal. */
export const runSeries = (i: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 =>
  ((i % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const runColor = (i: number) => `var(--chart-${runSeries(i)})`;
