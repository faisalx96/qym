import { useCallback, useMemo, useState } from 'react';
import { KEYS, writeJson } from '@/lib/storage';
import { clampWidth, orderColumns, readPersisted, type PersistedState } from './model';
import type { Column, Density } from './types';

export interface DataTableModelOptions<R> {
  columns: Column<R>[];
  storageKey?: string;
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
  density: densityProp = 'regular',
  densityLocked,
}: DataTableModelOptions<R>) {
  const [state, setState] = useState<PersistedState>(() => readPersisted(storageKey));
  const [live, setLive] = useState<Record<string, number>>({});

  const update = useCallback(
    (patch: Partial<PersistedState> | ((s: PersistedState) => Partial<PersistedState>)) => {
      setState((s) => {
        const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) };
        if (storageKey) writeJson(KEYS.dataTableState(storageKey), next);
        return next;
      });
    },
    [storageKey],
  );

  const hidden = useMemo(() => {
    const base = state.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.id);
    const set = new Set(base);
    for (const c of columns) if (c.hideable === false) set.delete(c.id);
    return set;
  }, [state.hidden, columns]);

  const visible = useMemo(
    () =>
      orderColumns(
        columns.filter((c) => !hidden.has(c.id)),
        state.pins,
      ),
    [columns, hidden, state.pins],
  );

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
    () => update({ hidden: null, pins: {}, widths: {}, density: null }),
    [update],
  );
  const widths = useMemo(() => ({ ...state.widths, ...live }), [state.widths, live]);

  return {
    visible,
    hidden,
    pins: state.pins,
    widths,
    density,
    collapsed: useMemo(() => new Set(state.collapsed), [state.collapsed]),
    setHidden,
    setAllHidden,
    setPin,
    setWidth,
    setDensity,
    toggleGroup,
    resetColumns,
    densityLocked: Boolean(densityLocked),
  };
}

export type DataTableModel = ReturnType<typeof useDataTableModel<unknown>>;
