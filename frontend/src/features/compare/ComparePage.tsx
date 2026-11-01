/**
 * Compare runs (brief 05, UX_DECISION variant C "item-first"): the aligned item
 * diff list is the page; a sticky delta line is the header and filter control;
 * analytics live in a side panel that follows the filter. `/compare` and
 * `/projects/:slug/compare` share this page; the URL is the whole state.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { restoreScroll } from '@/lib/scrollToElement';
import { Link, useSearchParams } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { useDocumentTitle, useOptionalProject } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { platformUrl } from '@/lib/runtime';
import { KEYS, readLocal } from '@/lib/storage';
import {
  EmptyState,
  ErrorState,
  Icon,
  LinkButton,
  PageHeader,
  SegmentedControl,
  SeriesHighlightRoot,
  useToast,
} from '@/ui';
import { CompareCtx, runLetters, type CompareValue } from './CompareContext';
import { CompareBar } from './components/CompareBar';
import { CompareBody } from './components/CompareBody';
import { CompareSkeleton } from './components/CompareSkeleton';
import { ItemsUiHost } from './components/items/ItemsUi';
import { Notices } from './components/Notices';
import { BaselineSelect, CohortBanner } from './components/SelectionBar';
import { SweepView } from './components/sweep/SweepView';
import { DetailsProvider, useNewDetailsStore } from './hooks/useDetails';
import { useCompareController, type CompareController } from './hooks/useCompareController';
import { useColumns } from './hooks/useColumnStats';
import { useCompareSearch } from './hooks/useCompareSearch';
import { applyFilters } from './lib/filters';
import { MAX_COMPARE_RUNS } from './lib/refs';
import type { CompareModel } from './lib/model';
import { computeComparisonStats } from './lib/stats';
import { compareTitle } from './lib/title';
import styles from './ComparePage.module.css';

/** `GET /api/compare/export-html`: a summary of the runs plus each run's offline report, in one file. */
const MAX_EXPORT_RUNS = 8;
function compareExportUrl(bases: string[]): string {
  const query = bases.map((id) => `files=${encodeURIComponent(id)}`).join('&');
  return platformUrl(`/api/compare/export-html?${query}`);
}

function BackLink({ slug }: { slug: string | undefined }) {
  return <Link to={slug ? projectPath(slug) : '/'}>{'←'} Back to runs</Link>;
}

export function ComparePage() {
  const c = useCompareController();
  const project = useOptionalProject();
  const slug = project?.slug ?? readLocal(KEYS.lastProjectSlug) ?? undefined;
  const store = useNewDetailsStore();
  const titleInfo = useColumns(c.model, c.view);
  // The tab names what is compared (C245); 'Compare' is the page's one name until the runs load (C147).
  useDocumentTitle(
    c.model && c.model.runs.length >= 2 && titleInfo ? compareTitle(c.model, titleInfo.baseline) : 'Compare',
  );
  // A run removed from the comparison unmounts the body while the new set loads; put the reader back where they were.
  useLayoutEffect(() => {
    if (c.model) restoreScroll();
  }, [c.model]);
  const pending = useDelayedPending(c.query.isPending && c.selectionState === 'ok' && !c.tooMany);

  const [searchParams] = useSearchParams();
  const sideA = searchParams.getAll('cohortA').length;
  const sideB = searchParams.getAll('cohortB').length;
  let body;
  if (c.selectionState === 'none' && sideA !== sideB && sideA + sideB > 0)
    body = (
      <EmptyState
        title="The two sides do not match"
        body={`Both sides need the same number of runs; this link has ${sideA} on side A and ${sideB} on side B.`}
        action={<BackLink slug={slug} />}
      />
    );
  else if (c.selectionState === 'none')
    body = (
      <EmptyState
        title="No runs to compare"
        body="Select two or more runs on the Runs page and press Compare."
        action={<BackLink slug={slug} />}
      />
    );
  else if (c.selectionState === 'too_few')
    body = (
      <EmptyState
        title="Select at least two runs"
        body={
          c.refs.length === 1
            ? 'This run has one pass. A comparison needs two or more runs, or one run with several passes.'
            : 'A comparison needs two or more runs.'
        }
        action={<BackLink slug={slug} />}
      />
    );
  else if (c.tooMany)
    body = (
      <ErrorState
        error={new Error(`Compare at most ${MAX_COMPARE_RUNS} runs at once (${c.refs.length} requested)`)}
        title="Too many runs"
        message={`Compare at most ${MAX_COMPARE_RUNS} runs at once; this link has ${c.refs.length}.`}
      />
    );
  else if (c.query.error)
    body = <ErrorState error={c.query.error} title="Couldn’t load this comparison" onRetry={c.retry} />;
  else if (c.query.isPending) body = pending ? <CompareSkeleton runs={c.refs.length} /> : null;
  else if (!c.model || c.model.runs.length < 2)
    body = (
      <EmptyState
        title={
          c.missing.length === 1
            ? 'A run in this comparison was not found'
            : 'Runs in this comparison were not found'
        }
        body={`${c.missing.length || 'Some'} of the runs in this link ${c.missing.length === 1 ? 'was' : 'were'} deleted or ${c.missing.length === 1 ? 'is' : 'are'} not visible to you. A comparison needs at least 2 runs.${c.missing.length ? ` Missing: ${c.missing.slice(0, 5).join(', ')}${c.missing.length > 5 ? ` + ${c.missing.length - 5} more` : ''}` : ''}`}
        action={<BackLink slug={slug} />}
      />
    );
  else
    body = (
      <DetailsProvider store={store}>
        <CompareLoaded c={c} model={c.model} slug={slug} />
      </DetailsProvider>
    );

  return (
    <div className={`${fullWidth} ${styles.page}`} data-testid="compare-page">
      {/* C245: every state but the loaded report keeps the page header */}
      {c.model &&
      c.selectionState === 'ok' &&
      !c.tooMany &&
      !c.query.error &&
      c.model.runs.length >= 2 ? null : (
        <PageHeader title="Compare runs" />
      )}
      {body}
    </div>
  );
}

function MissingToast({ missing }: { missing: string[] }) {
  const toast = useToast();
  const key = missing.join(',');
  useEffect(() => {
    if (!key) return;
    const n = key.split(',').length;
    toast.show(
      `${n} run${n === 1 ? '' : 's'} in this link ${n === 1 ? 'was' : 'were'} deleted or ${n === 1 ? 'is' : 'are'} not visible to you, so ${n === 1 ? 'it is' : 'they are'} left out. Missing: ${key.split(',').join(', ')}`,
      { tone: 'warning' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function CompareLoaded({
  c,
  model,
  slug,
}: {
  c: CompareController;
  model: CompareModel;
  slug: string | undefined;
}) {
  const info = useColumns(model, c.view);
  const metric = c.metric;
  const search = useCompareSearch(model, c.view.q, c.view.filters.rules);
  const result = useMemo(
    () =>
      metric
        ? applyFilters({
            model,
            view: c.view,
            metric,
            thresholds: c.thresholds,
            groups: c.cohorts,
            match: search.matcher,
          })
        : null,
    [model, c.view, metric, c.thresholds, c.cohorts, search.matcher],
  );
  const itemIds = useMemo(() => (result ? result.items.map((i) => i.itemId) : []), [result]);
  // C011: the Overview strip is over every aligned item; a score-derived filter selects rows for reading and must not
  // feed the statistics that defined it
  const stats = useMemo(
    () => (c.ctx ? computeComparisonStats(model, c.ctx, model.itemIds) : null),
    [model, c.ctx],
  );
  const barRef = useRef<HTMLDivElement>(null);
  const letters = useMemo(
    () =>
      runLetters(
        model.runs.map((r) => r.ref),
        c.cohorts,
      ),
    [model, c.cohorts],
  );
  // Sections and the sticky toolbar offset themselves by the real height of the sticky bar.
  const stuck =
    !!info && !!metric && !!c.ctx && !!result && !!stats && !(c.view.tab === 'sweep' && !!c.cohorts);
  useEffect(() => {
    const el = barRef.current?.querySelector<HTMLElement>('[data-compare-sticky]');
    const host = barRef.current;
    if (!el || !host || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => {
      host.style.setProperty('--report-nav-h', `${el.offsetHeight}px`);
      host.style.setProperty('--compare-chrome-h', `${el.offsetHeight}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--report-nav-h');
      host.style.removeProperty('--compare-chrome-h');
    };
  }, [stuck]);
  if (!info || !metric || !c.ctx || !result || !stats)
    return (
      <ErrorState
        error={new Error('These runs have no metrics to compare.')}
        title="Nothing to compare"
        compact
      />
    );
  const value: CompareValue = {
    c,
    model,
    metric,
    ctx: c.ctx,
    columns: info.columns,
    baseline: info.baseline,
    items: result.items,
    itemIds,
    stats,
    defs: result.defs,
    cohorts: c.cohorts,
    slug,
    searchPending: search.pending,
    letter: (i: number) => letters[i] ?? String(i + 1),
  };
  const sweep = c.view.tab === 'sweep' && !!c.cohorts;
  const first = model.runs[0]?.run;
  const title = compareTitle(model, info.baseline);
  return (
    <CompareCtx.Provider value={value}>
      <MissingToast missing={c.missing} />
      <header className={styles.titleBlock} data-part="title-block">
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title} data-testid="compare-title">
              {title}
            </h1>
            <BaselineSelect />
          </div>
          <p className={styles.meta}>
            <span>
              {info.columns.length} column{info.columns.length === 1 ? '' : 's'}
            </span>
            {first?.dataset_name ? (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.mono}>{first.dataset_name}</span>
              </>
            ) : null}
            {model.unpaired ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{model.itemIds.length} aligned items</span>
              </>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          {c.cohorts ? (
            <SegmentedControl<'compare' | 'sweep'>
              label="View"
              value={sweep ? 'sweep' : 'compare'}
              onChange={(v) => c.setView({ tab: v })}
              options={[
                { value: 'compare', label: 'Compare' },
                { value: 'sweep', label: 'Sweep' },
              ]}
            />
          ) : null}
          <LinkButton
            href={compareExportUrl(model.bases)}
            download
            variant="accent"
            icon={<Icon name="download" size={14} />}
            isDisabled={model.bases.length < 2 || model.bases.length > MAX_EXPORT_RUNS}
            title={
              model.bases.length > MAX_EXPORT_RUNS
                ? `Export at most ${MAX_EXPORT_RUNS} runs at once`
                : 'Download this comparison as one self-contained HTML file'
            }
          >
            Export HTML
          </LinkButton>
        </div>
      </header>
      <Notices />
      {c.cohorts ? <CohortBanner /> : null}
      <div ref={barRef} className={styles.focusRoot}>
        <SeriesHighlightRoot className={styles.focusRoot}>
          {sweep ? null : <CompareBar />}
          <ItemsUiHost>{sweep ? <SweepView /> : <CompareBody />}</ItemsUiHost>
        </SeriesHighlightRoot>
      </div>
    </CompareCtx.Provider>
  );
}
