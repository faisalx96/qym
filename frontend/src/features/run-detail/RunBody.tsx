/**
 * Report layout: hero on top, the sticky section nav, then every analysis section stacked at full width and the
 * Items table last. While the reader has narrowed the item set (a scope), a quick-filter sidebar appears.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { usePassesQuery } from '@/api/runs';
import { useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { readJson, writeJson } from '@/lib/storage';
import { ReportLayout, ScopeBar, Stack } from '@/ui';
import { ExperimentPanel, ReviewHistory, RunNotices, VersioningDetails } from './components/RunPanels';
import { RunHero } from './components/RunHero';
import { QuickFilters } from './components/QuickFilters';
import { ReportSections, isSectionKey, sectionDomId } from './components/ReportSections';
import { SectionNav, type SectionId } from './components/SectionNav';
import { ItemsSection } from './components/ItemsSection';
import { TraceHost } from './components/TraceHost';
import { useItemSearch } from './hooks/useItemSearch';
import { useLiveRun } from './hooks/useLiveRun';
import { alignToElement } from '@/lib/scrollToElement';
import { useSidebarHidden } from '@/lib/useSidebarHidden';
import { useScope } from './hooks/useScope';
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

/** Old anchors that name no section (`#summary`) or a retired alias. */
const HASH_ALIASES: Record<string, SectionId> = { summary: 'summary' };

/** Scroll the shell to a section; lazy sections above it mount while it travels, so re-align until the layout settles. */
function scrollToSection(id: SectionId, host: HTMLElement | null) {
  const scroller = document.getElementById('shell-content');
  if (id === 'summary') {
    scroller?.scrollTo({ top: 0 });
    return;
  }
  const el = document.getElementById(sectionDomId(id));
  if (!el) return;
  alignToElement(el, host);
}

/** Everything below the hero: nav, scope bar, sidebar, sections and items (needs the run context). */
function RunReport({ pageRef }: { pageRef: React.RefObject<HTMLDivElement | null> }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const wide = useMediaQuery(WIDE_QUERY);
  const scope = useScope();
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!scope.active && drawerOpen) setDrawerOpen(false);
  const onSection = useCallback((id: SectionId) => scrollToSection(id, pageRef.current), [pageRef]);

  // Links from before the report layout: `#overview`, `#run-section-errors`, `?panel=latency`.
  const hash = location.hash.replace(/^#(run-section-|section-)?/, '');
  const panelParam = params.get('panel');
  useEffect(() => {
    const target: SectionId | null = isSectionKey(hash)
      ? hash
      : (HASH_ALIASES[hash] ?? (isSectionKey(panelParam) ? panelParam : null));
    if (target) scrollToSection(target, pageRef.current);
  }, [hash, panelParam, pageRef]);

  const jumpToItems = () => {
    setDrawerOpen(false);
    onSection('items');
  };
  const scopeNote = scope.active
    ? `over ${scope.shown.toLocaleString('en-US')} of ${scope.total.toLocaleString('en-US')} items`
    : undefined;
  return (
    <>
      <SectionNav onSection={onSection} />
      <ReportLayout
        wide={wide}
        sidebarOpen={scope.active && !sidebarHidden}
        drawerOpen={drawerOpen && scope.active}
        onDrawerOpenChange={setDrawerOpen}
        sidebar={
          scope.active ? (
            <QuickFilters onHide={wide ? () => setSidebarHidden(true) : undefined} onJump={jumpToItems} />
          ) : undefined
        }
      >
        {scope.active ? (
          <ScopeBar
            shown={scope.shown}
            total={scope.total}
            chips={scope.chips}
            onClearAll={() => {
              setDrawerOpen(false);
              scope.clearAll();
            }}
            onJumpToItems={jumpToItems}
            narrow={!wide}
            hideChips={wide && !sidebarHidden}
            sidebarOpen={wide ? !sidebarHidden : drawerOpen}
            onToggleSidebar={() => (wide ? setSidebarHidden(!sidebarHidden) : setDrawerOpen(true))}
          />
        ) : null}
        <ReportSections scopeNote={scopeNote} />
        <ItemsSection />
      </ReportLayout>
    </>
  );
}

export function RunBody({ runId, payload }: { runId: string; payload: RunPayload }) {
  const { slug, readOnly } = useProjectContext();
  const [params] = useSearchParams();
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
  const pageRef = useRef<HTMLDivElement>(null);
  return (
    <RunContext.Provider value={value}>
      <div ref={pageRef} className={`${fullWidth} ${styles.page}`}>
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
            extra={<VersioningDetails run={run} flat />}
          />
          <ExperimentPanel run={run} slug={slug} />
          <RunNotices run={run} readOnly={readOnly} />
          <div id={sectionDomId('reviews')} className={styles.reviews}>
            <ReviewHistory runId={runId} status={run.status} />
          </div>
        </Stack>
        <RunReport pageRef={pageRef} />
      </div>
      <TraceHost />
    </RunContext.Provider>
  );
}
