/** Opens the trace drawer from ?trace=ITEM[&trace_pass=N]; closing removes the params and the page focus returns to the trigger. */
import { rowPassesFor, rowScoreFor, type FilterContext } from '../lib/filterRules';
import { scopeRowToPass } from '../lib/passScope';
import type { RunModel } from '../lib/runModel';
import { useRunPage } from '../RunContext';
import { TraceDrawer } from './traces/TraceDrawer';

/**
 * The pass a repeat run's drawer opens on (C009): the pass the page is scoped to, else the first pass that fails the
 * page metric (or errors), else pass 1. A repeat run never opens on all passes merged.
 */
export function defaultTracePass(
  model: Pick<RunModel, 'rows' | 'metricNames' | 'samples'>,
  ctx: FilterContext,
  metric: string | null,
  itemId: string,
): number {
  const row = model.rows.find((r) => r.item_id === itemId);
  const idx = metric ? model.metricNames.indexOf(metric) : -1;
  if (row && metric && idx >= 0) {
    for (let p = 1; p <= model.samples; p++) {
      const outcome = rowScoreFor(ctx, scopeRowToPass(row, model.metricNames, p), idx, metric);
      if (outcome.isError || rowPassesFor(ctx, metric, outcome) === false) return p;
    }
  }
  return 1;
}

export function TraceHost() {
  const { api, model } = useRunPage();
  const itemId = api.traceParam;
  if (!itemId) return null;
  const pass =
    api.tracePassParam ??
    model.viewPass ??
    (model.isRepeat ? defaultTracePass(model, api.ctx, api.selectedMetric, itemId) : null);
  return (
    <TraceDrawer
      key={`${itemId}:${pass ?? ''}`}
      itemId={itemId}
      pass={pass}
      passCount={model.isRepeat ? model.samples : 0}
      onPass={(p) => api.setTraceParam(itemId, p)}
      onClose={() => api.setTraceParam(null)}
    />
  );
}
