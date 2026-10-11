import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Shape kept from shell.js setTopbarStats (brief 01 §3.1). */
export interface TopbarStat {
  value: ReactNode;
  label: string;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
  title?: string;
  secondary?: ReactNode;
}

export interface TopbarStatsState {
  stats: TopbarStat[];
  scope?: string;
  scopeTitle?: string;
}

interface TopbarStatsApi {
  state: TopbarStatsState | null;
  set: (next: TopbarStatsState | null) => void;
}

const TopbarStatsContext = createContext<TopbarStatsApi | null>(null);

export function TopbarStatsProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<TopbarStatsState | null>(null);
  const api = useMemo(() => ({ state, set }), [state]);
  return <TopbarStatsContext.Provider value={api}>{children}</TopbarStatsContext.Provider>;
}

/** Pages publish their KPIs into the topbar; cleared when the page unmounts. */
export function useTopbarStats(stats: TopbarStat[] | null, options: { scope?: string; scopeTitle?: string } = {}): void {
  const ctx = useContext(TopbarStatsContext);
  const { scope, scopeTitle } = options;
  useEffect(() => {
    if (!ctx) return;
    ctx.set(stats ? { stats, scope, scopeTitle } : null);
    return () => ctx.set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.set, stats, scope, scopeTitle]);
}

export function useTopbarStatsState(): TopbarStatsState | null {
  return useContext(TopbarStatsContext)?.state ?? null;
}
