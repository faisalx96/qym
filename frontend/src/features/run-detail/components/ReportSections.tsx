/** The analysis sections of the run report, stacked at full width (legacy order), plus the nav entries that point at them. */
import { lazy, Suspense, useMemo } from 'react';
import {
  loadCategoriesTab,
  loadDeepTab,
  loadErrorsTab,
  loadLatencyTab,
  loadOverviewTab,
  loadRepeatTab,
  loadRootCauseTab,
} from '../chunks';
import { useReviewHistoryQuery } from '@/api/runs';
import { metricDirectionLabel } from '@/lib/metrics';
import { ReportSection, StatStrip } from '@/ui';
import { runCounts } from '../lib/overviewModel';
import { errorBucketCount } from '../lib/panelCounts';
import { getRowRootCauseAnalyses } from '../lib/rowMeta';
import { useRunPage } from '../RunContext';
import { BlockSkeleton, ErrorsSkeleton, OverviewSkeleton } from './StageSkeletons';
import { DatasetsSection } from './panels/DatasetsSection';

// Every analysis panel is its own chunk, fetched when its section mounts (the Overview's starts with the page, below).
const panel = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const OverviewTab = panel(loadOverviewTab, 'OverviewTab');
const RepeatTab = panel(loadRepeatTab, 'RepeatTab');
const LatencyTab = panel(loadLatencyTab, 'LatencyTab');
const DeepTab = panel(loadDeepTab, 'DeepTab');
const CategoriesTab = panel(loadCategoriesTab, 'CategoriesTab');
const ErrorsTab = panel(loadErrorsTab, 'ErrorsTab');
const RootCauseTab = panel(loadRootCauseTab, 'RootCauseTab');

/** A panel's body: its skeleton while the rows (or the panel's chunk) are on the way. */
function Staged({
  pending,
  skeleton,
  children,
}: {
  pending: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}) {
  return pending ? skeleton : <Suspense fallback={skeleton}>{children}</Suspense>;
}

export type SectionKey =
  | 'reviews'
  | 'overview'
  | 'datasets'
  | 'repeat'
  | 'latency'
  | 'deep'
  | 'categories'
  | 'errors'
  | 'root-cause'
  | 'items';

/** Every section a link (`#overview`, `?panel=`, nav) can name, in page order. */
export const SECTION_KEYS: SectionKey[] = [
  'reviews',
  'overview',
  'datasets',
  'repeat',
  'latency',
  'deep',
  'categories',
  'errors',
  'root-cause',
  'items',
];

/** Old `?panel=` values: the tab ids of the retired side panel. */
export const isSectionKey = (v: string | null | undefined): v is SectionKey =>
  !!v && (SECTION_KEYS as string[]).includes(v);

/** DOM id of a section (Items keeps `run-items`, which the table and the pager already scroll to). */
export function sectionDomId(key: SectionKey): string {
  return key === 'items' ? 'run-items' : `run-section-${key}`;
}

export interface SectionEntry {
  id: SectionKey;
  label: string;
  count?: number;
  danger?: boolean;
}

/** Root cause shows only once the run has analyses (or an aggregation record). */
export function useHasRootCause(): boolean {
  const { model, payload } = useRunPage();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  return useMemo(
    () =>
      !!payload.run.metadata?.analysis_aggregation ||
      model.rows.some((row) => getRowRootCauseAnalyses(row, 'all', repeatAggregate).length > 0),
    [model.rows, payload.run.metadata, repeatAggregate],
  );
}

/** The sections this run shows, in page order, with the counts the nav displays. */
export function useSectionEntries(): SectionEntry[] {
  const { runId, model, items, payload, rowsPending, reviewEventCount, summaryPending } = useRunPage();
  const reviews = useReviewHistoryQuery(
    runId,
    reviewEventCount === undefined ? !summaryPending : reviewEventCount !== 0,
  );
  const reviewCount = reviews.data?.events.length ?? 0;
  // Until the rows arrive the nav shows the sections the summary knows about, without counts.
  const errorCount = rowsPending ? 0 : errorBucketCount(model.rows, model.isRepeat && !model.viewPass);
  const hasRootCause = useHasRootCause();
  const total = payload.snapshot.rows_total ?? payload.snapshot.rows.length;
  return [
    ...(reviewCount ? [{ id: 'reviews' as const, label: 'Reviews', count: reviewCount }] : []),
    { id: 'overview', label: 'Overview' },
    ...((payload.run.dataset_count ?? 1) > 1
      ? [{ id: 'datasets' as const, label: 'Datasets', count: payload.run.dataset_count }]
      : []),
    ...(model.isRepeat && !model.viewPass ? [{ id: 'repeat' as const, label: 'Repeat' }] : []),
    { id: 'latency', label: 'Latency' },
    { id: 'deep', label: 'Deep' },
    { id: 'categories', label: 'Categories' },
    { id: 'errors', label: 'Errors', ...(rowsPending ? {} : { count: errorCount, danger: errorCount > 0 }) },
    ...(hasRootCause ? [{ id: 'root-cause' as const, label: 'Root cause' }] : []),
    {
      id: 'items',
      label: 'Items',
      count: rowsPending
        ? total
        : items.length === payload.snapshot.rows.length
          ? payload.snapshot.rows.length
          : items.length,
    },
  ];
}

export function ReportSections({ scopeNote }: { scopeNote?: string }) {
  const { model, items, api, rowsPending, payload } = useRunPage();
  const hasRootCause = useHasRootCause();
  const repeatMetric = api.selectedMetric;
  const repeatDescription = `Every item was evaluated ${model.samples}×. ${metricDirectionLabel(
    repeatMetric ? (model.metricDirections[repeatMetric] ?? null) : null,
  )}.`;
  const counts = useMemo(
    () =>
      runCounts(
        items.map((i) => i.row),
        model.isRepeat && !model.viewPass,
      ),
    [items, model.isRepeat, model.viewPass],
  );
  return (
    <>
      <ReportSection
        id={sectionDomId('overview')}
        title="Overview"
        description="Score distributions per metric. Click a bar to filter the items."
        scopeNote={scopeNote}
        aside={
          <StatStrip
            variant="compact-header"
            aria-label="Run counts"
            items={[
              {
                key: 'items',
                label: 'Items',
                value: rowsPending ? (payload.snapshot.rows_total ?? '—') : counts.total,
              },
              { key: 'completed', label: 'Completed', value: rowsPending ? '—' : counts.completed },
              {
                key: 'errors',
                label: 'Errors',
                value: rowsPending ? '—' : counts.errors,
                tone: !rowsPending && counts.errors ? 'danger' : undefined,
              },
              ...(counts.notReceived
                ? [{ key: 'nr', label: 'Not received', value: counts.notReceived, tone: 'warning' as const }]
                : []),
            ]}
          />
        }
      >
        <Staged pending={rowsPending} skeleton={<OverviewSkeleton />}>
          <OverviewTab />
        </Staged>
      </ReportSection>
      {(payload.run.dataset_count ?? 1) > 1 ? <DatasetsSection /> : null}
      <ReportSection
        id={sectionDomId('repeat')}
        title="Repeat run analysis"
        description={repeatDescription}
        hidden={!(model.isRepeat && !model.viewPass)}
        lazy
        minHeight={320}
      >
        <Staged
          pending={rowsPending}
          skeleton={<BlockSkeleton height={320} label="Loading repeat analysis" />}
        >
          <RepeatTab />
        </Staged>
      </ReportSection>
      <ReportSection
        id={sectionDomId('latency')}
        title="Latency and traces"
        description="Response time, quality against latency, and where trace time goes."
        scopeNote={scopeNote}
        lazy
        minHeight={360}
      >
        <Staged pending={rowsPending} skeleton={<BlockSkeleton height={360} label="Loading latency" />}>
          <LatencyTab />
        </Staged>
      </ReportSection>
      <ReportSection
        id={sectionDomId('deep')}
        title="Deep analysis"
        description="How the metrics relate across items."
        scopeNote={scopeNote}
        lazy
        minHeight={280}
      >
        <Staged pending={rowsPending} skeleton={<BlockSkeleton height={280} label="Loading deep analysis" />}>
          <DeepTab />
        </Staged>
      </ReportSection>
      <ReportSection
        id={sectionDomId('categories')}
        title="Categories"
        description="Performance by item metadata. Click a value to filter the items."
        scopeNote={scopeNote}
      >
        <Staged pending={rowsPending} skeleton={<BlockSkeleton height={274} label="Loading categories" />}>
          <CategoriesTab />
        </Staged>
      </ReportSection>
      <ReportSection
        id={sectionDomId('errors')}
        title="Errors"
        description="Task, metric, trace and analysis errors grouped by message. Click a row to filter."
        scopeNote={scopeNote}
      >
        <Staged pending={rowsPending} skeleton={<ErrorsSkeleton />}>
          <ErrorsTab />
        </Staged>
      </ReportSection>
      <ReportSection
        id={sectionDomId('root-cause')}
        title="Root cause analysis"
        description="Why items failed. Click a category to filter the items."
        scopeNote={scopeNote}
        hidden={!hasRootCause}
        lazy
        minHeight={200}
      >
        <Staged pending={rowsPending} skeleton={<BlockSkeleton height={200} label="Loading root cause" />}>
          <RootCauseTab />
        </Staged>
      </ReportSection>
    </>
  );
}
