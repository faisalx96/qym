/** Box plot clicks as filters (round 3 P7): a value range becomes a latency range or a pair of rule conditions. */
import type { FilterGroup, FilterNode } from './filterRules';
import { isFilterGroup } from './filterRules';

/** A rule tree with `field >= min AND field <= max` set: other rules stay, earlier rules on the same field are replaced. */
export function withRangeRule(rules: FilterGroup, field: string, min: number, max: number): FilterGroup {
  const keep: FilterNode[] = (rules.op === 'and' ? rules.children : [rules]).filter(
    (c) => isFilterGroup(c) || c.field !== field,
  );
  return {
    op: 'and',
    children: [
      ...keep,
      { field, oper: 'gte', value: String(min) },
      { field, oper: 'lte', value: String(max) },
    ],
  };
}

/** Which range the rule tree currently holds for `field`, or null. */
export function rangeOf(rules: FilterGroup, field: string): { min: number; max: number } | null {
  if (rules.op !== 'and') return null;
  const get = (oper: string) => {
    const c = rules.children.find((n) => !isFilterGroup(n) && n.field === field && n.oper === oper);
    return c && !isFilterGroup(c) ? Number(c.value) : NaN;
  };
  const min = get('gte');
  const max = get('lte');
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/** The part of a plot whose range equals the active range (so it draws as selected). */
export function selectedPart(
  range: { min: number; max: number } | null,
  s: { min: number; p25: number; p75: number; max: number },
): 'box' | 'low' | 'high' | null {
  if (!range) return null;
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (same(range.min, s.p25) && same(range.max, s.p75)) return 'box';
  if (same(range.min, s.min) && same(range.max, s.p25)) return 'low';
  if (same(range.min, s.p75) && same(range.max, s.max)) return 'high';
  return null;
}

/** Latency filters are `[min, max)`: widen the top by 1ms-ish so the slowest item stays in. */
export const inclusiveMax = (max: number): number => max + 1e-6 * Math.max(1, Math.abs(max));
