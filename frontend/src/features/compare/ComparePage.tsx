/**
 * Compare runs (brief 05, UX_DECISION variant C "item-first"): the aligned item
 * diff list is the page; a sticky delta line is the header and filter control;
 * analytics live in a side panel that follows the filter. `/compare` and
 * `/projects/:slug/compare` share this page; the URL is the whole state.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { useDocumentTitle, useOptionalProject } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { platformUrl } from '@/lib/runtime';
import { KEYS, readLocal } from '@/lib/storage';
import {
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Stack,
  useToast,
} from '@/ui';
import { CompareCtx, type CompareValue } from './CompareContext';
import { DeltaLine } from './components/DeltaLine';
import { ItemsSection } from './components/items/ItemsSection';
import { ItemsUiHost } from './components/items/ItemsUi';
import { Notices } from './components/Notices';
import { AnalyticsPanel } from './components/panel/AnalyticsPanel';
import { RunCards } from './components/RunCards';
import { SelectionBar } from './components/SelectionBar';
import { SweepView } from './components/sweep/SweepView';
import { DetailsProvider, useNewDetailsStore } from './hooks/useDetails';
import { useCompareController, type CompareController } from './hooks/useCompareController';
import { useColumns } from './hooks/useColumnStats';
import { useCompareSearch } from './hooks/useCompareSearch';
import { applyFilters } from './lib/filters';
import { MAX_COMPARE_RUNS } from './lib/refs';
import type { CompareModel } from './lib/model';
import { computeComparisonStats } from './lib/stats';
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
  useDocumentTitle('Compare runs');
  const pending = useDelayedPending(c.query.isPending && c.selectionState === 'ok' && !c.tooMany);

  let body;
  if (c.selectionState === 'none')
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
        body="A comparison needs two or more runs."
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
  else if (c.query.isPending)
    body = pending ? <Skeleton kind="cards" count={3} label="Loading comparison" /> : null;
  else if (!c.model || c.model.runs.length < 2)
    body = (
      <ErrorState
        error={Object.assign(new Error('Not found'), { status: 404 })}
        title={
          c.missing.length === 1
            ? 'A run in this comparison was not found'
            : 'Runs in this comparison were not found'
        }
        message={`${c.missing.length || 'Some'} of the runs in this link ${c.missing.length === 1 ? 'was' : 'were'} deleted or ${c.missing.length === 1 ? 'is' : 'are'} not visible to you. A comparison needs at least 2 runs.${c.missing.length ? ` Missing: ${c.missing.join(', ')}` : ''}`}
        notFoundMessage="Not found"
        action={<BackLink slug={slug} />}
        compact
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
      {c.model && c.selectionState === 'ok' ? null : (
        <PageHeader
          title="Compare runs"
          description="Review configuration, performance and item-level differences."
        />
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
  const stats = useMemo(
    () => (c.ctx ? computeComparisonStats(model, c.ctx, itemIds) : null),
    [model, c.ctx, itemIds],
  );
  const [panel, setPanel] = useState(true);
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
  };
  const sweep = c.view.tab === 'sweep' && !!c.cohorts;
  const first = model.runs[0]?.run;
  return (
    <CompareCtx.Provider value={value}>
      <MissingToast missing={c.missing} />
      <PageHeader
        title="Compare runs"
        description="Scan the items that changed; the analytics follow your filter."
        meta={[
          `${info.columns.length} column${info.columns.length === 1 ? '' : 's'}`,
          first?.dataset_name ?? '',
          `${model.itemIds.length} aligned items`,
        ].filter(Boolean)}
        actions={
          <>
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
              isDisabled={model.bases.length < 2 || model.bases.length > MAX_EXPORT_RUNS}
              title={
                model.bases.length > MAX_EXPORT_RUNS
                  ? `Export at most ${MAX_EXPORT_RUNS} runs at once`
                  : 'Download this comparison as one self-contained HTML file'
              }
            >
              Export HTML
            </LinkButton>
          </>
        }
      />
      <Stack gap="sm">
        <Notices />
      </Stack>
      <div className={styles.sticky}>
        <SelectionBar />
        {sweep ? null : (
          <DeltaLine info={info} analyticsOpen={panel} onToggleAnalytics={() => setPanel((p) => !p)} />
        )}
      </div>
      <RunCards />
      <ItemsUiHost>
        {sweep ? (
          <SweepView />
        ) : (
          <div className={styles.body} data-panel={panel ? '' : undefined}>
            <main className={styles.main} aria-label="Items">
              <ItemsSection />
            </main>
            {panel ? <AnalyticsPanel /> : null}
          </div>
        )}
      </ItemsUiHost>
    </CompareCtx.Provider>
  );
}
