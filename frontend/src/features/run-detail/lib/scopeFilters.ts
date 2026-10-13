/** Scope rules (what narrows the report) and the filter toggles the quick-filter sidebar and the category/error cards share. */
import { activeChips, type ActiveChip } from './activeChips';
import type { FieldDef, PageFilters, RunView } from './filterRules';
import { slotOfKind, type ErrorBucket } from './rowErrors';

/**
 * A scope is active when the reader narrowed the item set: chart marks, category/error/root-cause cards,
 * rules, approval, search text. Sort, page, metric, threshold, hidden columns and the layout are views, not scope.
 */
export function scopeChips(view: RunView, defs: FieldDef[], metric: string | null): ActiveChip[] {
  const chips = activeChips(view, defs, metric);
  if (view.q.trim() !== '')
    chips.push({
      key: 'q',
      label: `Search: ${view.q.length > 32 ? view.q.slice(0, 31) + '…' : view.q}`,
      clear: (v) => ({ ...v, q: '', page: 1 }),
    });
  return chips;
}

export function isScopeActive(view: RunView, defs: FieldDef[], metric: string | null): boolean {
  return scopeChips(view, defs, metric).length > 0;
}

/** The values currently selected for a metadata key in the page filters. */
export function selectedCategoryValues(filters: PageFilters, key: string): string[] {
  if (key === 'complexity') return filters.complexity ?? [];
  if (key === 'domain') return filters.domain ?? [];
  return filters.categories[key] ?? [];
}

/** The filter patch a category value press produces: select that single value, or clear when it is already the only one. */
export function categoryTogglePatch(filters: PageFilters, key: string, value: string): Partial<PageFilters> {
  const current = selectedCategoryValues(filters, key);
  const on = current.length === 1 && current[0]!.toLowerCase() === value.toLowerCase();
  if (key === 'complexity') return { complexity: on ? null : [value] };
  if (key === 'domain') return { domain: on ? null : [value], domainMode: 'include', domainOnly: [] };
  const categories = { ...filters.categories };
  if (on) delete categories[key];
  else categories[key] = [value];
  return { categories };
}

/** The filter patch an error bucket press produces. */
export function errorTogglePatch(
  filters: PageFilters,
  bucket: Pick<ErrorBucket, 'kind' | 'label'>,
): Partial<PageFilters> {
  const slot = slotOfKind(bucket.kind);
  const errors = { ...filters.errors };
  if (errors[slot]?.label === bucket.label) delete errors[slot];
  else errors[slot] = { kind: bucket.kind, label: bucket.label };
  return { errors };
}
