/**
 * Background analysis job lifecycle: start -> poll -> cancel -> resume via /active.
 * State is keyed by run + sample, so a stale response from another sample never applies.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  isJobTerminal,
  runCompactKey,
  useActiveAnalysisJob,
  useAnalysisJob,
  useCancelAnalysisJob,
  useStartAnalysisJob,
  type AnalysisJob,
  type AnalyzeRequest,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';

export interface RunnerState {
  job: AnalysisJob | null;
  /** True while the job is queued/running/cancelling (the sample must not change). */
  busy: boolean;
  starting: boolean;
  cancelling: boolean;
  /** The last status poll failed; the job is probably still running and polling continues. */
  reconnecting: boolean;
  startError: string | null;
  start: (body: AnalyzeRequest) => Promise<AnalysisJob | null>;
  cancel: () => void;
  /** Dismiss a finished job's summary card. */
  dismiss: () => void;
}

interface Keyed<T> {
  key: string;
  value: T;
}

export function useAnalysisRunner(
  runId: string,
  pass: number | null,
  onFinished?: (job: AnalysisJob) => void,
): RunnerState {
  const qc = useQueryClient();
  const key = `${runId}:${pass ?? ''}`;
  const [started, setStarted] = useState<Keyed<string> | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<Keyed<string> | null>(null);
  const startMutation = useStartAnalysisJob(runId);
  const cancelMutation = useCancelAnalysisJob(runId);
  const finishedFor = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  const startedId = started?.key === key ? started.value : null;
  // Resume a job that is already running (page reload, other tab).
  const active = useActiveAnalysisJob(runId, pass, startedId === null);
  const activeJob = active.data?.job ?? null;
  const resumedId = activeJob && !isJobTerminal(activeJob.status) ? activeJob.job_id : null;
  const candidate = startedId ?? resumedId;
  const jobId = candidate && candidate !== dismissed ? candidate : null;

  const polled = useAnalysisJob(runId, pass, jobId);
  const job = jobId ? (polled.data ?? null) : null;

  useEffect(() => {
    if (!job || !isJobTerminal(job.status) || finishedFor.current === job.job_id) return;
    finishedFor.current = job.job_id;
    void qc.invalidateQueries({ queryKey: runCompactKey(runId, pass) });
    void qc.invalidateQueries({ queryKey: ['analysis', 'config'] });
    onFinishedRef.current?.(job);
  }, [job, qc, runId, pass]);

  // A double click must not queue two jobs: `isPending` only flips after the next render.
  const startInFlight = useRef(false);
  const start = useCallback(
    async (body: AnalyzeRequest) => {
      if (startInFlight.current) return null;
      startInFlight.current = true;
      setError(null);
      try {
        const created = await startMutation.mutateAsync(body);
        finishedFor.current = null;
        setStarted({ key, value: created.job_id });
        setDismissed(null);
        return created;
      } catch (e) {
        const message =
          e instanceof ApiError
            ? e.status === 409
              ? 'This sample changed since the page loaded. Reload it, then analyze again.'
              : e.detail || e.message
            : 'The analysis could not be started.';
        setError({ key, value: message });
        return null;
      } finally {
        startInFlight.current = false;
      }
    },
    [startMutation, key],
  );

  const cancel = useCallback(() => {
    if (jobId) cancelMutation.mutate(jobId, { onSuccess: () => void polled.refetch() });
  }, [cancelMutation, jobId, polled]);

  const dismiss = useCallback(() => setDismissed(jobId), [jobId]);

  return {
    job,
    busy: Boolean(job && !isJobTerminal(job.status)) || startMutation.isPending,
    starting: startMutation.isPending,
    cancelling: cancelMutation.isPending || job?.status === 'cancelling',
    reconnecting: Boolean(jobId && polled.isError && !isJobTerminal(job?.status)),
    startError: error?.key === key ? error.value : null,
    start,
    cancel,
    dismiss,
  };
}
