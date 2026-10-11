/**
 * The page's view state lives in the query string (brief 04 §8 "URL"):
 * q, sort, view, metric, threshold, show, filters, page, hide_field[],
 * hide_metric_field[], plus item / pass / trace / list which are read here
 * too. Writes use replaceState and never scroll.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { applyQueryUpdates, type QueryUpdates } from '@/lib/url-state';
import {
  buildFieldDefs,
  effectiveThresholds,
  readRunView,
  writeRunView,
  type FieldDef,
  type FilterContext,
  type PageFilters,
  type RunView,
} from '../lib/filterRules';
import type { RunModel } from '../lib/runModel';

export interface RunViewApi {
  view: RunView;
  ctx: FilterContext;
  defs: FieldDef[];
  selectedMetric: string | null;
  setView: (patch: Partial<RunView> | ((prev: RunView) => Partial<RunView>)) => void;
  /** Replace the whole view (chip removal). */
  replaceView: (next: RunView) => void;
  setFilters: (patch: Partial<PageFilters> | ((prev: PageFilters) => Partial<PageFilters>)) => void;
  clearFilters: () => void;
  /** Non-view params the page also owns. */
  itemParam: string | null;
  traceParam: string | null;
  listParam: string | null;
  setItemParam: (itemId: string | null) => void;
  setTraceParam: (itemId: string | null, pass?: number | null) => void;
  tracePassParam: number | null;
}

export function readPassParam(params: URLSearchParams): number | null {
  const raw = params.get('pass');
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function useRunView(model: RunModel): RunViewApi {
  const [params, setParams] = useSearchParams();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const decodeCtx = useMemo(
    () => ({
      model,
      metricNames: model.metricNames,
      metadataKeys: model.allMetadataKeys,
      rows: model.rows,
      repeatAggregate,
    }),
    [model, repeatAggregate],
  );
  const view = useMemo(() => readRunView(params, decodeCtx), [params, decodeCtx]);
  const selectedMetric = view.metric ?? model.defaultMetric;
  const ctx = useMemo<FilterContext>(
    () => ({ model, thresholds: effectiveThresholds(model, view), selectedMetric, repeatAggregate }),
    [model, view, selectedMetric, repeatAggregate],
  );
  const defs = useMemo(() => buildFieldDefs(ctx), [ctx]);

  const write = useCallback(
    (next: RunView, extra: QueryUpdates = {}) => {
      setParams((prev) => applyQueryUpdates(prev, { ...writeRunView(next, model, defs), ...extra }), {
        replace: true,
        preventScrollReset: true,
      });
    },
    [defs, model, setParams],
  );

  const setView = useCallback(
    (patch: Partial<RunView> | ((prev: RunView) => Partial<RunView>)) => {
      const p = typeof patch === 'function' ? patch(view) : patch;
      const next: RunView = { ...view, ...p };
      // any filter/search/sort change resets the page unless the patch sets it
      if (
        !('page' in p) &&
        Object.keys(p).some((k) => k !== 'hideFields' && k !== 'hideMetricFields' && k !== 'view')
      ) {
        next.page = 1;
      }
      write(next);
    },
    [view, write],
  );

  const setFilters = useCallback(
    (patch: Partial<PageFilters> | ((prev: PageFilters) => Partial<PageFilters>)) => {
      const p = typeof patch === 'function' ? patch(view.filters) : patch;
      write({ ...view, page: 1, filters: { ...view.filters, ...p } });
    },
    [view, write],
  );

  const clearFilters = useCallback(() => {
    write({ ...view, show: 'all', page: 1, filters: readRunView(new URLSearchParams(), decodeCtx).filters });
  }, [decodeCtx, view, write]);

  const setParam = useCallback(
    (key: 'item' | 'trace', value: string | null, tracePass: number | null = null) => {
      setParams(
        (prev) =>
          applyQueryUpdates(prev, {
            [key]: value,
            ...(key === 'item' ? { item_id: null } : { trace_pass: value ? tracePass : null }),
          }),
        {
          replace: true,
          preventScrollReset: true,
        },
      );
    },
    [setParams],
  );

  return useMemo(
    () => ({
      view,
      ctx,
      defs,
      selectedMetric,
      setView,
      replaceView: write,
      setFilters,
      clearFilters,
      itemParam: params.get('item') ?? params.get('item_id'),
      traceParam: params.get('trace'),
      listParam: params.get('list'),
      setItemParam: (id) => setParam('item', id),
      setTraceParam: (id, pass) => setParam('trace', id, pass ?? null),
      tracePassParam: Number(params.get('trace_pass')) || null,
    }),
    [view, ctx, defs, selectedMetric, setView, write, setFilters, clearFilters, params, setParam],
  );
}
