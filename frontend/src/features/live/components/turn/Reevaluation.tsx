import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LiveTurnDetail, LiveTurnReevaluation } from '@/api/live';
import { jobTurnId, useLiveActivity, useReevaluateTurn, type LiveActivityRead } from '@/api/liveWorker';
import { useOptionalProject } from '@/features/shell/ProjectContext';
import { ApiError, actionErrorMessage } from '@/lib/http';
import { textDirAttrs } from '@/lib/text';
import { Button, Card, Icon, InlineNotice, StatusMark, Text, useFlashOnChange } from '@/ui';
import { reevaluationProgress } from '../../lib/activity';
import { recordOf, stringOf, verdictOf } from '../../lib/summary';
import { useNow } from '../ActivityLine';
import { labelFor, liveTime } from './presentation';
import styles from '../../activity.module.css';

const STATE_WORDS = { done: 'Done', now: 'Now', next: 'Next', stopped: 'Stopped here' } as const;

export interface PreviousVerdict {
  label: string;
  at: string | null;
}

export interface ReevaluationState {
  /** The viewer may change the project (a Viewer and an archived project may not). */
  canRequest: boolean;
  /** This turn's queued or running re-evaluation. */
  active: (NonNullable<LiveTurnReevaluation['active']> & { status: 'queued' | 'running' }) | null;
  /** The request is on its way to the server. */
  pending: boolean;
  /** Why the request was refused, as one sentence. */
  error: string | null;
  /** The latest finished re-evaluation of this turn, as the server reports it. */
  last: LiveTurnReevaluation['last'];
  /** The worker's last answer about what it is doing, read only while a re-evaluation of this turn is known. */
  activity: LiveActivityRead | undefined;
  turnId: string;
  request: () => void;
}

/** The verdict a redone turn replaced, as the worker recorded it beside `reevaluated_from`. */
export function previousVerdictOf(data: LiveTurnDetail): PreviousVerdict | null {
  const previous = recordOf(recordOf(data.summary.eval_meta)?.previous_verdict);
  const label = stringOf(previous?.label);
  return label ? { label: labelFor(label, data.specs).label, at: stringOf(previous?.evaluated_at) } : null;
}

/** The verdict on the page now, in the words of the "Previous verdict" line shown while it is being redone. */
export function currentVerdictOf(data: LiveTurnDetail): PreviousVerdict | null {
  const label = verdictOf(data.summary)?.label ?? data.turn.label;
  return label ? { label: labelFor(label, data.specs).label, at: data.turn.evaluated_at } : null;
}

/**
 * One turn's re-evaluation: the request, the job while it is queued or running, and the refetch when it ends.
 * `loadedAt` is when the turn was last read, so an older activity answer is never taken as "the job is gone".
 */
export function useReevaluation(
  slug: string,
  source: string,
  turnId: string,
  data: LiveTurnDetail | undefined,
  loadedAt: number,
): ReevaluationState {
  const client = useQueryClient();
  const canRequest = useOptionalProject()?.readOnly === false;
  const mutation = useReevaluateTurn(slug, source);
  const [posted, setPosted] = useState<{ id: string; at: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const reported = data?.reevaluation?.active ?? null;
  const wanted = reported ?? (posted ? { id: posted.id, status: 'queued' as const } : null);
  const activity = useLiveActivity(slug, source, Boolean(wanted));
  const seen = activity.data;
  const job = seen?.job && seen.job.kind === 'reevaluate' && jobTurnId(seen.job) === turnId ? seen.job : null;
  const since = Math.max(posted?.at ?? 0, reported ? loadedAt : 0);
  // The worker's queue was read after the job was known and no longer holds it: it has ended.
  const gone = Boolean(wanted && seen && seen.received_at >= since && !job);
  useEffect(() => {
    if (gone) void client.invalidateQueries({ queryKey: ['project', slug, 'live', 'turn', source, turnId] });
  }, [gone, client, slug, source, turnId]);
  const active = wanted && !gone ? { ...wanted, status: job?.status ?? wanted.status } : null;
  return {
    canRequest,
    active,
    pending: mutation.isPending,
    error: refused,
    last: data?.reevaluation?.last ?? null,
    activity: seen,
    turnId,
    request: () => {
      setRefused(null);
      mutation.mutate(turnId, {
        onSuccess: (created) => setPosted({ id: created.id, at: Date.now() }),
        onError: (error) =>
          setRefused(
            error instanceof ApiError && error.status === 409
              ? 'A re-evaluation of another turn is already running. Try again when it finishes.'
              : actionErrorMessage('re-evaluate this turn', error),
          ),
      });
    },
  };
}

/** The turn header action: writers only; it reads "Re-evaluating" and is off while this turn is being redone. */
export function ReevaluateButton({ state }: { state: ReevaluationState }) {
  if (!state.canRequest) return null;
  const busy = Boolean(state.active) || state.pending;
  return (
    <Button
      variant="neutral"
      icon={<Icon name="retry" size={12} />}
      isDisabled={busy}
      onPress={state.request}
      data-live-block="reevaluate"
    >
      {busy ? 'Re-evaluating' : 'Re-evaluate'}
    </Button>
  );
}

/** The five steps of a queued or running re-evaluation. It owns the one-second clock, so the page does not tick. */
function ReevaluationCard({
  state,
  active,
  data,
}: {
  state: ReevaluationState;
  active: NonNullable<ReevaluationState['active']>;
  data: LiveTurnDetail;
}) {
  const now = useNow();
  const progress = reevaluationProgress(state.activity, now, {
    turnId: state.turnId,
    jobId: active.id,
    queued: active.status === 'queued',
  });
  const flash = useFlashOnChange(progress.beat, Boolean(progress.beat));
  const previous = currentVerdictOf(data);
  const working = active.status === 'running' || progress.running;
  return (
    <Card compact data-live-block="reevaluation" data-live-card="reevaluation">
      <div className={styles.reevaluation}>
        <div className={styles.reevaluationHead}>
          <span className={styles.what} data-changed={flash ? '' : undefined}>
            {progress.stale ? (
              <StatusMark tone="warning" shape="pause" label="Re-evaluating this turn" wrap />
            ) : working ? (
              <StatusMark tone="info" shape="orbit" label="Re-evaluating this turn" wrap />
            ) : (
              <StatusMark tone="neutral" shape="ring" label="Waiting for the worker" wrap />
            )}
          </span>
          {progress.count ? <span className={styles.count}>{progress.count}</span> : null}
          {progress.freshness ? (
            <span
              className={styles.fresh}
              data-tone={progress.stale ? 'warning' : undefined}
              data-activity-freshness
            >
              {progress.freshness}
            </span>
          ) : null}
        </div>
        {progress.steps.length ? (
          <ol className={styles.steps} aria-label="Steps of the re-evaluation">
            {progress.steps.map((step) => (
              <li
                key={step.key}
                className={styles.step}
                data-state={step.state}
                aria-current={step.state === 'now' || step.state === 'stopped' ? 'step' : undefined}
              >
                <span className={styles.stepBar} aria-hidden="true" />
                <span>{step.label}</span>
                <span className={styles.stepState}>{STATE_WORDS[step.state]}</span>
              </li>
            ))}
          </ol>
        ) : working ? (
          <Text as="p" variant="sm" tone="muted">
            This worker does not report its steps.
          </Text>
        ) : null}
        {previous ? (
          <p className={styles.previous} data-live-block="previous-verdict">
            Previous verdict: {previous.label}
            {previous.at ? `, ${liveTime(previous.at)}` : ''}. It stays until the new one is saved.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Under the turn header: the five steps while this turn is redone, then how the last attempt ended if it failed. */
export function ReevaluationBlock({ state, data }: { state: ReevaluationState; data: LiveTurnDetail }) {
  const { active, last } = state;
  return (
    <>
      {state.error ? (
        <InlineNotice tone="warning" lead="Not started." data-testid="reevaluation-error">
          {state.error}
        </InlineNotice>
      ) : null}
      {active ? (
        <ReevaluationCard state={state} active={active} data={data} />
      ) : last && last.status !== 'done' ? (
        <InlineNotice
          tone={last.status === 'failed' ? 'danger' : 'warning'}
          lead={last.status === 'failed' ? 'Re-evaluation failed.' : 'Re-evaluation cancelled.'}
          data-testid="reevaluation-last"
        >
          {last.error ? <span {...textDirAttrs(last.error)}>{last.error} </span> : null}
          The verdict below is the earlier one
          {last.finished_at ? ` (tried ${liveTime(last.finished_at)})` : ''}.
        </InlineNotice>
      ) : null}
    </>
  );
}
