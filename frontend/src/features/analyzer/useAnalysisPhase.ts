/**
 * One derived state for the action rail and the results slot, so both always
 * agree: idle -> testing -> idle (with test results), idle -> starting ->
 * running -> done | failed | cancelled (cancelling in between).
 */
import { useMemo } from 'react';
import { isJobTerminal, type AnalysisJob } from '@/api/analysis';
import type { RunnerState } from './useAnalysisRunner';

export type AnalysisPhase =
  'idle' | 'testing' | 'starting' | 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled';

export interface PhaseInput {
  job: AnalysisJob | null;
  starting: boolean;
  cancelling: boolean;
  reconnecting: boolean;
  testing: boolean;
}

export interface PhaseView {
  phase: AnalysisPhase;
  /** A job is queued, running or being cancelled (the form must not change). */
  live: boolean;
  /** The job reached a terminal state and is still shown. */
  finished: boolean;
  completed: number;
  total: number;
  /** Integer percent, 0 when the total is unknown. */
  pct: number;
  reconnecting: boolean;
  /** Retry sentence while the analyzer retries a timed-out request. */
  retryNote: string | null;
}

export function retryNoteOf(job: AnalysisJob): string | null {
  const p = job.progress;
  if (p.phase !== 'retrying') return null;
  const attempt =
    p.retry_attempt && p.retry_max_attempts ? ` (attempt ${p.retry_attempt} of ${p.retry_max_attempts})` : '';
  return `Retrying ${p.metric_name ?? 'item'}${p.item_id ? ` on ${p.item_id}` : ''}${attempt}${p.retry_reason ? `: ${p.retry_reason}` : ''}`;
}

/** Pure derivation (unit-tested); `useAnalysisPhase` memoizes it. */
export function derivePhase(input: PhaseInput): PhaseView {
  const { job } = input;
  const completed = job?.progress.completed ?? 0;
  const total = job?.progress.total ?? 0;
  const pct = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const base = { completed, total, pct, reconnecting: input.reconnecting };
  if (!job) {
    const phase: AnalysisPhase = input.starting ? 'starting' : input.testing ? 'testing' : 'idle';
    return {
      ...base,
      phase,
      live: phase === 'starting',
      finished: false,
      retryNote: null,
      reconnecting: false,
    };
  }
  const terminal = isJobTerminal(job.status);
  let phase: AnalysisPhase;
  if (!terminal) phase = input.cancelling || job.status === 'cancelling' ? 'cancelling' : 'running';
  else if (job.status === 'completed') phase = 'done';
  else if (job.status === 'cancelled') phase = 'cancelled';
  else phase = 'failed';
  return {
    ...base,
    phase,
    live: !terminal,
    finished: terminal,
    retryNote: terminal ? null : retryNoteOf(job),
    reconnecting: input.reconnecting && !terminal,
  };
}

export function useAnalysisPhase(runner: RunnerState, testing: boolean): PhaseView {
  const { job, starting, cancelling, reconnecting } = runner;
  return useMemo(
    () => derivePhase({ job, starting, cancelling, reconnecting, testing }),
    [job, starting, cancelling, reconnecting, testing],
  );
}
