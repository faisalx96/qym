/** The report's scope: whether the reader narrowed the item set, its chips and "N of M" (the one Clear is in the nav, C-44). */
import { useMemo } from 'react';
import type { ScopeChip } from '@/ui';
import { scopeChips } from '../lib/scopeFilters';
import { useRunPage } from '../RunContext';

export interface RunScope {
  active: boolean;
  /** The scope is only a search (C154: a search does not open the quick-filter sidebar). */
  searchOnly: boolean;
  chips: ScopeChip[];
  shown: number;
  total: number;
}

export function useScope(): RunScope {
  const { api, items, payload } = useRunPage();
  const { view, defs, selectedMetric, replaceView } = api;
  const entries = useMemo(() => scopeChips(view, defs, selectedMetric), [view, defs, selectedMetric]);
  const chips = useMemo<ScopeChip[]>(
    () => entries.map((e) => ({ key: e.key, label: e.label, onClear: () => replaceView(e.clear(view)) })),
    [entries, view, replaceView],
  );
  return {
    active: entries.length > 0,
    searchOnly: entries.length > 0 && entries.every((e) => e.key === 'q'),
    chips,
    shown: items.length,
    total: payload.snapshot.rows.length,
  };
}
