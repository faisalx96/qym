/** The analysis sections of the run report, stacked at full width (legacy order), plus the nav entries that point at them. */
import { useMemo } from 'react';
import { useReviewHistoryQuery } from '@/api/runs';
import { ReportSection, StatStrip } from '@/ui';
import { runCounts } from '../lib/overviewModel';
import { errorBucketCount } from '../lib/panelCounts';
import { getRowRootCauseAnalyses } from '../lib/rowMeta';
import { useRunPage } from '../RunContext';
import { CategoriesTab } from './panels/CategoriesTab';
import { DeepTab } from './panels/DeepTab';
import { ErrorsTab } from './panels/ErrorsTab';
import { LatencyTab } from './panels/LatencyTab';
import { OverviewTab } from './panels/OverviewTab';
import { RepeatTab } from './panels/RepeatTab';
import { RootCauseTab } from './panels/RootCauseTab';

export type SectionKey =
  'reviews' | 'overview' | 'repeat' | 'latency' | 'deep' | 'categories' | 'errors' | 'root-cause' | 'items';

/** Every section a link (`#overview`, `?panel=`, nav) can name, in page order. */
export const SECTION_KEYS: SectionKey[] = [
  'reviews',
  'overview',
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
  const { runId, model, items, payload } = useRunPage();
  const reviews = useReviewHistoryQuery(runId, true);
  const reviewCount = reviews.data?.events.length ?? 0;
  const errorCount = errorBucketCount(model.rows, model.isRepeat && !model.viewPass);
  const hasRootCause = useHasRootCause();
  return [
    ...(reviewCount ? [{ id: 'reviews' as const, label: 'Reviews', count: reviewCount }] : []),
    { id: 'overview', label: 'Overview' },
    ...(model.isRepeat && !model.viewPass ? [{ id: 'repeat' as const, label: 'Repeat' }] : []),
    { id: 'latency', label: 'Latency' },
    { id: 'deep', label: 'Deep' },
    { id: 'categories', label: 'Categories' },
    { id: 'errors', label: 'Errors', count: errorCount, danger: errorCount > 0 },
    ...(hasRootCause ? [{ id: 'root-cause' as const, label: 'Root cause' }] : []),
    {
      id: 'items',
      label: 'Items',
      count: items.length === payload.snapshot.rows.length ? payload.snapshot.rows.length : items.length,
    },
  ];
}

export function ReportSections({ scopeNote }: { scopeNote?: string }) {
  const { model, items } = useRunPage();
  const hasRootCause = useHasRootCause();
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
              { key: 'items', label: 'Items', value: counts.total },
              { key: 'completed', label: 'Completed', value: counts.completed },
              {
                key: 'errors',
                label: 'Errors',
                value: counts.errors,
                tone: counts.errors ? 'danger' : undefined,
              },
              ...(counts.notReceived
                ? [{ key: 'nr', label: 'Not received', value: counts.notReceived, tone: 'warning' as const }]
                : []),
            ]}
          />
        }
      >
        <OverviewTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('repeat')}
        title="Repeat run analysis"
        description="Pass@k, per-pass results and how many passes passed."
        hidden={!(model.isRepeat && !model.viewPass)}
        lazy
        minHeight={320}
      >
        <RepeatTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('latency')}
        title="Latency and traces"
        description="Response time, quality against latency, and where trace time goes."
        scopeNote={scopeNote}
        lazy
        minHeight={360}
      >
        <LatencyTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('deep')}
        title="Deep analysis"
        description="How the metrics relate across items."
        scopeNote={scopeNote}
        lazy
        minHeight={280}
      >
        <DeepTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('categories')}
        title="Categories"
        description="Performance by item metadata. Click a value to filter the items."
        scopeNote={scopeNote}
      >
        <CategoriesTab />
      </ReportSection>
      <ReportSection
        id={sectionDomId('errors')}
        title="Errors"
        description="Task, metric, trace and analysis errors grouped by message. Click a row to filter."
        scopeNote={scopeNote}
      >
        <ErrorsTab />
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
        <RootCauseTab />
      </ReportSection>
    </>
  );
}
