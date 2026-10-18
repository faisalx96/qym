/**
 * Report layout: hero on top, the sticky section nav, then every analysis section stacked at full width and the
 * Items table last. While the reader has narrowed the item set (a scope), a quick-filter sidebar appears.
 */
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { api as http } from '@/lib/http';
import {
  loadedGroups,
  LATE_GROUPS,
  runKeys,
  stepLatencyUrl,
  useRowGroupQuery,
  usePassesQuery,
} from '@/api/runs';
import { useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { ReportLayout, ScopeBar, Stack } from '@/ui';
import { ExperimentPanel, ReviewHistory, RunNotices } from './components/RunPanels';
import { RunHero } from './components/RunHero';
import { QuickFilters } from './components/QuickFilters';
import { ReportSections, isSectionKey, sectionDomId } from './components/ReportSections';
import { SectionNav, type SectionId } from './components/SectionNav';
import { ItemsSkeleton } from './components/StageSkeletons';
import { loadItemsSection, loadTraceHost, preloadPanels } from './chunks';
import { useItemSearch } from './hooks/useItemSearch';
import { useLiveRun } from './hooks/useLiveRun';
import { alignToElement } from '@/lib/scrollToElement';
import { useSidebarHidden } from '@/lib/useSidebarHidden';
import { useScope } from './hooks/useScope';
import { readPassParam, useRunView } from './hooks/useRunView';
import { applyItemFilters, isFilterGroup, type FilterNode } from './lib/filterRules';
import { inferPassSummary } from './lib/passScope';
import { buildRunModel } from './lib/runModel';
import { scoresLocked } from './lib/heroModel';
import { RunContext, useRunPage, type RunPageValue } from './RunContext';
import type { PassSummary, RowGroup, RunPayload, StepLatencyPayload } from './types';
import styles from './RunBody.module.css';

/** A rule that reads item text (input, output or expected). */
function rulesNeedText(node: FilterNode): boolean {
  return isFilterGroup(node)
    ? node.children.some(rulesNeedText)
    : ['input', 'output', 'expected'].includes(String(node.field));
}

// The Items table and the trace drawer are separate chunks: the header and the Overview do not wait for them.
const ItemsSection = lazy(() => loadItemsSection().then((m) => ({ default: m.ItemsSection })));
const TraceHost = lazy(() => loadTraceHost().then((m) => ({ default: m.TraceHost })));

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
  const { rowsPending } = useRunPage();
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
        {rowsPending ? (
          <ItemsSkeleton />
        ) : (
          <Suspense fallback={<ItemsSkeleton />}>
            <ItemsSection />
          </Suspense>
        )}
      </ReportLayout>
    </>
  );
}

export function RunBody({
  runId,
  payload,
  rowsPending = false,
  summary,
  summaryPending = false,
}: {
  runId: string;
  payload: RunPayload;
  rowsPending?: boolean;
  /** The run summary (stage 1), once it has answered: carries the review count and the pager's neighbours. */
  summary?: RunPayload;
  /** The summary has not answered (the header is the list row): hold the requests it makes unnecessary. */
  summaryPending?: boolean;
}) {
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

  // Late row groups (the item texts): requested by the section that reads them when it nears the viewport.
  const [wanted, setWanted] = useState<ReadonlySet<RowGroup>>(() => new Set());
  const needGroup = useCallback((group: RowGroup) => {
    setWanted((prev) => (prev.has(group) ? prev : new Set(prev).add(group)));
  }, []);
  const loaded = loadedGroups(rowsPending ? undefined : payload);
  const hasGroup = useCallback(
    (group: RowGroup) => !rowsPending && loaded.includes(group),
    [rowsPending, loaded],
  );
  // Search and rules read the item texts: a search box or a rule asks for them.
  const wantsText = Boolean(api.view.q) || rulesNeedText(api.view.filters.rules);
  for (const group of LATE_GROUPS)
    // eslint-disable-next-line react-hooks/rules-of-hooks -- LATE_GROUPS is a constant list
    useRowGroupQuery(
      runId,
      group,
      (wanted.has(group) || (group === 'text' && wantsText)) && !rowsPending && !loaded.includes(group),
    );

  // Everything else loads by itself once the core rows have painted, with no scroll or click: the item texts and the
  // remaining panel chunks and section data, in the browser's idle time (aborted when the page is left).
  const qc = useQueryClient();
  useEffect(() => {
    if (rowsPending) return undefined;
    const run = () => {
      needGroup('text');
      preloadPanels();
      void qc.prefetchQuery({
        queryKey: runKeys.stepLatency(runId, null),
        queryFn: ({ signal }) => http.get<StepLatencyPayload>(stepLatencyUrl(runId, null), { signal }),
        staleTime: 60_000,
      });
    };
    if (typeof window.requestIdleCallback !== 'function') {
      const id = globalThis.setTimeout(run, 50);
      return () => globalThis.clearTimeout(id);
    }
    const id = window.requestIdleCallback(run, { timeout: 300 });
    return () => window.cancelIdleCallback(id);
  }, [rowsPending, needGroup, qc, runId]);

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
    reviewEventCount: summary?.review_event_count,
    summaryPending,
    summaryNeighbors: summary?.neighbors,
    rowsPending,
    hasGroup,
    needGroup,
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
          />
          <ExperimentPanel run={run} slug={slug} />
          <RunNotices run={run} readOnly={readOnly} />
          <div id={sectionDomId('reviews')} className={styles.reviews}>
            <ReviewHistory
              runId={runId}
              status={run.status}
              enabled={summary ? summary.review_event_count !== 0 : !summaryPending}
            />
          </div>
        </Stack>
        <RunReport pageRef={pageRef} />
      </div>
      {rowsPending ? null : (
        <Suspense fallback={null}>
          <TraceHost />
        </Suspense>
      )}
    </RunContext.Provider>
  );
}
