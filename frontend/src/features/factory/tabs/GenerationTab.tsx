/**
 * Factory → Generation: the analysis and generation jobs, newest first, with their state, progress, the dataset a
 * generation wrote to (a link to its items, where the review and the edits happen), and the Cancel and Log actions.
 * The table refetches every 3 s while a job is queued or running ("Updates automatically").
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
  type FactoryJobStatus,
} from '@/api/factory';
import { APP_LOCALE, formatAgo } from '@/lib/dates';
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
  StatusMark,
  Text,
  TextLink,
  UserName,
  useToast,
  type Column,
  type StatusShape,
  type StatusTone,
} from '@/ui';
import { jobTitle } from '../FactoryDetailPage';
import styles from '../FactoryDetailPage.module.css';

const MARK: Record<FactoryJobStatus, { tone: StatusTone; shape: StatusShape }> = {
  queued: { tone: 'neutral', shape: 'ring' },
  running: { tone: 'info', shape: 'orbit' },
  cancel_requested: { tone: 'warning', shape: 'pause' },
  succeeded: { tone: 'success', shape: 'full' },
  failed: { tone: 'danger', shape: 'cross' },
  cancelled: { tone: 'neutral', shape: 'pause' },
};
const LABEL: Record<FactoryJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  cancel_requested: 'Stopping',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function progressText(job: FactoryJob): string {
  const p = job.progress;
  if (job.kind === 'generation' && typeof p.generated === 'number') {
    const cap =
      typeof p.max_items === 'number' ? ` of at most ${p.max_items.toLocaleString(APP_LOCALE)}` : '';
    const layer =
      typeof p.layer === 'number' && typeof p.layers === 'number' && p.layer > 0
        ? ` · layer ${p.layer} of ${p.layers}`
        : '';
    return `${p.generated.toLocaleString(APP_LOCALE)} item${p.generated === 1 ? '' : 's'}${cap}${layer}`;
  }
  if (job.kind === 'analysis' && typeof p.rules_added === 'number') {
    const done =
      typeof p.done === 'number' && typeof p.total === 'number' ? ` · ${p.done} of ${p.total} calls` : '';
    return `${p.rules_added} rule${p.rules_added === 1 ? '' : 's'} added${done}`;
  }
  return String(p.message ?? '');
}

function paramsText(job: FactoryJob): string {
  const p = job.params;
  if (job.kind !== 'generation') return 'Rule analysis';
  const parts = [
    `${p.max_layers ?? 1} layer${p.max_layers === 1 ? '' : 's'}`,
    `${p.branching ?? 1} per item`,
  ];
  if (p.official_only === false) parts.push('proposed rules too');
  return parts.join(' · ');
}

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
  onGenerate,
  busyReason,
}: {
  factory: FactoryDetail;
  slug: string;
  canModify: boolean;
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

  const columns: Column<FactoryJob>[] = [
    {
      id: 'kind',
      header: 'Job',
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
      cell: (j) => (
        <StatusMark
          tone={MARK[j.status].tone}
          shape={MARK[j.status].shape}
          label={LABEL[j.status]}
          data-status={j.status}
        />
      ),
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
      width: 80,
      priority: 1,
      cell: (j) => (
        <span className={styles.rowActions}>
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
          A generation writes its items to a new draft dataset; open it to review, edit and publish them.
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
        aria-label="Factory jobs"
        rows={jobs}
        rowKey={(j) => j.id}
        columns={columns}
        loading={tableLoading(list.isPending, showSkeleton)}
        refreshing={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        errorTitle="Couldn’t load the jobs"
        empty={
          <EmptyState
            compact
            title="No job yet"
            body={
              canModify
                ? 'Analyze the rules first, approve the ones you keep, then generate data.'
                : undefined
            }
          />
        }
        rowProps={(j) => ({ 'data-status': j.status })}
      />
      <LogDialog factoryId={factory.id} job={log} onClose={() => setLog(null)} />
    </div>
  );
}
