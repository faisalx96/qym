/**
 * /projects/:slug/experiments/:id (brief 06 §2.2-2.3): header + controls, stat strip, queue
 * strip, matrix with compare selection, setting-vs-metric chart, job history.
 * The header follows the run header (E1, owner answer Nov 1): one accent "Run again" and one "Actions" menu with
 * Retry failed and Cancel experiment, each with its action tile. Normal states stay out of the header (C137).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '@/api/me';
import { hasLiveJobs, useExperiment, type ExperimentDetail, type ExperimentJob } from '@/api/experiments';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { useCrumbLabel } from '@/lib/crumb-label';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import {
  ActionTile,
  Button,
  CountTile,
  DropdownMenu,
  ErrorState,
  Icon,
  LinkButton,
  PageHeader,
  Skeleton,
  StatStrip,
  Text,
  UserName,
  type MenuItemSpec,
} from '@/ui';
import { LatencyTag } from '../components/LatencyTag';
import { ExperimentStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { absTime, baseSourceLabel, relTime, titleCase } from '../lib/format';
import { buildMatrix, compareHref, currentJobs, jobStats, pruneSelection } from '../lib/matrix';
import { defaultPresetEditPath, experimentsPath, launchPath } from '../paths';
import { ChartCard } from './ChartCard';
import { Credentials } from './Credentials';
import { JobHistoryCard } from './JobHistoryCard';
import { MatrixCard } from './MatrixCard';
import { SelectionCard } from './SelectionCard';
import { QueueStrip } from './QueueStrip';
import { useExperimentFlows } from './useExperimentFlows';
import styles from './detail.module.css';

export function ExperimentDetailPage({ experimentId }: { experimentId: string }) {
  const { project, slug } = useProjectContext();
  const query = useExperiment(project.id, experimentId);
  const showSkeleton = useDelayedPending(query.isPending);
  useDocumentTitle(`${query.data?.name ?? 'Experiment'} · ${project.name}`);
  useCrumbLabel(query.data?.name);
  if (query.data) return <Loaded detail={query.data} />;
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load this experiment"
          notFoundTitle="Experiment not found"
          notFoundMessage="This experiment doesn’t exist in this project, or it was deleted."
          parent={{ to: experimentsPath(slug), label: 'Experiments' }}
          onRetry={() => void query.refetch()}
        />
      ) : showSkeleton ? (
        <Skeleton kind="lines" rows={6} label="Loading experiment" />
      ) : null}
    </div>
  );
}

function Loaded({ detail: x }: { detail: ExperimentDetail }) {
  const { project, slug, readOnly, canManage, isAdmin } = useProjectContext();
  const me = useMe();
  const navigate = useNavigate();
  const flows = useExperimentFlows(project.id, slug, x);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showEarlier, setShowEarlier] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const matrix = useMemo(() => buildMatrix(x), [x]);
  const selectedRuns = useMemo(
    () => pruneSelection(selected, matrix.liveRunIds),
    [selected, matrix.liveRunIds],
  );
  const stats = useMemo(() => jobStats(x), [x]);
  const live = hasLiveJobs(x);
  const current = useMemo(() => currentJobs(x), [x]);
  const retryable = current.filter(isRetryable);
  const cancellable = current.filter(isCancellable);

  const creator = Boolean(me.data?.id && x.created_by_user_id === me.data.id);
  const canControl = !flows.denied && !readOnly && (isAdmin || canManage || creator);
  const canSavePreset = !flows.denied && !readOnly;
  const canPromote = !flows.denied && !readOnly && (isAdmin || canManage);

  const toggle = useCallback((runId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  }, []);

  function compare() {
    if (selectedRuns.length < 2) return;
    try {
      sessionStorage.removeItem('compareCohorts');
      sessionStorage.setItem('compareRuns', JSON.stringify(selectedRuns));
    } catch {
      /* the URL carries the runs */
    }
    navigate(compareHref(slug, selectedRuns));
  }

  function showAttempts(job: ExperimentJob) {
    setHistoryOpen(true);
    setShowEarlier(true);
    setScrollTo(job.id);
  }
  useEffect(() => {
    if (!scrollTo) return;
    let tries = 0;
    let frame = 0;
    const find = () => {
      const row = document
        .querySelector(`[data-exp-jobs] [data-job-id="${CSS.escape(scrollTo)}"]`)
        ?.closest('tr');
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setScrollTo(null);
      } else if (tries++ < 20) frame = requestAnimationFrame(find);
      else setScrollTo(null);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [scrollTo, showEarlier]);

  // Retry and Cancel show only while they apply (C137): no cancel button that cannot be used on a finished experiment.
  const actions: MenuItemSpec[] = [];
  if (retryable.length)
    actions.push({
      id: 'retry',
      label: (
        <>
          Retry failed<CountTile>{retryable.length}</CountTile>
        </>
      ),
      icon: <ActionTile icon="retry" />,
      disabled: !canControl || flows.busy.size > 0,
    });
  if (cancellable.length)
    actions.push({
      id: 'cancel',
      label: 'Cancel experiment',
      tone: 'danger',
      separatorBefore: actions.length > 0,
      icon: <ActionTile icon="ban" tone="danger" />,
      disabled: !canControl || flows.busy.has('all'),
    });

  const envNames = (x.environments ?? []).map((e) => `${e.name}${e.is_active ? '' : ' (disabled)'}`);
  const meta = [
    x.created_by_user_id || x.created_by_email ? (
      <UserName
        key="by"
        id={x.created_by_user_id}
        name={x.created_by_name}
        email={x.created_by_email}
      />
    ) : (
      'unknown creator'
    ),
    <span key="age" title={absTime(x.created_at)}>
      {relTime(x.created_at)}
    </span>,
    `Priority ${titleCase(x.priority)}`,
    `Base: ${baseSourceLabel(x.base_source)}`,
    envNames.length ? envNames.join(', ') : null,
  ].filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <div className={`${fullWidth} ${styles.page}`} data-exp-detail={x.id}>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            {x.name || x.id}
            <ExperimentStatusBadge status={x.status} />
            {x.latency_sensitive ? <LatencyTag /> : null}
          </span>
        }
        description={
          x.description || 'Jobs launched by this experiment, one per combination and environment.'
        }
        meta={meta}
        actions={
          <>
            {readOnly ? null : (
              <LinkButton
                to={launchPath(slug, { clone: x.id })}
                variant="accent"
                icon={<Icon name="retry" size={12} />}
                title="Open the launch form as a copy of this experiment"
                data-testid="exp-run-again"
              >
                Run again
              </LinkButton>
            )}
            {actions.length ? (
              <DropdownMenu
                label="Experiment actions"
                trigger={
                  <Button variant="neutral" icon={<Icon name="more" size={14} />} data-testid="exp-actions">
                    Actions
                  </Button>
                }
                items={actions}
                onAction={(id) => (id === 'retry' ? flows.retryFailed() : flows.cancelExperiment())}
              />
            ) : null}
          </>
        }
      />
      <Credentials detail={x} />
      {!canControl && !readOnly && actions.length ? (
        <Text variant="base" tone="muted" className={styles.note}>
          {flows.denied
            ? 'You are not allowed to change this experiment.'
            : 'Only the experiment’s creator or a project manager can cancel or retry jobs.'}
        </Text>
      ) : null}
      <SelectionCard detail={x} />
      <StatStrip
        aria-label="Job totals"
        items={[
          { key: 'jobs', label: 'Jobs', value: stats.jobs, icon: <Icon name="flask" /> },
          {
            key: 'ok',
            label: 'Succeeded',
            value: stats.succeeded,
            icon: <Icon name="check" />,
            tone: 'success',
          },
          {
            key: 'failed',
            label: 'Failed',
            value: stats.failed,
            icon: <Icon name="close" />,
            tone: stats.failed ? 'danger' : undefined,
          },
          // In progress and Cancelled are normal at 0: they show only when they hold a job (C137)
          ...(stats.inProgress
            ? [
                {
                  key: 'live',
                  label: 'In progress',
                  value: stats.inProgress,
                  icon: <Icon name="clock" />,
                  tone: 'info' as const,
                },
              ]
            : []),
          ...(stats.cancelled
            ? [
                {
                  key: 'cancelled',
                  label: 'Cancelled',
                  value: stats.cancelled,
                  icon: <Icon name="stop" />,
                  tone: 'warning' as const,
                },
              ]
            : []),
        ]}
      />
      <QueueStrip projectId={project.id} slug={slug} experimentId={x.id} live={live} />
      {x.jobs.length ? (
        <MatrixCard
          slug={slug}
          matrix={matrix}
          selected={selectedRuns}
          onToggle={toggle}
          onSelectAll={() => setSelected(new Set(matrix.liveRunIds))}
          onClear={() => setSelected(new Set())}
          onCompare={compare}
          onShowAttempts={showAttempts}
          flows={flows}
          canControl={canControl}
          canSavePreset={canSavePreset}
          canPromote={canPromote}
          onPromote={(job) =>
            navigate(defaultPresetEditPath(slug, job.environment_id, { promote: 'job', id: job.id }))
          }
        />
      ) : null}
      {Object.keys(x.sweep_keys ?? {}).length ? <ChartCard detail={x} envs={matrix.envs} /> : null}
      <JobHistoryCard
        slug={slug}
        detail={x}
        showEarlier={showEarlier}
        onShowEarlier={setShowEarlier}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        flows={flows}
        canControl={canControl}
        live={live}
      />
      {flows.dialogs}
    </div>
  );
}
