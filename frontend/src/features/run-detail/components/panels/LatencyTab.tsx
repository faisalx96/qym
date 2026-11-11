/**
 * Latency and traces (round 10, the approved legacy design of latency_traces.js): "Response time" (the latency
 * distribution that filters the page, quality against latency for the page metric) and "Inside the traces" (time
 * budget, kind cards, step timings).
 */
import { useMemo } from 'react';
import { useStepLatencyQuery } from '@/api/runs';
import { isNotReceivedRow, isTaskErrorRow } from '@/lib/metrics';
import { applyItemFilters, rowScoreFor } from '../../lib/filterRules';
import type { LatencyItem } from '../../lib/latencyModel';
import { useItemSearch } from '../../hooks/useItemSearch';
import { useRunPage } from '../../RunContext';
import { InsideTraces } from '../latency/InsideTraces';
import { ResponseTime } from '../latency/ResponseTime';
import styles from './Latency.module.css';
import panel from './Panels.module.css';

export function LatencyTab() {
  const { items, api, runId, model, payload } = useRunPage();
  const metric = api.selectedMetric;
  const hasSpans = payload.run.trace_stats?.has_spans === true;
  const query = useStepLatencyQuery(runId, model.viewPass, hasSpans);
  // The histogram shows every item the page keeps except by latency, so its own filter stays a selection on it.
  const latencyFilter = api.view.filters.latency;
  const lazy = payload.snapshot.detail_mode === 'lazy';
  const search = useItemSearch(runId, model, api.view.q, api.view.filters.rules, lazy);
  const pageItems = useMemo(
    () =>
      latencyFilter
        ? applyItemFilters(
            api.ctx,
            { ...api.view, filters: { ...api.view.filters, latency: null } },
            api.defs,
            { searchMatcher: search.searchMatcher, outputMatcher: search.outputMatcher },
          )
        : items,
    [latencyFilter, items, api.ctx, api.view, api.defs, search.searchMatcher, search.outputMatcher],
  );
  const latencyItems = useMemo<LatencyItem[]>(() => {
    const idx = metric ? model.metricNames.indexOf(metric) : -1;
    return pageItems
      .filter(({ row }) => !isNotReceivedRow(row))
      .map(({ row }) => {
        const latency = row.latency_ms == null ? NaN : Number(row.latency_ms);
        const outcome = idx >= 0 && metric ? rowScoreFor(api.ctx, row, idx, metric) : null;
        return {
          itemId: String(row.item_id ?? row.index ?? ''),
          // A completed item's recorded time is its run time, zero included; a failed item's counts when it has one.
          latency:
            Number.isFinite(latency) && latency >= 0 && (row.status === 'completed' || latency > 0)
              ? latency
              : NaN,
          // Its own run failed (metric errors are not task errors).
          error: isTaskErrorRow(row),
          score: outcome?.score != null && Number.isFinite(outcome.score) ? outcome.score : null,
        };
      })
      .filter((i) => Number.isFinite(i.latency));
  }, [pageItems, metric, model.metricNames, api.ctx]);
  if (!latencyItems.length && !hasSpans)
    return <p className={panel.note}>No latency or trace data for this run.</p>;
  return (
    <div className={styles.root} data-testid="latency-panel">
      {latencyItems.length ? <ResponseTime items={latencyItems} metric={metric} /> : null}
      {hasSpans ? <InsideTraces query={query} /> : null}
    </div>
  );
}
