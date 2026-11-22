/**
 * Factory → Generation: the attempts (analysis and generation jobs, newest first) with their state, progress, the
 * dataset a generation wrote to and the review of its items; a generation row opens the attempt (the layer chart
 * and the items to review, `?job=`), the Log action opens the job's log. The table refetches every 3 s while a
 * job is queued or running ("Updates automatically").
 */
import { useState } from 'react';
import { datasetPath } from '@/features/datasets/lib/route';
import {
  ACTIVE_JOB_STATUSES,
  JOB_REFRESH_MS,
  useCancelJob,
  useFactoryJob,
  useFactoryJobs,
  type FactoryDetail,
  type FactoryJob,
} from '@/api/factory';
import { formatAgo } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { tableLoading, useDelayedPending } from '@/lib/pending';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  Text,
  TextLink,
  UserName,
  useToast,
  type Column,
} from '@/ui';
import { jobTitle } from '../FactoryDetailPage';
import styles from '../FactoryDetailPage.module.css';
import { AttemptView } from './AttemptView';
import { JobStatusMark, paramsText, progressText, reviewText } from './jobText';

function LogDialog({
  factoryId,
  job,
  onClose,
}: {
  factoryId: string;
  job: FactoryJob | null;
  onClose: () => void;
}) {
  const detail = useFactoryJob(factoryId, job?.id ?? null, {
    refetchInterval: job && ACTIVE_JOB_STATUSES.includes(job.status) ? JOB_REFRESH_MS : false,
  });
  const log = detail.data?.log ?? '';
  return (
    <Dialog
      open={Boolean(job)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={job ? `${jobTitle(job.kind)} log` : 'Log'}
      description={job?.error ? `Failed: ${job.error}` : undefined}
      size="lg"
    >
      {detail.isPending ? (
        <Skeleton kind="lines" rows={4} label="Loading the log" />
      ) : log ? (
        <Text as="pre" mono variant="sm" className={styles.log} data-testid="job-log">
          {log}
        </Text>
      ) : (
        <EmptyState compact title="Nothing logged yet" />
      )}
    </Dialog>
  );
}

export function GenerationTab({
  factory,
  slug,
  canModify,
  canApprove,
  jobId,
  onOpenJob,
  onGenerate,
  busyReason,
}: {
  factory: FactoryDetail;
  slug: string;
  canModify: boolean;
  canApprove: boolean;
  /** The attempt open in the tab (`?job=`), else null: the attempts table. */
  jobId: string | null;
  onOpenJob: (jobId: string | null) => void;
  onGenerate: () => void;
  busyReason?: string;
}) {
  const toast = useToast();
  const anyActive = factory.active_job !== null;
  const list = useFactoryJobs(factory.id, { refetchInterval: anyActive ? JOB_REFRESH_MS : false });
  const showSkeleton = useDelayedPending(list.isPending);
  const cancel = useCancelJob(factory.id);
  const [log, setLog] = useState<FactoryJob | null>(null);
  const jobs = list.data?.jobs ?? [];

  if (jobId)
    return (
      <div className={styles.tab} data-testid="generation-tab">
        <AttemptView
          factory={factory}
          slug={slug}
          jobId={jobId}
          canModify={canModify}
          canApprove={canApprove}
          onBack={() => onOpenJob(null)}
        />
      </div>
    );

  const columns: Column<FactoryJob>[] = [
    {
      id: 'kind',
      header: 'Attempt',
      width: 180,
      priority: 1,
      cardTitle: true,
      cell: (j) => jobTitle(j.kind),
      secondary: (j) => paramsText(j),
    },
    {
      id: 'status',
      header: 'Status',
      width: 120,
      priority: 1,
      cell: (j) => <JobStatusMark job={j} />,
    },
    {
      id: 'progress',
      header: 'Progress',
      flex: true,
      minWidth: 220,
      priority: 2,
      wrap: true,
      cell: (j) =>
        j.status === 'failed' && j.error ? <span className={styles.muted}>{j.error}</span> : progressText(j),
      secondary: (j) => reviewText(j),
    },
    {
      id: 'output',
      header: 'Dataset',
      width: 220,
      priority: 1,
      cell: (j) =>
        j.output_dataset ? (
          j.output_dataset.deleted ? (
            <span className={styles.muted}>{j.output_dataset.name} (deleted)</span>
          ) : (
            <TextLink
              to={datasetPath(slug, j.output_dataset.slug, { tab: 'items' })}
              data-testid="job-dataset"
            >
              {j.output_dataset.name}
            </TextLink>
          )
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      id: 'who',
      header: 'Started by',
      width: 170,
      priority: 3,
      cell: (j) =>
        j.requested_by ? (
          <UserName id={j.requested_by.id} name={j.requested_by.display_name} email={j.requested_by.email} />
        ) : (
          '—'
        ),
    },
    {
      id: 'when',
      header: 'Started',
      width: 130,
      priority: 3,
      cell: (j) =>
        j.started_at ? formatAgo(j.started_at) : j.created_at ? `Queued ${formatAgo(j.created_at)}` : '—',
    },
    {
      id: 'actions',
      header: 'Actions',
      hideLabel: true,
      width: 110,
      priority: 1,
      cell: (j) => (
        <span className={styles.rowActions}>
          {j.kind === 'generation' ? (
            <IconButton
              tile
              icon="review"
              label="Open the attempt: its layers and the items to review"
              onPress={() => onOpenJob(j.id)}
              data-testid="job-open"
            />
          ) : null}
          <IconButton
            tile
            icon="file"
            label={`Log of the ${jobTitle(j.kind).toLowerCase()}`}
            onPress={() => setLog(j)}
            data-testid="job-log-button"
          />
          {canModify && ACTIVE_JOB_STATUSES.includes(j.status) && j.status !== 'cancel_requested' ? (
            <IconButton
              tile
              tone="danger"
              icon="stop"
              label="Cancel the job"
              onPress={() =>
                cancel.mutate(j.id, {
                  onError: (e) => toast.show(actionErrorMessage('cancel the job', e), { tone: 'error' }),
                })
              }
              data-testid="job-cancel"
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className={styles.tab} data-testid="generation-tab">
      <div className={styles.toolbar}>
        <Text as="p" variant="base" tone="muted">
          A generation writes its items to a new draft dataset. Open an attempt to see the layers it grew and to
          review its items; a rejected item is disabled in the dataset.
        </Text>
        <span className={styles.toolbarEnd}>
          {anyActive ? <span className={styles.toolbarNote}>Updates automatically</span> : null}
          {canModify ? (
            <Button
              variant="primary"
              icon={<Icon name="factory" size={12} />}
              onPress={onGenerate}
              isDisabled={Boolean(busyReason)}
              disabledReason={busyReason}
              data-testid="generate-tab-button"
            >
              Generate data
            </Button>
          ) : null}
        </span>
      </div>
      <DataTable<FactoryJob>
        aria-label="Factory attempts"
        rows={jobs}
        rowKey={(j) => j.id}
        columns={columns}
        loading={tableLoading(list.isPending, showSkeleton)}
        refreshing={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        errorTitle="Couldn’t load the attempts"
        onRowOpen={(j) => (j.kind === 'generation' ? onOpenJob(j.id) : setLog(j))}
        rowOpenNow
        empty={
          <EmptyState
            compact
            title="No attempt yet"
            body={
              canModify
                ? 'Analyze the rules first, approve the ones you keep, then generate data.'
                : undefined
            }
          />
        }
        rowProps={(j) => ({ 'data-status': j.status, 'data-kind': j.kind })}
      />
      <LogDialog factoryId={factory.id} job={log} onClose={() => setLog(null)} />
    </div>
  );
}
