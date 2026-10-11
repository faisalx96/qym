/** Rule-generation job lifecycle (start / poll / cancel / resume) for one scope. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isJobTerminal,
  scopeKey,
  useActiveRuleJob,
  useCancelRuleJob,
  useRuleJob,
  useStartRuleJob,
  type AnalysisScope,
  type RuleJob,
  type RuleJobRequest,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';

export function useRuleGenerator(scope: AnalysisScope, onFinished?: (job: RuleJob) => void) {
  const key = scopeKey(scope);
  const [started, setStarted] = useState<{ key: string; id: string } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startMutation = useStartRuleJob(scope);
  const cancelMutation = useCancelRuleJob(scope);
  const finishedFor = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  const startedId = started?.key === key ? started.id : null;
  const active = useActiveRuleJob(scope, startedId === null);
  const activeJob = active.data?.job ?? null;
  const resumedId = activeJob && !isJobTerminal(activeJob.status) ? activeJob.job_id : null;
  const candidate = startedId ?? resumedId;
  const jobId = candidate && candidate !== dismissed ? candidate : null;

  const polled = useRuleJob(scope, jobId);
  const job = jobId ? (polled.data ?? null) : null;
  useEffect(() => {
    if (!job || !isJobTerminal(job.status) || finishedFor.current === job.job_id) return;
    finishedFor.current = job.job_id;
    onFinishedRef.current?.(job);
  }, [job]);

  const start = useCallback(
    async (body: RuleJobRequest) => {
      setError(null);
      try {
        const created = await startMutation.mutateAsync(body);
        finishedFor.current = null;
        setStarted({ key, id: created.job_id });
        setDismissed(null);
        return created;
      } catch (e) {
        setError(e instanceof ApiError ? e.detail || e.message : 'Rule generation could not start.');
        return null;
      }
    },
    [startMutation, key],
  );
  const cancel = useCallback(() => {
    if (jobId) cancelMutation.mutate(jobId, { onSuccess: () => void polled.refetch() });
  }, [cancelMutation, jobId, polled]);

  return {
    job,
    busy: Boolean(job && !isJobTerminal(job.status)) || startMutation.isPending,
    cancelling: cancelMutation.isPending || job?.status === 'cancelling',
    startError: error,
    start,
    cancel,
    dismiss: () => setDismissed(jobId),
  };
}
