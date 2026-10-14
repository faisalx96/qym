/**
 * The compare page's state: the URL is the single source of truth (selection,
 * baseline, columns, metric, filters, sort, page, tab, open item). The
 * runs list's sessionStorage handoff is read once and immediately moved into
 * the URL (brief 05 §8 "State placement"); the page never writes it.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { rememberScroll } from '@/lib/scrollToElement';
import { compareKeys, useCompareQuery } from '@/api/compare';
import { useSearchParamsState } from '@/lib/url-state';
import { buildCompareModel, type CompareModel } from '../lib/model';
import {
  baseRunIds,
  expandRefs,
  MAX_COMPARE_RUNS,
  MIN_COMPARE_RUNS,
  passRefBase,
  readSelection,
  selectionParams,
} from '../lib/refs';
import { readView, writeView, type CompareView } from '../lib/filters';
import { resolveCohorts, type CohortGroups } from '../lib/cohort';
import { metricCtx, type MetricCtx } from '../lib/scoring';
import { useQueryClient } from '@tanstack/react-query';

function safeStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface CompareController {
  /** Requested refs before expansion (URL / session). */
  refs: string[];
  tooMany: boolean;
  selectionState: 'none' | 'too_few' | 'ok';
  query: ReturnType<typeof useCompareQuery>;
  model: CompareModel | null;
  view: CompareView;
  /** Item metric: view.metric else the model default. */
  metric: string | null;
  /** Overview metric (the same one; the legacy page kept one selection for both). */
  thresholds: Record<string, number>;
  ctx: MetricCtx | null;
  cohorts: CohortGroups | null;
  setView: (patch: Partial<CompareView>, opts?: { keepPage?: boolean }) => void;
  setThreshold: (metric: string, value: number | null) => void;
  setCohortLabels: (labels: { leftLabel?: string; rightLabel?: string }) => void;
  removeRun: (ref: string) => void;
  /** Missing runs the server could not return. */
  missing: string[];
  retry: () => void;
}

export function useCompareController(): CompareController {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const qc = useQueryClient();
  const selection = useMemo(() => readSelection(params, safeStorage()), [params]);

  // sessionStorage handoff -> URL (replace, so Back leaves the page).
  useEffect(() => {
    if (selection.source !== 'session') return;
    const next = selectionParams(selection.refs, selection.cohorts);
    replaceUrlQuery({
      runs: next.getAll('runs'),
      cohortA: next.getAll('cohortA'),
      cohortB: next.getAll('cohortB'),
      cohortALabel: next.get('cohortALabel'),
      cohortBLabel: next.get('cohortBLabel'),
    });
  }, [selection, replaceUrlQuery]);

  const bases = useMemo(() => baseRunIds(selection.refs), [selection.refs]);
  const tooMany = bases.length > MAX_COMPARE_RUNS;
  const selectionState: CompareController['selectionState'] = !selection.refs.length
    ? 'none'
    : selection.refs.length < MIN_COMPARE_RUNS
      ? 'too_few'
      : 'ok';
  const query = useCompareQuery(selectionState === 'ok' && !tooMany ? bases : []);

  const model = useMemo(() => {
    if (!query.data) return null;
    const refs = selection.cohorts ? [...selection.cohorts.left, ...selection.cohorts.right] : selection.refs;
    return buildCompareModel(query.data, refs);
  }, [query.data, selection]);

  const cohortGroups = useMemo(() => {
    if (!model || !query.data) return null;
    const explicit = selection.cohorts
      ? {
          left: expandRefs(
            selection.cohorts.left,
            query.data.runs.map((r) => r.run),
          ),
          right: expandRefs(
            selection.cohorts.right,
            query.data.runs.map((r) => r.run),
          ),
          leftLabel: selection.cohorts.leftLabel,
          rightLabel: selection.cohorts.rightLabel,
        }
      : null;
    return resolveCohorts(model, explicit);
  }, [model, query.data, selection.cohorts]);

  const view = useMemo(
    () =>
      readView(params, {
        metrics: model?.metrics ?? [],
        metadataKeys: model?.metadataKeys ?? [],
        runCount: model?.runs.length ?? 0,
        rows: model ? model.runs.flatMap((r) => r.rows) : [],
      }),
    [params, model],
  );
  const metric = view.metric ?? model?.defaultMetric ?? null;
  const thresholds = view.thresholds;
  const ctx = useMemo(
    () => (model && metric ? metricCtx(model, metric, thresholds) : null),
    [model, metric, thresholds],
  );

  const write = useCallback(
    (next: CompareView) => replaceUrlQuery(writeView(next, model?.defaultMetric ?? null)),
    [replaceUrlQuery, model?.defaultMetric],
  );
  const setView = useCallback<CompareController['setView']>(
    (patch, opts) => {
      // Any filter-like change returns to page 1 unless the caller says otherwise.
      const resets = Object.keys(patch).some(
        (k) =>
          k !== 'page' &&
          k !== 'item' &&
          k !== 'tab' &&
          k !== 'columns' &&
          k !== 'baseline' &&
          k !== 'catView',
      );
      write({ ...view, ...patch, page: patch.page ?? (resets && !opts?.keepPage ? 1 : view.page) });
    },
    [view, write],
  );
  const setThreshold = useCallback(
    (m: string, value: number | null) => {
      const next = { ...view.thresholds };
      if (value === null) delete next[m];
      else next[m] = value;
      write({ ...view, thresholds: next, page: 1 });
    },
    [view, write],
  );
  const setCohortLabels = useCallback<CompareController['setCohortLabels']>(
    (labels) => {
      if (!selection.cohorts) return;
      replaceUrlQuery({
        cohortALabel: labels.leftLabel ?? selection.cohorts.leftLabel,
        cohortBLabel: labels.rightLabel ?? selection.cohorts.rightLabel,
      });
    },
    [replaceUrlQuery, selection.cohorts],
  );
  const removeRun = useCallback(
    (ref: string) => {
      rememberScroll();
      const base = passRefBase(ref);
      const drop = (list: string[]) => list.filter((r) => passRefBase(r) !== base);
      if (selection.cohorts) {
        // A cohort stays paired: removing one run of a side removes the same slot of the other.
        const { left, right } = selection.cohorts;
        const i = left.findIndex((r) => passRefBase(r) === base);
        const j = right.findIndex((r) => passRefBase(r) === base);
        const slot = i >= 0 ? i : j;
        if (slot < 0) return;
        const keep = (list: string[]) => list.filter((_, k) => k !== slot);
        const nextLeft = keep(left);
        const nextRight = keep(right);
        if (nextLeft.length < 1) return;
        replaceUrlQuery({ cohortA: nextLeft, cohortB: nextRight });
        return;
      }
      const next = drop(selection.refs);
      if (next.length < MIN_COMPARE_RUNS) return;
      replaceUrlQuery({ runs: next });
    },
    [replaceUrlQuery, selection],
  );
  const retry = useCallback(() => {
    void qc.invalidateQueries({ queryKey: compareKeys.all });
    void query.refetch();
  }, [qc, query]);

  return {
    refs: selection.refs,
    tooMany,
    selectionState,
    query,
    model,
    view,
    metric,
    thresholds,
    ctx,
    cohorts: cohortGroups,
    setView,
    setThreshold,
    setCohortLabels,
    removeRun,
    missing: (query.data?.missing_runs ?? []).map((m) => m.run_id),
    retry,
  };
}
