/**
 * /projects/:slug/experiments/:id (brief 06 §2.2-2.3): header + controls, stat strip, queue
 * strip, matrix with compare selection, setting-vs-metric chart, job history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMe } from '@/api/me';
import { hasLiveJobs, useExperiment, type ExperimentDetail, type ExperimentJob } from '@/api/experiments';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { Button, ErrorState, PageHeader, Skeleton, StatStrip, Text } from '@/ui';
import { ExperimentStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { absTime, baseSourceLabel, relTime, titleCase } from '../lib/format';
import { buildMatrix, compareHref, currentJobs, jobStats, pruneSelection } from '../lib/matrix';
import { defaultPresetEditPath, experimentsPath } from '../paths';
import { ChartCard } from './ChartCard';
import { JobHistoryCard } from './JobHistoryCard';
import { MatrixCard } from './MatrixCard';
import { QueueStrip } from './QueueStrip';
import { useExperimentFlows } from './useExperimentFlows';
import styles from './detail.module.css';

export function ExperimentDetailPage({ experimentId }: { experimentId: string }) {
  const { project, slug } = useProjectContext();
  const query = useExperiment(project.id, experimentId);
  const showSkeleton = useDelayedPending(query.isPending);
  useDocumentTitle(`${query.data?.name ?? 'Experiment'} · ${project.name}`);
  const back = (
    <Link to={experimentsPath(slug)} className={styles.back}>
      ← All experiments
    </Link>
  );
  if (query.data) return <Loaded detail={query.data} />;
  return (
    <div className={`${fullWidth} ${styles.page}`}>
      {back}
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load this experiment"
          notFoundMessage="This experiment doesn’t exist in this project, or it was deleted."
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
    navigate(compareHref(selectedRuns));
  }

  function showAttempts(job: ExperimentJob) {
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

  const envNames = (x.environments ?? []).map((e) => `${e.name}${e.is_active ? '' : ' (disabled)'}`);
  const meta = [
    x.created_by_email ?? 'unknown creator',
    <span key="age" title={absTime(x.created_at)}>
      {relTime(x.created_at)}
    </span>,
    `Priority ${titleCase(x.priority)}`,
    `Base: ${baseSourceLabel(x.base_source)}`,
    envNames.length ? envNames.join(', ') : null,
  ].filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <div className={`${fullWidth} ${styles.page}`} data-exp-detail={x.id}>
      <Link to={experimentsPath(slug)} className={styles.back}>
        ← All experiments
      </Link>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            {x.name || x.id}
            <ExperimentStatusBadge status={x.status} />
          </span>
        }
        description={
          x.description || 'Jobs launched by this experiment, one per combination and environment.'
        }
        meta={meta}
      />
      <div className={styles.headerActions}>
        {retryable.length ? (
          <Button
            variant="neutral"
            size="md"
            isDisabled={!canControl || flows.busy.size > 0}
            onPress={flows.retryFailed}
          >
            Retry failed ({retryable.length})
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="md"
          isDisabled={!canControl || !cancellable.length || flows.busy.has('all')}
          onPress={flows.cancelExperiment}
        >
          Cancel experiment
        </Button>
      </div>
      {!canControl && !readOnly ? (
        <Text variant="base" tone="muted" className={styles.note}>
          {flows.denied
            ? 'You are not allowed to change this experiment.'
            : 'Only the experiment’s creator or a project manager can cancel or retry jobs.'}
        </Text>
      ) : null}
      <StatStrip
        aria-label="Job totals"
        items={[
          { key: 'jobs', label: 'Jobs', value: stats.jobs },
          {
            key: 'ok',
            label: 'Succeeded',
            value: stats.succeeded,
            tone: stats.succeeded ? 'success' : undefined,
          },
          { key: 'failed', label: 'Failed', value: stats.failed, tone: stats.failed ? 'danger' : undefined },
          {
            key: 'live',
            label: 'In progress',
            value: stats.inProgress,
            tone: stats.inProgress ? 'accent' : undefined,
          },
          {
            key: 'cancelled',
            label: 'Cancelled',
            value: stats.cancelled,
            tone: stats.cancelled ? 'warning' : undefined,
          },
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
        flows={flows}
        canControl={canControl}
        live={live}
      />
      {flows.dialogs}
    </div>
  );
}
