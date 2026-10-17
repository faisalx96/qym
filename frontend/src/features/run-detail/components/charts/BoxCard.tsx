/** The body of a box plot card (round 3 P7): plot, number row, Total (additive quantities only) and legend. */
import { useMemo } from 'react';
import { boxAxis } from '../../lib/boxAxis';
import { boxStats, hasNegative } from '../../lib/boxStats';
import { boxFormatter, boxTickFormatter, showsTotal, type BoxKind } from '../../lib/boxFormat';
import { rangeOf, selectedPart, withRangeRule, inclusiveMax } from '../../lib/boxFilters';
import { useRunPage } from '../../RunContext';
import { BoxLegend, BoxNumbers, BoxPlot, boxSentence, type BoxPart } from './BoxPlot';

export interface BoxEntry {
  /** Item the value belongs to (a dot opens it). */
  id: string;
  v: number;
}

/** Box plot clicks as filters for one field: the page's latency range, or a rule on a metric / tokens / cost. */
export function useBoxFilter(field: string) {
  const { api } = useRunPage();
  const filters = api.view.filters;
  const active =
    field === 'latency'
      ? filters.latency
        ? { min: filters.latency.min, max: filters.latency.max }
        : null
      : rangeOf(filters.rules, field);
  const onRange = (_part: BoxPart, min: number, max: number) => {
    if (field === 'latency') {
      const on = active && Math.abs(active.min - min) < 1e-9;
      api.setFilters({ latency: on ? null : { min, max: inclusiveMax(max) } });
    } else {
      const on = active && Math.abs(active.min - min) < 1e-9 && Math.abs(active.max - max) < 1e-9;
      api.setFilters({
        rules: on
          ? {
              op: 'and',
              children: filters.rules.children.filter((c) => !('field' in c) || c.field !== field),
            }
          : withRangeRule(filters.rules, field, min, max),
      });
    }
  };
  return { active, onRange, openItem: (id: string) => api.setItemParam(id) };
}

export function BoxCardBody({
  entries,
  kind,
  name,
  field,
  tailTone,
  fixedDomain,
}: {
  entries: BoxEntry[];
  kind: BoxKind;
  /** Name of the quantity ("tokens_used"): starts the plot's accessible name. */
  name: string;
  /** Filter target: `latency` (the page's latency range) or a rule field (`metric:tokens_used`, `tokens`, `cost`). */
  field: string;
  tailTone?: boolean;
  fixedDomain?: [number, number];
}) {
  const values = useMemo(() => entries.map((e) => e.v), [entries]);
  const stats = useMemo(() => boxStats(values), [values]);
  const axis = useMemo(() => boxAxis(stats, { fixed: fixedDomain, values }), [stats, fixedDomain, values]);
  const fmt = boxFormatter(kind);
  const tick = boxTickFormatter(kind);
  const negative = useMemo(() => hasNegative(values), [values]);
  const total = showsTotal(kind, negative) && stats.n ? fmt(stats.sum) : undefined;
  const ids = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of entries) if (!m.has(e.v)) m.set(e.v, e.id);
    return m;
  }, [entries]);
  const { active, onRange, openItem } = useBoxFilter(field);
  return (
    <>
      <BoxPlot
        stats={stats}
        axis={axis}
        format={fmt}
        tickFormat={tick}
        name={boxSentence(name, stats, fmt, { total })}
        tailTone={tailTone}
        selected={selectedPart(
          active && field === 'latency' ? { min: active.min, max: active.max } : active,
          stats,
        )}
        onRange={stats.n > 1 ? onRange : undefined}
        onItem={(v) => {
          const id = ids.get(v);
          if (id) openItem(id);
        }}
        itemLabel={(v) => ids.get(v)}
      />
      <BoxNumbers stats={stats} format={fmt} total={total} />
      {stats.n ? <BoxLegend /> : null}
    </>
  );
}
