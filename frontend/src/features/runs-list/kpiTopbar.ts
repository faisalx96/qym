/** Publish the five project KPIs into the shell topbar (kpis.js renderTopbar). */
import { useMemo } from 'react';
import type { Kpis } from '@/api/dashboardTypes';
import { useTopbarStats, type TopbarStat } from '@/features/shell';
import { kpiEntries, kpiScope } from '@/lib/kpis';

const COLOR: Record<string, TopbarStat['color']> = {
  accent: 'accent',
  success: 'success',
  danger: 'danger',
  muted: 'muted',
  secondary: 'muted',
  tertiary: 'muted',
};

export function useKpiTopbar(kpis: Kpis | undefined): void {
  const stats = useMemo<TopbarStat[] | null>(
    () =>
      kpis
        ? kpiEntries(kpis).map((e) => ({
            value: e.value,
            label: e.label,
            color: COLOR[e.color],
            title: e.title,
          }))
        : null,
    [kpis],
  );
  const scope = kpiScope(kpis);
  useTopbarStats(stats, { scope: scope.label, scopeTitle: `Totals across ${scope.across}.` });
}
