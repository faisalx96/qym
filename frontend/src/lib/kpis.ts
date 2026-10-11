/**
 * Headline project KPIs (port of kpis.js): one name, definition and number
 * format per KPI so the Overview cards and the topbar always show one number.
 * Never derive headline numbers from a page of loaded rows.
 */
import type { Kpis } from '@/api/dashboardTypes';

export function formatCount(n: unknown): string {
  const v = Number(n) || 0;
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v.toLocaleString('en-US');
}

/** Rounds down, so a rate with any failed item never reads as 100%. */
export function formatKpiPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  if (rate >= 1) return '100%';
  if (rate <= 0) return '0%';
  const pct = Math.floor(rate * 1000) / 10;
  return pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`;
}

export interface KpiScope {
  filtered: boolean;
  label: string;
  across: string;
  runs: string;
}

export function kpiScope(kpis: Kpis | null | undefined): KpiScope {
  const filtered = Boolean(kpis && kpis.scope === 'filtered');
  return {
    filtered,
    label: filtered ? 'Filtered runs' : 'All runs',
    across: filtered ? 'the runs that match the active filters' : 'all runs in this project',
    runs: filtered ? 'Runs that match the active filters.' : 'All runs in this project.',
  };
}

function noun(n: unknown, one: string, many: string): string {
  return Number(n) === 1 ? one : many;
}

export type KpiColor = 'accent' | 'success' | 'danger' | 'muted' | 'secondary' | 'tertiary';

export interface KpiEntry {
  key: 'runs' | 'execution_success' | 'runs_with_errors' | 'models' | 'items';
  name: string;
  label: string;
  value: string;
  color: KpiColor;
  title: string;
  secondary?: boolean;
}

export function kpiEntries(kpis: Kpis | null | undefined): KpiEntry[] {
  if (!kpis) return [];
  const s = kpiScope(kpis);
  const across = ` across ${s.across}`;
  return [
    {
      key: 'runs',
      name: 'Runs',
      label: noun(kpis.runs, 'run', 'runs'),
      value: formatCount(kpis.runs),
      color: 'accent',
      title: s.runs,
    },
    {
      key: 'execution_success',
      name: 'Execution success',
      label: 'execution success',
      value: formatKpiPercent(kpis.execution_success),
      color: 'success',
      title:
        `Share of item executions that ran without a task error${across}.` +
        ' A repeat run counts each item once per pass, judged by that pass’s last attempt.' +
        ' Metric errors do not lower it; they count in runs with errors.',
    },
    {
      key: 'runs_with_errors',
      name: 'Runs with errors',
      label: noun(kpis.runs_with_errors, 'run with errors', 'runs with errors'),
      value: formatCount(kpis.runs_with_errors),
      color: kpis.runs_with_errors ? 'danger' : 'muted',
      title: `Runs with at least one task or metric error${across}.`,
    },
    {
      key: 'models',
      name: 'Models',
      label: noun(kpis.models, 'model', 'models'),
      value: formatCount(kpis.models),
      color: 'secondary',
      secondary: true,
      title: `Distinct model names${across}. Reasoning and standard variants of one model count once.`,
    },
    {
      key: 'items',
      name: 'Items',
      label: noun(kpis.items, 'item', 'items'),
      value: formatCount(kpis.items),
      color: 'tertiary',
      secondary: true,
      title: `Items evaluated${across}. A repeat run counts each item once.`,
    },
  ];
}
