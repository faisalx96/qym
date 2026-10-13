/**
 * What "items chosen" means on the compare page (brief 5.4): the visible item set was narrowed by the reader.
 * Baseline change, metric, threshold slider, sort, columns and page never count.
 */
import { activeChips, type ChipEntry } from './activeChips';
import {
  activeFilterCount,
  emptyGroup,
  type CompareFilters,
  type CompareView,
  type FieldDef,
} from './filters';
import type { SweepFilters } from './cohort';
import type { CompareModel } from './model';

export interface CompareScope {
  active: boolean;
  chips: ChipEntry[];
}

/** Chips of everything that narrows the list: the page filters, the rule builder and the search text. */
export function compareScope(
  view: CompareView,
  model: CompareModel,
  defs: FieldDef[],
  columnLabel: (key: string) => string,
): CompareScope {
  const chips = activeChips(view, model, columnLabel);
  const total = activeFilterCount(view, defs);
  const chipped = chips.length;
  // The rule builder is the one filter that has no page chip: it contributes the difference.
  const rules = total - chipped;
  if (rules > 0)
    chips.push({
      key: 'rules',
      label: `${rules} rule${rules === 1 ? '' : 's'}`,
      clear: (v) => ({ filters: { ...v.filters, rules: emptyGroup() } }),
    });
  if (view.q.trim() !== '')
    chips.push({ key: 'q', label: `Search: ${view.q.trim()}`, clear: () => ({ q: '' }) });
  return { active: chips.length > 0, chips };
}

/** A category value toggled as the only selection (same rule as the Categories table rows). */
export function toggleCategory(f: CompareFilters, key: string, value: string): CompareFilters {
  const cur = key === 'complexity' ? f.complexity : key === 'domain' ? f.domain : (f.categories[key] ?? null);
  const next = cur && cur.length === 1 && cur[0] === value ? null : [value];
  if (key === 'complexity') return { ...f, complexity: next };
  if (key === 'domain') return { ...f, domain: next, domainMode: 'include', domainOnly: [] };
  const categories = { ...f.categories };
  if (next) categories[key] = next;
  else delete categories[key];
  return { ...f, categories };
}

export function categoryIsOn(f: CompareFilters, key: string, value: string): boolean {
  const cur = key === 'complexity' ? f.complexity : key === 'domain' ? f.domain : f.categories[key];
  return !!cur && cur.includes(value);
}

/** Sweep scope: any sweep filter off its default (move, outcome, search, metadata key, values). */
export function sweepScopeActive(params: URLSearchParams): boolean {
  return ['sweepMove', 'sweepOutcome', 'sweepQ', 'sweepKey', 'sweepValues'].some((k) => params.has(k));
}

export interface SweepScopeChip {
  key: string;
  label: string;
  /** The filter patch that removes this chip. */
  patch: Partial<SweepFilters>;
}

const OUTCOME_LABEL = (left: string, right: string): Record<string, string> => ({
  left_sweeps_right: `${left} sweeps ${right}`,
  right_sweeps_left: `${right} sweeps ${left}`,
  both_pass: 'Both pass',
  both_fail: 'Both fail',
  mixed: 'Mixed',
});

/** Removable chips for every non-default sweep filter (Exclusive only rides on the values chip). */
export function sweepScopeChips(f: SweepFilters, left: string, right: string): SweepScopeChip[] {
  const out: SweepScopeChip[] = [];
  if (f.move !== 'all') out.push({ key: 'move', label: `Move: ${f.move}`, patch: { move: 'all' } });
  if (f.outcome !== 'all')
    out.push({
      key: 'outcome',
      label: OUTCOME_LABEL(left, right)[f.outcome] ?? f.outcome,
      patch: { outcome: 'all' },
    });
  if (f.q.trim()) out.push({ key: 'q', label: `Search: ${f.q.trim()}`, patch: { q: '' } });
  if (f.key !== 'all' && f.values === null)
    out.push({
      key: 'key',
      label: `Metadata: ${f.key}`,
      patch: { key: 'all', values: null, only: [], mode: 'include' },
    });
  if (f.values !== null)
    out.push({
      key: 'values',
      label: `${f.key}: ${f.values.slice(0, 3).join(', ')}${f.values.length > 3 ? ` +${f.values.length - 3}` : ''}${f.only.length ? ' (exclusive)' : ''}`,
      patch: { key: 'all', values: null, only: [], mode: 'include' },
    });
  return out;
}
