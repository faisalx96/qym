import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useLiveSources } from '@/api/live';
import {
  useCancelWorkerJob,
  useCreateWorkerJob,
  useLiveWorker,
  useLiveWorkerEvents,
  useRestoreWorkerSettings,
  useSaveWorkerSettings,
  useSetWorkerKey,
  useSetWorkerState,
  type LiveWorkerRead,
  type WorkerEventsFilters,
} from '@/api/liveWorker';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { actionErrorMessage } from '@/lib/http';
import { ErrorState, PageHeader, Skeleton, useToast } from '@/ui';
import { SourceControl } from './components/SourceControl';
import { StatusStrip } from './components/worker/StatusStrip';
import { SettingsForm } from './components/worker/SettingsForm';
import { HistoryBlock } from './components/worker/HistoryBlock';
import { JobsBlock } from './components/worker/JobsBlock';
import { PROBLEMS_PAGE_SIZE, ProblemsBlock, type ProblemsProps } from './components/worker/ProblemsBlock';
import { DateRangeDialog } from './components/worker/DateRangeDialog';
import type { WorkerBusy, WorkerCallbacks } from './components/worker/types';
import { zoneToday } from './lib/zone';
import liveStyles from './live.module.css';
import styles from './worker.module.css';

export interface WorkerPageViewProps extends ProblemsProps, WorkerCallbacks {
  busy: WorkerBusy;
  sourceControl?: ReactNode;
  jobsLimit?: number;
}
/** No data hooks: the same composed page is used by the app and the gallery. */
export function WorkerPageView({
  read,
  busy,
  sourceControl,
  onState,
  onKey,
  onSave,
  onRestore,
  onCreateJob,
  onCancelJob,
  jobsLimit = 20,
  onJobsLimit,
  ...problems
}: WorkerPageViewProps) {
  const [range, setRange] = useState(false);
  return (
    <div className={`${fullWidth} ${liveStyles.page}`}>
      <PageHeader title="Worker" meta={sourceControl ? [sourceControl] : undefined} />
      <div className={styles.grid}>
        <StatusStrip
          read={read}
          busy={busy}
          onState={onState}
          onKey={onKey}
          onBackfill={() => setRange(true)}
        />
        <ProblemsBlock {...problems} read={read} />
        <JobsBlock
          jobs={read.jobs}
          busy={busy}
          onBackfill={() => setRange(true)}
          onCancelJob={onCancelJob}
          jobsLimit={jobsLimit}
          onJobsLimit={onJobsLimit}
        />
        <div className={styles.settingsRow}>
          <SettingsForm read={read} busy={busy.save} onSave={onSave} />
          <HistoryBlock
            versions={read.versions}
            runningVersion={read.running?.settings_version_applied}
            busy={busy.restore}
            onRestore={onRestore}
          />
        </div>
      </div>
      <DateRangeDialog
        key={range ? 'open' : 'closed'}
        open={range}
        onOpenChange={setRange}
        jobs={read.jobs}
        today={zoneToday(read.status.day_key_timezone)}
        onCreateJob={onCreateJob}
        busy={busy.createJob}
      />
    </div>
  );
}

export function LiveWorkerPage({ slug, source }: { slug: string; source: string }) {
  // A source switch must discard drafts, dialogs and filters even at the same settings version.
  return <WorkerPage key={`${slug}:${source}`} slug={slug} source={source} />;
}
function WorkerPage({ slug, source }: { slug: string; source: string }) {
  useDocumentTitle('Worker · Live');
  const client = useQueryClient();
  const location = useLocation();
  const [filters, setFilters] = useState<WorkerEventsFilters>({ page: 1 });
  const [jobsLimit, setJobsLimit] = useState(20);
  const query = useLiveWorker(slug, source, jobsLimit);
  const [lastSuccess, setLastSuccess] = useState<{ read: LiveWorkerRead; jobsLimit: number } | null>(null);
  const [jobsError, setJobsError] = useState<Error | null>(null);
  const { show: showToast } = useToast();
  if (
    query.isSuccess &&
    !query.isPlaceholderData &&
    (query.data !== lastSuccess?.read || jobsLimit !== lastSuccess?.jobsLimit)
  ) {
    setLastSuccess({ read: query.data, jobsLimit });
  }
  if (query.isError && lastSuccess && jobsLimit > lastSuccess.jobsLimit) {
    setJobsError(query.error);
    setJobsLimit(lastSuccess.jobsLimit);
  }
  useEffect(() => {
    if (jobsError) showToast(actionErrorMessage('load older jobs', jobsError), { tone: 'error' });
  }, [jobsError, showToast]);
  const read = query.data ?? lastSuccess?.read;
  const events = useLiveWorkerEvents(slug, source, { ...filters, limit: PROBLEMS_PAGE_SIZE });
  const { data: eventsData, isSuccess, isPlaceholderData, isFetching, isFetchedAfterMount } = events;
  useEffect(() => {
    if (
      !isSuccess ||
      isPlaceholderData ||
      isFetching ||
      !isFetchedAfterMount ||
      eventsData.events.length ||
      !eventsData.total
    )
      return;
    const lastPage = Math.ceil(eventsData.total / PROBLEMS_PAGE_SIZE);
    if ((filters.page ?? 1) <= lastPage) return;
    // Discard the empty response so revisiting this page fetches it again, even with a fresh cache.
    client.removeQueries({
      queryKey: ['project', slug, 'live', 'worker-events', source, { ...filters, limit: PROBLEMS_PAGE_SIZE }],
      exact: true,
    });
    // The server correction and cache removal must happen together after the fetch completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters({ ...filters, page: lastPage });
  }, [
    client,
    slug,
    source,
    filters,
    eventsData,
    isSuccess,
    isPlaceholderData,
    isFetching,
    isFetchedAfterMount,
  ]);
  const sources = useLiveSources(slug);
  const state = useSetWorkerState(slug, source);
  const key = useSetWorkerKey(slug, source);
  const save = useSaveWorkerSettings(slug, source);
  const restore = useRestoreWorkerSettings(slug, source);
  const createJob = useCreateWorkerJob(slug, source);
  const cancelJob = useCancelWorkerJob(slug, source);
  useEffect(() => {
    if (location.hash === '#problems' && query.data)
      document.getElementById('problems')?.scrollIntoView?.({ block: 'start' });
  }, [location.hash, query.data]);
  const status = sources.data?.sources.find((item) => item.key === source || item.id === source);
  const sourceControl = <SourceControl key="source" slug={slug} source={source} status={status} />;
  if (!read)
    return (
      <div className={`${fullWidth} ${liveStyles.page}`}>
        <PageHeader title="Worker" meta={[sourceControl]} />
        {query.isError ? (
          <ErrorState
            error={query.error}
            title="Couldn’t load the worker"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className={styles.grid} data-live-loading="worker">
            {(
              [
                ['status', 180],
                ['problems', 360],
                ['jobs', 260],
                ['settings', 400],
              ] as const
            ).map(([name, height]) => (
              <div key={name} data-live-block={`worker-${name}`}>
                <Skeleton reserve kind="chart" height={height} label={`Loading worker ${name}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  return (
    <>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t refresh the worker"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      <WorkerPageView
        read={read}
        source={source}
        status={status}
        sourceControl={sourceControl}
        events={events.data?.events ?? []}
        eventsTotal={events.data?.total}
        eventsFilters={filters}
        onEventsFilters={setFilters}
        eventsPending={events.isPending}
        eventsError={events.error}
        onEventsRetry={() => void events.refetch()}
        busy={{
          state: state.isPending,
          key: key.isPending,
          save: save.isPending,
          restore: restore.isPending,
          createJob: createJob.isPending,
          cancelJob: cancelJob.isPending,
        }}
        onState={state.mutateAsync}
        onKey={key.mutateAsync}
        onSave={save.mutateAsync}
        onRestore={restore.mutateAsync}
        onCreateJob={createJob.mutateAsync}
        onCancelJob={cancelJob.mutateAsync}
        jobsLimit={jobsLimit}
        onJobsLimit={setJobsLimit}
      />
    </>
  );
}
