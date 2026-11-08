import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useModelIndex } from '@/api/dashboard';
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
  type WorkerEventsFilters,
} from '@/api/liveWorker';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { ErrorState, PageHeader, Skeleton } from '@/ui';
import { SourceControl } from './components/SourceControl';
import { StatusStrip } from './components/worker/StatusStrip';
import { SettingsForm } from './components/worker/SettingsForm';
import { WorkerActions } from './components/worker/WorkerActions';
import { HistoryBlock } from './components/worker/HistoryBlock';
import { JobsBlock } from './components/worker/JobsBlock';
import { ProblemsBlock, type ProblemsProps } from './components/worker/ProblemsBlock';
import { DateRangeDialog } from './components/worker/DateRangeDialog';
import type { WorkerBusy, WorkerCallbacks } from './components/worker/types';
import liveStyles from './live.module.css';
import styles from './worker.module.css';

export interface WorkerPageViewProps extends ProblemsProps, WorkerCallbacks {
  busy: WorkerBusy;
  modelIndex?: Record<string, number> | null;
  sourceControl?: ReactNode;
}
/** No data hooks: the same composed page is used by the app and the gallery. */
export function WorkerPageView({
  read,
  busy,
  modelIndex,
  sourceControl,
  onState,
  onKey,
  onSave,
  onRestore,
  onCreateJob,
  onCancelJob,
  ...problems
}: WorkerPageViewProps) {
  const [range, setRange] = useState(false);
  return (
    <div className={`${fullWidth} ${liveStyles.page}`}>
      <PageHeader
        title="Worker"
        meta={sourceControl ? [sourceControl] : undefined}
        actions={<WorkerActions read={read} busy={busy} onState={onState} onBackfill={() => setRange(true)} />}
      />
      <div className={styles.grid}>
        <StatusStrip read={read} />
        <ProblemsBlock {...problems} read={read} />
        <JobsBlock jobs={read.jobs} busy={busy} onCancelJob={onCancelJob} />
        <div className={styles.settingsRow}>
          <SettingsForm
            read={read}
            busy={busy.save}
            busyKey={busy.key}
            onSave={onSave}
            onKey={onKey}
            modelIndex={modelIndex}
          />
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
        onCreateJob={onCreateJob}
        today={read.today.day}
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
  const location = useLocation();
  const [filters, setFilters] = useState<WorkerEventsFilters>({});
  const query = useLiveWorker(slug, source);
  const events = useLiveWorkerEvents(slug, source, filters);
  const sources = useLiveSources(slug);
  const state = useSetWorkerState(slug, source);
  const key = useSetWorkerKey(slug, source);
  const save = useSaveWorkerSettings(slug, source);
  const restore = useRestoreWorkerSettings(slug, source);
  const createJob = useCreateWorkerJob(slug, source);
  const cancelJob = useCancelWorkerJob(slug, source);
  const modelIndex = useModelIndex(slug);
  useEffect(() => {
    if (location.hash === '#problems' && query.data)
      document.getElementById('problems')?.scrollIntoView?.({ block: 'start' });
  }, [location.hash, query.data]);
  const status = sources.data?.sources.find((item) => item.key === source || item.id === source);
  const sourceControl = <SourceControl key="source" slug={slug} source={source} status={status} />;
  if (!query.data)
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
        read={query.data}
        source={source}
        status={status}
        sourceControl={sourceControl}
        modelIndex={modelIndex}
        events={events.data?.events ?? []}
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
      />
    </>
  );
}
