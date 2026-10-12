/**
 * Remote queue (brief 06 §2.7): what the Evaluation Service itself holds, with orphans
 * and stale jobs. Collapsed by default; the snapshot request only fires when open.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Key } from 'react-aria-components';
import { errorMessage } from '@/api/evalCommon';
import {
  useCancelRemoteJobs,
  useRemoteQueue,
  type RemoteEnvironment,
  type RemoteItem,
} from '@/api/evalQueue';
import { useProjectContext } from '@/features/shell';
import { Button, DataTable, ErrorState, Icon, Skeleton, Tag, Text, useToast, type Column } from '@/ui';
import { experimentPath } from '../paths';
import { relTime, absTime } from '../lib/format';
import { CancelSplitDialog } from './CancelSplitDialog';
import { plural, remoteSections, titleCase } from './lib';
import styles from './RemoteQueueSection.module.css';

export function RemoteQueueSection({
  projectId,
  environmentId,
  refetchInterval,
}: {
  projectId: string;
  environmentId: string | undefined;
  refetchInterval: number | false;
}) {
  const [open, setOpen] = useState(false);
  const query = useRemoteQueue(projectId, environmentId, open, open ? refetchInterval : false);
  const data = query.data;
  const orphans = data?.environments.reduce((n, e) => n + e.orphan_count, 0) ?? 0;
  const stale = data?.environments.reduce((n, e) => n + e.stale_count, 0) ?? 0;
  const panelId = 'remote-queue-panel';
  return (
    <section className={styles.card} aria-label="Remote queue">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className={styles.title}>Remote queue</span>
        <span className={styles.sub}>
          What the Evaluation Service holds, including jobs this project no longer tracks.
        </span>
        {open && data ? (
          <span className={styles.tags}>
            {orphans ? <Tag tone="warning">{plural(orphans, 'orphan')}</Tag> : null}
            {stale ? <Tag tone="warning">{stale} stale</Tag> : null}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} className={styles.body}>
          {query.isPending ? <Skeleton kind="table" count={3} label="Loading remote queue" /> : null}
          {query.isError ? (
            <ErrorState
              error={query.error}
              title="Couldn’t load the remote queue"
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {data?.environments.length === 0 ? <Text tone="secondary">No active environments.</Text> : null}
          {data?.environments.map((env) => (
            <RemoteEnv
              key={env.environment_id}
              projectId={projectId}
              env={env}
              canCancel={data.can_cancel_orphans}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RemoteEnv({
  projectId,
  env,
  canCancel,
}: {
  projectId: string;
  env: RemoteEnvironment;
  canCancel: boolean;
}) {
  const { slug } = useProjectContext();
  const toast = useToast();
  const cancel = useCancelRemoteJobs(projectId);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const ids = [...selected]
    .map(String)
    .filter((id) => env.items.some((i) => i.remote_job_id === id && (i.orphan || i.stale)));
  const columns: Column<RemoteItem>[] = [
    {
      id: 'job',
      label: 'Remote job',
      flex: true,
      minWidth: 220,
      mono: true,
      cell: (i) => (
        <div className={styles.cell}>
          <span>{i.remote_job_id}</span>
          {i.run_name ? (
            <Text variant="sm" tone="muted">
              {i.run_name}
            </Text>
          ) : null}
        </div>
      ),
    },
    { id: 'status', label: 'Status', width: 110, cell: (i) => titleCase(i.status) },
    { id: 'priority', label: 'Priority', width: 90, cell: (i) => (i.priority ? titleCase(i.priority) : '—') },
    {
      id: 'match',
      label: 'Matches',
      width: 260,
      cell: (i) =>
        i.match ? (
          <div className={styles.cell}>
            <Link to={experimentPath(slug, i.match.experiment_id)}>{i.match.experiment_name}</Link>
            <span className={styles.meta}>
              Local status {titleCase(i.match.status)}{' '}
              {i.stale ? (
                <Tag tone="warning" title="The local job already finished, but the service still runs it.">
                  Stale
                </Tag>
              ) : null}
            </span>
          </div>
        ) : (
          <Tag tone="warning">Orphan</Tag>
        ),
    },
    { id: 'user', label: 'Service user', width: 140, cell: (i) => i.user_id ?? '—' },
    {
      id: 'age',
      label: 'Age',
      width: 90,
      cell: (i) => <span title={absTime(i.created_at)}>{relTime(i.created_at)}</span>,
    },
  ];
  const stale = env.items.some((i) => i.stale);
  const cancellable = env.orphan_count + env.stale_count > 0 || env.items.some((i) => i.orphan || i.stale);
  // Orphans only: the wording is "orphan job"; once a stale job is selected it is "remote job".
  const staleSelected = ids.some((id) => env.items.find((i) => i.remote_job_id === id)?.stale);
  const noun = staleSelected ? 'remote job' : 'orphan job';
  return (
    <div className={styles.env}>
      <div className={styles.envHead}>
        <Text variant="lg" as="h3">
          {env.environment_name}
        </Text>
        <span className={styles.meta}>
          {env.fetched_at ? `fetched ${relTime(env.fetched_at)}` : 'never fetched'}
          {env.stale ? ' · refreshing' : ''} · {plural(env.orphan_count, 'orphan')} · {env.stale_count} stale
        </span>
        {env.fetch_error ? <span className={styles.err}>Last refresh failed: {env.fetch_error}</span> : null}
        {canCancel && cancellable ? (
          <Button size="sm" variant="danger" isDisabled={!ids.length} onPress={() => setConfirm(true)}>
            Cancel selected {stale ? 'remote jobs' : 'orphans'} ({ids.length})
          </Button>
        ) : null}
      </div>
      <DataTable
        storageKey="eval-queue.remote.v1"
        columns={columns}
        rows={env.items}
        rowKey={(i) => i.remote_job_id}
        minWidth={860}
        selection={
          canCancel && cancellable
            ? { selected, onChange: setSelected, isDisabled: (i) => !(i.orphan || i.stale) }
            : undefined
        }
        aria-label={`Remote jobs on ${env.environment_name}`}
        emptyState={<Text tone="secondary">The service holds no queued or running jobs.</Text>}
      />
      {!canCancel ? (
        <Text variant="sm" tone="muted">
          Only a project manager can cancel orphan and stale jobs.
        </Text>
      ) : null}
      {confirm ? (
        <CancelSplitDialog
          open
          onOpenChange={(o) => !o && setConfirm(false)}
          title={`Cancel ${plural(ids.length, noun)} on ${env.environment_name}?`}
          description={[
            'These jobs are cancelled directly on the Evaluation Service. The call is audit-logged.',
          ]}
          sections={remoteSections(env.items, ids)}
          actionable={ids.length}
          confirmLabel={`Cancel ${plural(ids.length, staleSelected ? 'remote job' : 'orphan')}`}
          onConfirm={async (reason) => {
            try {
              const res = await cancel.mutateAsync({
                environment_id: env.environment_id,
                remote_job_ids: ids,
                ...(reason ? { reason } : {}),
              });
              const summary = Object.entries(res.counts)
                .map(([k, v]) => `${v} ${titleCase(k).toLowerCase()}`)
                .join(', ');
              toast.show(summary || 'Nothing to cancel', {
                tone: Object.keys(res.errors).length ? 'error' : 'success',
              });
              setSelected(new Set());
            } catch (e) {
              toast.show(errorMessage(e), { tone: 'error' });
            }
          }}
        />
      ) : null}
    </div>
  );
}
