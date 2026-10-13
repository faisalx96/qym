/** The report's scope: whether the reader narrowed the item set, the removable chips, "N of M", and Clear all. */
import { useCallback, useMemo, useState } from 'react';
import type { ScopeChip } from '@/ui';
import { emptyFilters } from '../lib/filterRules';
import { scopeChips } from '../lib/scopeFilters';
import { useRunPage } from '../RunContext';

const HIDDEN_KEY = 'qym:report-sidebar-hidden';

export interface RunScope {
  active: boolean;
  chips: ScopeChip[];
  shown: number;
  total: number;
  clearAll: () => void;
}

export function useScope(): RunScope {
  const { api, items, payload } = useRunPage();
  const { view, defs, selectedMetric, replaceView } = api;
  const entries = useMemo(() => scopeChips(view, defs, selectedMetric), [view, defs, selectedMetric]);
  const chips = useMemo<ScopeChip[]>(
    () => entries.map((e) => ({ key: e.key, label: e.label, onClear: () => replaceView(e.clear(view)) })),
    [entries, view, replaceView],
  );
  const clearAll = useCallback(
    () => replaceView({ ...view, q: '', show: 'all', page: 1, filters: emptyFilters() }),
    [view, replaceView],
  );
  return {
    active: entries.length > 0,
    chips,
    shown: items.length,
    total: payload.snapshot.rows.length,
    clearAll,
  };
}

/** `localStorage qym:report-sidebar-hidden`: the reader chose to hide the sidebar while a scope is active. */
export function useSidebarHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = useCallback((next: boolean) => {
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);
  return [hidden, set];
}
