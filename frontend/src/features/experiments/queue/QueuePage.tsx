/**
 * /projects/:slug/experiments/queue (brief 06 §2.7-2.8). Winner of the UX pass: one table in
 * dispatch order with environment summary cards on top (`queue-table`), health/in-flight
 * chips borrowed from the grouped variant. Filters live in the URL (replaceState).
 * Polling: 5 s x1.5 backoff to 60 s, always on, paused while the tab is hidden.
 */
import { LATENCY_FILTER_LABEL, queueLatencyNote } from '../copy';
import { LatencyTag } from '../components/LatencyTag';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Key } from 'react-aria-components';
import { useExperiments } from '@/api/experiments';
import { useEvalEnvironments } from '@/api/evalCommon';
import {
  QUEUE_STATUSES,
  useCancelQueueJobs,
  useQueue,
  fetchQueue,
  QUEUED_HERE,
  type QueueEnvironment,
  type QueueFilters,
  type QueueJob,
} from '@/api/evalQueue';
import { announceRunStatus } from '@/lib/run-status';
import { useBackoffInterval } from '@/lib/backoff';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { errorMessage } from '@/api/evalCommon';
import { runPath } from '@/app/routes';
import { useDocumentTitle, useProjectContext, useTopbarStats } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  ProgressCell,
  RelativeTime,
  Select,
  Skeleton,
  Tag,
  Text,
  TwoLine,
  UserCell,
  useToast,
  type BadgeTone,
  type Column,
  Card,
} from '@/ui';
import { DataTable } from '@/ui';
import { ExperimentsTabs } from '../ExperimentsTabs';
import { experimentPath } from '../paths';
import { relTime } from '../lib/format';
import { CancelSplitDialog, type CancelSplitDialogProps } from './CancelSplitDialog';
import { RemoteQueueSection } from './RemoteQueueSection';
import {
  comboText,
  elapsedSeconds,
  formatElapsed,
  jobLabel,
  jobSections,
  outcomeSummary,
  paramsSummary,
  plural,
  splitJobs,
  CONTROL_HINT,
  titleCase,
} from './lib';
import styles from './QueuePage.module.css';

const STATUS_TONE: Record<string, BadgeTone> = {
  QUEUED: 'neutral',
  SUBMITTING: 'info',
  SUBMITTED: 'info',
  RUNNING: 'success',
  BLOCKED: 'warning',
  CANCELLING: 'warning',
};

type DialogState = Pick<
  CancelSplitDialogProps,
  'title' | 'description' | 'sections' | 'actionable' | 'confirmLabel'
> & {
  body: { job_ids: string[] } | { experiment_id: string; statuses: string[] };
};

export function QueuePage() {
  const { slug, project, readOnly } = useProjectContext();
  const pid = project.id;
  const toast = useToast();
  useDocumentTitle(`${project.name} · Queue`);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const filters: QueueFilters = useMemo(
    () => ({
      environment: params.get('environment') || undefined,
      statuses: params.getAll('status'),
      mine: params.get('mine') === '1' || params.get('mine') === 'true',
      experiment: params.get('experiment') || undefined,
      latency: params.get('latency') === '1',
    }),
    [params],
  );
  const [poll, setPoll] = useState<number | false>(5000);
  const query = useQueue(pid, filters, poll);
  const next = useBackoffInterval(true, {
    dataUpdatedAt: query.dataUpdatedAt,
    resetKey: (query.data?.jobs ?? [])
      .map((j) => `${j.id}:${j.status}:${j.queue_position}:${j.run?.items_done ?? ''}`)
      .join('|'),
  });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the interval derives from the query's own result
  useEffect(() => setPoll(next), [next]);
  const showSkeleton = useDelayedPending(query.isPending);
  const envs = useEvalEnvironments(pid);
  // Experiment filter source (decision Q6): the project's experiments, so one without a live job stays selectable.
  const experiments = useExperiments(pid, { limit: 200 });
  const cancel = useCancelQueueJobs(pid);
  const [selectedRaw, setSelected] = useState<Set<Key>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const jobs = useMemo(() => query.data?.jobs ?? [], [query.data]);
  // Selections of jobs that left the queue drop out here instead of in an effect.
  const selected = useMemo(
    () => new Set([...selectedRaw].filter((k) => jobs.some((j) => j.id === k))),
    [selectedRaw, jobs],
  );
  const stats = useMemo(
    () => (query.data ? [{ value: query.data.total, label: 'jobs' }] : null),
    [query.data],
  );
  useTopbarStats(stats);

  const experimentItems = useMemo(() => {
    const byId = new Map<string, string>();
    (experiments.data?.experiments ?? []).forEach((x) => byId.set(x.id, x.name));
    jobs.forEach((j) => byId.set(j.experiment_id, j.experiment_name));
    if (filters.experiment && !byId.has(filters.experiment))
      byId.set(filters.experiment, 'Selected experiment');
    return [{ key: '', label: 'All experiments' }, ...[...byId].map(([key, label]) => ({ key, label }))];
  }, [experiments.data, jobs, filters.experiment]);
  const envItems = [
    { key: '', label: 'All environments' },
    ...(envs.data ?? []).map((e) => ({ key: e.id, label: e.is_active ? e.name : `${e.name} (disabled)` })),
  ];
  const statusItems = [
    { key: '', label: 'All statuses' },
    ...QUEUE_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase() })),
  ];

  const selectedJobs = jobs.filter((j) => selected.has(j.id));
  const cancellableJobs = jobs.filter((j) => j.can_cancel && j.status !== 'CANCELLING');

  const openCancel = useCallback((list: QueueJob[], title?: string) => {
    const split = splitJobs(list);
    const actionable = split.here.length + split.remote.length;
    setDialog({
      title: title ?? `Cancel ${plural(actionable, 'job')}?`,
      description: ['Cancelled jobs can be retried later from the experiment.'],
      sections: jobSections(split),
      actionable,
      confirmLabel: `Cancel ${plural(actionable, 'job')}`,
      body: { job_ids: [...split.here, ...split.remote].map((j) => j.id) },
    });
  }, []);

  const openCancelQueuedInExperiment = async () => {
    const experimentId = filters.experiment;
    if (!experimentId) return;
    try {
      // The loaded page may be filtered or truncated: ask for the exact set.
      const exact = await fetchQueue(pid, { experiment: experimentId, statuses: [...QUEUED_HERE] }, 1000);
      const split = splitJobs(exact.jobs);
      const name = experimentItems.find((i) => i.key === experimentId)?.label ?? 'this experiment';
      setDialog({
        title: `Cancel all queued jobs in “${name}”?`,
        description: split.here.length ? [] : ['This experiment has no queued jobs you can cancel.'],
        sections: jobSections(split),
        actionable: split.here.length,
        confirmLabel: `Cancel ${plural(split.here.length, 'queued job')}`,
        body: { experiment_id: experimentId, statuses: [...QUEUED_HERE] },
      });
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'error' });
    }
  };

  const runCancel = async (reason: string) => {
    if (!dialog) return;
    try {
      const res = await cancel.mutateAsync(reason ? { ...dialog.body, reason } : dialog.body);
      toast.show(outcomeSummary(res.counts), { tone: 'success' });
      setSelected(new Set());
      announceRunStatus([], 'STOPPING');
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'error' });
    }
  };

  const columns: Column<QueueJob>[] = [
    {
      id: 'pos',
      header: 'Position',
      hint: 'Position in the queue (waiting jobs only)',
      type: 'number',
      width: 90,
      pin: 'start',
      hideable: false,
      priority: 2,
      cell: (j) => (j.queue_position ? String(j.queue_position) : '—'),
    },
    {
      id: 'job',
      header: 'Experiment',
      flex: true,
      minWidth: 200,
      priority: 1,
      cardTitle: true,
      cell: (j) => (
        <TwoLine
          primary={
            <span className={styles.jobTitle}>
              <Link to={experimentPath(slug, j.experiment_id)} className={styles.link}>
                {j.experiment_name || 'Experiment'} {comboText(j)}
              </Link>
              {j.priority === 'HIGH' ? <Tag tone="warning">HIGH</Tag> : null}
              {j.latency_sensitive ? <LatencyTag /> : null}
              {j.attempt > 0 ? <Tag kind="count">attempt {j.attempt + 1}</Tag> : null}
            </span>
          }
          secondary={
            paramsSummary(j.params) || j.wait_reason || j.error ? (
              <>
                {paramsSummary(j.params) ? (
                  <Text variant="sm" tone="muted" mono truncate>
                    {paramsSummary(j.params)}
                  </Text>
                ) : null}
                {paramsSummary(j.params) && (j.wait_reason || j.error) ? ' · ' : null}
                {j.wait_reason || j.error ? (
                  <Text variant="sm" tone="warning">
                    {j.wait_reason || j.error}
                  </Text>
                ) : null}
              </>
            ) : undefined
          }
        />
      ),
    },
    {
      id: 'env',
      header: 'Environment',
      width: 140,
      priority: 2,
      cell: (j) => {
        const env = query.data?.environments.find((e) => e.id === j.environment_id);
        return (
          <span className={styles.envCell}>
            {j.environment_name}
            {env && env.health_status && env.health_status !== 'ok' ? (
              <Badge tone="warning">{env.health_status}</Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'priority',
      header: 'Priority',
      width: 90,
      priority: 3,
      cell: (j) => (j.priority ? titleCase(j.priority) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 130,
      priority: 1,
      cell: (j) => (
        <Badge tone={STATUS_TONE[j.status] ?? 'neutral'} dot>
          {j.status}
        </Badge>
      ),
    },
    {
      id: 'creator',
      header: 'Created by',
      width: 140,
      priority: 3,
      defaultHidden: true,
      cell: (j) => <UserCell name={j.created_by_email} />,
    },
    {
      id: 'age',
      header: 'Age',
      type: 'date',
      width: 90,
      priority: 3,
      cell: (j) => <RelativeTime iso={j.created_at} now={new Date(now)} />,
    },
    {
      id: 'elapsed',
      header: 'Elapsed',
      type: 'duration',
      width: 90,
      priority: 2,
      cell: (j) => formatElapsed(elapsedSeconds(j, now)),
    },
    {
      id: 'progress',
      header: 'Run progress',
      width: 170,
      priority: 2,
      cell: (j) => {
        if (!j.run)
          return (
            <Text variant="sm" tone="muted">
              Not started
            </Text>
          );
        if (j.run.deleted)
          return (
            <Text variant="sm" tone="muted">
              Run deleted
            </Text>
          );
        const runId = j.run.id;
        return (
          <div className={styles.cell}>
            {j.run.items_total ? (
              <ProgressCell done={j.run.items_done ?? 0} total={j.run.items_total} />
            ) : (
              <span className={styles.progressText}>{j.run.items_done ?? 0} items</span>
            )}
            <span className={styles.progressText}>
              <Link to={runPath(slug, runId)} className={styles.link}>
                {jobLabel(j)} run
              </Link>
            </span>
          </div>
        );
      },
    },
  ];

  const filterControls = (
    <div className={styles.filters} role="group" aria-label="Queue filters">
      <Select
        label="Environment"
        items={envItems}
        value={filters.environment ?? ''}
        onChange={(k) => replaceUrlQuery({ environment: k ? String(k) : null })}
        searchable={false}
        width={190}
      />
      <Select
        label="Status"
        items={statusItems}
        value={filters.statuses?.[0] ?? ''}
        onChange={(k) => replaceUrlQuery({ status: k ? String(k) : null })}
        searchable={false}
        width={160}
      />
      <Select
        label="Experiment"
        items={experimentItems}
        value={filters.experiment ?? ''}
        onChange={(k) => replaceUrlQuery({ experiment: k ? String(k) : null })}
        width={240}
      />
      <Checkbox isSelected={filters.mine} onChange={(v) => replaceUrlQuery({ mine: v })}>
        Only my jobs
      </Checkbox>
      <Checkbox isSelected={filters.latency} onChange={(v) => replaceUrlQuery({ latency: v })}>
        {LATENCY_FILTER_LABEL}
      </Checkbox>
    </div>
  );

  const filtered = Boolean(
    filters.environment ||
      filters.statuses?.length ||
      filters.mine ||
      filters.latency ||
      filters.experiment,
  );
  const environments = query.data?.environments ?? [];

  return (
    <div className={fullWidth} data-queue-page>
      <PageHeader
        title="Queue"
        description="Jobs waiting for or running on this project’s Evaluation Service environments, in dispatch order."
        meta={[
          query.data ? `${plural(query.data.total, 'job')}` : '',
          query.dataUpdatedAt ? (
            <span key="r">refreshed {relTime(new Date(query.dataUpdatedAt).toISOString(), now)}</span>
          ) : (
            ''
          ),
        ].filter(Boolean)}
        tabs={<ExperimentsTabs current="queue" />}
      />
      {query.data ? null : filterControls}
      {showSkeleton ? (
        <Skeleton kind="table" count={6} label="Loading queue" />
      ) : query.isError && !query.data ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load the queue"
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <>
          <ul className={styles.envCards} aria-label="Environments">
            {environments.map((env) => (
              <li key={env.id}>
                <EnvCard env={env} />
              </li>
            ))}
          </ul>
          <section className={styles.jobs} aria-label="Our jobs">
            <DataTable<QueueJob>
              storageKey="eval-queue.jobs.v2"
              columns={columns}
              rows={jobs}
              rowKey={(j) => j.id}
              minWidth={1050}
              density="regular"
              selection={{ selected, onChange: setSelected }}
              bulkActions={
                <Button
                  size="sm"
                  variant="danger"
                  isDisabled={!selected.size || readOnly}
                  onPress={() => openCancel(selectedJobs)}
                >
                  Cancel selected ({selected.size})
                </Button>
              }
              rowActions={(j) => [
                {
                  id: 'cancel',
                  label: j.status === 'CANCELLING' ? 'Stopping…' : 'Cancel',
                  icon: 'close',
                  primary: true,
                  danger: true,
                  disabled: !j.can_cancel || readOnly || j.status === 'CANCELLING',
                  onPress: () => openCancel([j], `Cancel ${jobLabel(j)}?`),
                },
              ]}
              rowState={(j) =>
                j.error
                  ? 'error'
                  : j.status === 'BLOCKED'
                    ? 'warn'
                    : j.status === 'RUNNING'
                      ? 'live'
                      : undefined
              }
              aria-label="Queued jobs in dispatch order"
              refreshing={query.isFetching}
              isFiltered={filtered}
              empty={
                <EmptyState
                  compact
                  icon={<Icon name="clock" />}
                  title="The queue is empty"
                  body="Launched experiments appear here until they finish."
                />
              }
              filteredEmpty={
                <EmptyState
                  compact
                  icon={<Icon name="clock" />}
                  title="No jobs match these filters"
                  body="Clear a filter to see more jobs."
                  action={
                    <Button
                      variant="neutral"
                      onPress={() =>
                        replaceUrlQuery({
                          environment: null,
                          status: null,
                          mine: null,
                          latency: null,
                          experiment: null,
                        })
                      }
                    >
                      Clear filters
                    </Button>
                  }
                />
              }
            >
              <DataTable.Toolbar
                filters={filterControls}
                trailing={
                  <>
                    <Button
                      size="sm"
                      variant="neutral"
                      isDisabled={!cancellableJobs.length}
                      onPress={() => setSelected(new Set(cancellableJobs.map((j) => j.id)))}
                    >
                      Select all I can cancel ({cancellableJobs.length})
                    </Button>
                    {filters.experiment ? (
                      <Button
                        size="sm"
                        variant="neutral"
                        isDisabled={readOnly}
                        onPress={() => void openCancelQueuedInExperiment()}
                      >
                        Cancel all queued in experiment
                      </Button>
                    ) : null}
                  </>
                }
              />
              <DataTable.Footer
                summary={
                  query.data.total > jobs.length
                    ? `Showing the first ${jobs.length} of ${query.data.total} jobs`
                    : plural(query.data.total, 'job')
                }
                trailing="Refreshes automatically; paused while this tab is hidden"
              />
            </DataTable>
            {!jobs.every((j) => j.can_cancel) && jobs.length ? (
              <Text variant="sm" tone="muted">
                {CONTROL_HINT}.
              </Text>
            ) : null}
          </section>
          <RemoteQueueSection projectId={pid} environmentId={filters.environment} refetchInterval={poll} />
        </>
      ) : null}
      {dialog ? (
        <CancelSplitDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog.title}
          description={dialog.description}
          sections={dialog.sections}
          actionable={dialog.actionable}
          confirmLabel={dialog.confirmLabel}
          onConfirm={runCancel}
        />
      ) : null}
    </div>
  );
}

function EnvCard({ env }: { env: QueueEnvironment }) {
  const healthy = env.health_status === 'ok';
  return (
    <Card
      as="section"
      compact
      tone={healthy ? 'success' : env.health_status === 'unknown' ? 'neutral' : 'warning'}
      className={styles.envCard}
      aria-label={env.name}
    >
      <div className={styles.envBody}>
        <div className={styles.envHead}>
          <Text variant="lg" as="span">
            {env.name}
          </Text>
          {!env.is_active ? <Tag>Disabled</Tag> : null}
          <Badge tone={healthy ? 'success' : env.health_status === 'unknown' ? 'neutral' : 'warning'} dot>
            {healthy ? 'Healthy' : (env.health_status ?? 'Unknown')}
          </Badge>
        </div>
        <div className={styles.counts}>
          <Stat label="In flight" value={env.inflight} />
          <Stat label="Queued" value={env.queued} />
          <Stat label="Blocked" value={env.blocked} warn />
        </div>
        {!healthy && env.health_error ? (
          <p className={styles.note2}>Dispatch is paused until the health check passes: {env.health_error}</p>
        ) : null}
        {env.stale_remote ? (
          <p className={styles.note2}>{env.stale_remote} stale jobs still running on the service.</p>
        ) : null}
        {env.high_active ? (
          <p className={styles.high}>
            A HIGH-priority job is active on {env.name}. Other jobs wait until it finishes.
          </p>
        ) : null}
        {env.latency_active ? (
          <p className={styles.latencyNote} role="note" data-testid="queue-latency-note">
            {queueLatencyNote(env.name)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={styles.stat}>
      <Text variant="stat" tone={warn && value ? 'warning' : 'primary'}>
        {value}
      </Text>
      <Text variant="sm" tone="secondary">
        {label}
      </Text>
    </div>
  );
}
