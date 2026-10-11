/**
 * Items-first layout (UX_DECISION: variant C). Hero on top; the item table is
 * the page; analysis lives in a sticky side panel whose charts are filter
 * sources. Under 1200 px the panel opens as a drawer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { usePassesQuery } from '@/api/runs';
import { useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { readJson, writeJson } from '@/lib/storage';
import { Stack } from '@/ui';
import { AnalysisPanel, PANEL_TABS, type PanelTab } from './components/AnalysisPanel';
import { ExperimentPanel, RunNotices, VersioningDetails } from './components/RunPanels';
import { RunHero } from './components/RunHero';
import { ItemsSection } from './components/ItemsSection';
import { TraceHost } from './components/TraceHost';
import { useItemSearch } from './hooks/useItemSearch';
import { useLiveRun } from './hooks/useLiveRun';
import { readPassParam, useRunView } from './hooks/useRunView';
import { applyItemFilters } from './lib/filterRules';
import { inferPassSummary } from './lib/passScope';
import { buildRunModel } from './lib/runModel';
import { scoresLocked } from './lib/heroModel';
import { RunContext, type RunPageValue } from './RunContext';
import type { PassSummary, RunPayload } from './types';
import styles from './RunBody.module.css';

const HERO_KEY = 'qym:run-hero-expanded';
export const WIDE_QUERY = '(min-width: 1200px)';

/** Legacy section anchors (#overview …) → the panel tab that now holds them. */
const HASH_TAB: Record<string, PanelTab | 'items'> = {
  overview: 'overview',
  latency: 'latency',
  deep: 'deep',
  categories: 'categories',
  errors: 'errors',
  'root-cause': 'root-cause',
  repeat: 'repeat',
  reviews: 'reviews',
  items: 'items',
};

export function RunBody({ runId, payload }: { runId: string; payload: RunPayload }) {
  const { slug, readOnly } = useProjectContext();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const passParam = readPassParam(params);
  const model = useMemo(() => buildRunModel(payload, passParam), [payload, passParam]);
  const api = useRunView(model);
  const live = useLiveRun(runId, payload);
  const passesQuery = usePassesQuery(runId, model.isRepeat);
  const passSummary = useMemo<PassSummary | null>(() => {
    if (!model.viewPass) return null;
    const inferred = inferPassSummary(
      model.rows,
      model.viewPass,
      Number(payload.run.last_completed_pass ?? 0),
      payload.run.status,
    );
    const server = passesQuery.data?.passes?.find((p) => p.pass_number === model.viewPass);
    return { ...inferred, ...(server ?? {}) } as PassSummary;
  }, [model.rows, model.viewPass, passesQuery.data, payload.run]);
  useDocumentTitle(
    `${payload.run.run_name || payload.run.run_id}${model.viewPass ? ` • Pass ${model.viewPass}` : ''}`,
  );

  const lazy = payload.snapshot.detail_mode === 'lazy';
  const search = useItemSearch(runId, model, api.view.q, api.view.filters.rules, lazy);
  const items = useMemo(
    () =>
      applyItemFilters(api.ctx, api.view, api.defs, {
        searchMatcher: search.searchMatcher,
        outputMatcher: search.outputMatcher,
      }),
    [api.ctx, api.view, api.defs, search.searchMatcher, search.outputMatcher],
  );

  const [heroExpanded, setHeroExpanded] = useState(() => readJson<boolean>(HERO_KEY, false));
  const toggleHero = useCallback(() => {
    setHeroExpanded((v) => {
      writeJson(HERO_KEY, !v);
      return !v;
    });
  }, []);

  const wide = useMediaQuery(WIDE_QUERY);
  const panelParam = params.get('panel');
  const tab: PanelTab = (PANEL_TABS as readonly string[]).includes(panelParam ?? '')
    ? (panelParam as PanelTab)
    : 'overview';
  const [panelOpen, setPanelOpen] = useState(() => wide || !!panelParam);
  const [wasWide, setWasWide] = useState(wide);
  if (wasWide !== wide) {
    setWasWide(wide);
    setPanelOpen(wide);
  }
  const selectTab = useCallback(
    (next: PanelTab) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next === 'overview') n.delete('panel');
          else n.set('panel', next);
          return n;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );

  // Section anchors from old links.
  const hash = location.hash.replace(/^#(section-)?/, '');
  useEffect(() => {
    const target = HASH_TAB[hash];
    if (!target) return;
    if (target === 'items') {
      document.getElementById('run-items')?.scrollIntoView({ block: 'start' });
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelOpen(true);
    selectTab(target);
  }, [hash, selectTab]);

  const basePath = runPath(slug, runId);
  const value: RunPageValue = {
    slug,
    runId,
    payload,
    model,
    api,
    live,
    passSummary,
    items,
    readOnly,
    scoresLocked: scoresLocked(payload.run),
    basePath,
  };
  const run = payload.run;
  return (
    <RunContext.Provider value={value}>
      <div className={`${fullWidth} ${styles.page}`}>
        <Stack gap="md">
          <RunHero
            run={run}
            model={model}
            live={live}
            passSummary={passSummary}
            slug={slug}
            listParam={api.listParam}
            basePath={basePath}
            expanded={heroExpanded}
            onToggleExpanded={toggleHero}
          />
          {heroExpanded ? (
            <>
              <VersioningDetails run={run} />
              <ExperimentPanel run={run} slug={slug} />
            </>
          ) : null}
          <RunNotices run={run} readOnly={readOnly} />
        </Stack>
        <div className={styles.split} data-panel={panelOpen && wide ? 'open' : 'closed'}>
          <ItemsSection panelOpen={panelOpen} onOpenPanel={() => setPanelOpen(true)} wide={wide} />
          <AnalysisPanel
            open={panelOpen}
            onOpenChange={setPanelOpen}
            tab={tab}
            onTab={selectTab}
            wide={wide}
          />
        </div>
      </div>
      <TraceHost />
    </RunContext.Provider>
  );
}
