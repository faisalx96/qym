import { useCallback, useMemo, useState } from 'react';
import { KEYS, writeJson } from '@/lib/storage';
import { clampWidth, orderColumns, readPersisted, type PersistedState } from './model';
import type { Column, Density } from './types';

export interface DataTableModelOptions<R> {
  columns: Column<R>[];
  storageKey?: string;
  /** Separates saved layouts per user (the key becomes `<storageKey>:<scope>`). */
  storageScope?: string;
  density?: Density;
  /** The page fixes the density; no toggle. */
  densityLocked?: boolean;
}

/**
 * Headless state for DataTable: hidden columns, pins, widths, density and group
 * collapse, persisted under `qym:data-table:v2:<storageKey>`.
 */
export function useDataTableModel<R>({
  columns,
  storageKey,
  storageScope,
  density: densityProp = 'regular',
  densityLocked,
}: DataTableModelOptions<R>) {
  const [state, setState] = useState<PersistedState>(() => readPersisted(storageKey, storageScope));
  const [live, setLive] = useState<Record<string, number>>({});

  const update = useCallback(
    (patch: Partial<PersistedState> | ((s: PersistedState) => Partial<PersistedState>)) => {
      setState((s) => {
        const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) };
        if (storageKey) writeJson(KEYS.dataTableState(storageKey, storageScope), next);
        return next;
      });
    },
    [storageKey, storageScope],
  );

  const hidden = useMemo(() => {
    const base = state.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.id);
    const set = new Set(base);
    for (const c of columns) if (c.hideable === false) set.delete(c.id);
    return set;
  }, [state.hidden, columns]);

  /** Every column (hidden ones too) in display order: what the Columns menu lists. */
  const ordered = useMemo(
    () => orderColumns(columns, state.pins, state.order),
    [columns, state.pins, state.order],
  );
  const visible = useMemo(() => ordered.filter((c) => !hidden.has(c.id)), [ordered, hidden]);

  const density: Density = densityLocked ? densityProp : (state.density ?? densityProp);

  const setHidden = useCallback(
    (id: string, on: boolean) =>
      update((s) => {
        const cur = new Set(s.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.id));
        if (on) cur.add(id);
        else cur.delete(id);
        return { hidden: [...cur] };
      }),
    [update, columns],
  );
  const setAllHidden = useCallback(
    (on: boolean) =>
      update({ hidden: on ? columns.filter((c) => c.hideable !== false).map((c) => c.id) : [] }),
    [update, columns],
  );
  const setPin = useCallback(
    (id: string, pin: 'start' | 'end' | null) => update((s) => ({ pins: { ...s.pins, [id]: pin } })),
    [update],
  );
  /** Saves a whole layout at once (the Columns menu drops a column across the freeze line). */
  const applyLayout = useCallback(
    (layout: { order: string[]; pins?: Record<string, 'start' | 'end' | null> }) =>
      update((s) => ({ order: layout.order, pins: { ...s.pins, ...layout.pins } })),
    [update],
  );
  /** Moves a column to `toIndex` of the full display order (hidden columns count). */
  const moveColumn = useCallback(
    (id: string, toIndex: number) =>
      update((s) => {
        const ids = orderColumns(columns, s.pins, s.order).map((c) => c.id);
        const from = ids.indexOf(id);
        if (from < 0) return {};
        ids.splice(from, 1);
        ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
        return { order: ids };
      }),
    [update, columns],
  );
  const resetOrder = useCallback(() => update({ order: null }), [update]);
  const setWidth = useCallback(
    (id: string, w: number, commit: boolean) => {
      const col = columns.find((c) => c.id === id);
      const width = col ? clampWidth(col, w) : Math.round(w);
      if (commit) {
        setLive((l) => {
          const { [id]: _drop, ...rest } = l;
          return rest;
        });
        update((s) => ({ widths: { ...s.widths, [id]: width } }));
      } else setLive((l) => ({ ...l, [id]: width }));
    },
    [columns, update],
  );
  const setDensity = useCallback((d: Density) => update({ density: d }), [update]);
  const toggleGroup = useCallback(
    (key: string) =>
      update((s) => ({
        collapsed: s.collapsed.includes(key) ? s.collapsed.filter((k) => k !== key) : [...s.collapsed, key],
      })),
    [update],
  );
  const resetColumns = useCallback(
    () => update({ hidden: null, pins: {}, order: null, widths: {}, density: null }),
    [update],
  );
  const widths = useMemo(() => ({ ...state.widths, ...live }), [state.widths, live]);

  return {
    visible,
    ordered,
    order: state.order,
    layoutChanged: Boolean(state.order || state.hidden || Object.keys(state.pins).length),
    hidden,
    pins: state.pins,
    widths,
    density,
    collapsed: useMemo(() => new Set(state.collapsed), [state.collapsed]),
    setHidden,
    setAllHidden,
    setPin,
    applyLayout,
    moveColumn,
    resetOrder,
    setWidth,
    setDensity,
    toggleGroup,
    resetColumns,
    densityLocked: Boolean(densityLocked),
  };
}

export type DataTableModel = ReturnType<typeof useDataTableModel<unknown>>;
