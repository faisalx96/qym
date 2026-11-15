/**
 * Priority per run (round 9, decision I2). A run is one job of the dry-run preview; its key is
 * `environment:combo:dataset`. The experiment's priority (step 1) is the default of every row; only the
 * rows the user changed are stored, so changing the default still moves every other row.
 * Rules are the experiment's, applied per run: High needs a project manager, is capped by the run's own
 * environment, and any High run needs the preemption acknowledgement.
 */
import { PRIORITY_ORDER } from './document';
import type {
  DryRunJob,
  DryRunResponse,
  FormContext,
  JobPriorityRequest,
  LaunchDocument,
  Priority,
} from './types';

export const PRIORITIES: readonly Priority[] = ['LOW', 'NORMAL', 'HIGH'];

export const priorityLabel = (p: Priority): string => p.charAt(0) + p.slice(1).toLowerCase();

export function jobKey(job: Pick<DryRunJob, 'environment_id' | 'combo_index' | 'dataset_index'>): string {
  return `${job.environment_id}:${job.combo_index}:${job.dataset_index ?? 0}`;
}

/** What a run gets when the user did not change it: the experiment's priority, else the lowest environment default. */
export function defaultRunPriority(
  doc: Pick<LaunchDocument, 'priority'>,
  ctx: Pick<FormContext, 'envs'>,
  preview?: Pick<DryRunResponse, 'priority'> | null,
): Priority {
  if (doc.priority) return doc.priority;
  const defaults = ctx.envs.map((e) => e.defaultPriority).filter((p): p is Priority => Boolean(p));
  if (defaults.length) return defaults.reduce((a, b) => (PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b));
  return preview?.priority ?? 'NORMAL';
}

/** The priority of one run row. */
export function runPriority(doc: Pick<LaunchDocument, 'jobPriorities'>, key: string, fallback: Priority): Priority {
  return doc.jobPriorities[key] ?? fallback;
}

/** Choose a priority for one run; choosing the default removes the change. */
export function setJobPriority(doc: LaunchDocument, key: string, value: Priority, fallback: Priority): LaunchDocument {
  const next = { ...doc.jobPriorities };
  if (value === fallback) delete next[key];
  else next[key] = value;
  return { ...doc, jobPriorities: next };
}

/** One action for every run ("Set every run to"): clears every change when `value` is the default. */
export function setAllJobPriorities(
  doc: LaunchDocument,
  keys: readonly string[],
  value: Priority,
  fallback: Priority,
): LaunchDocument {
  if (value === fallback) return { ...doc, jobPriorities: {} };
  return { ...doc, jobPriorities: Object.fromEntries(keys.map((k) => [k, value])) };
}

export function clearJobPriorities(doc: LaunchDocument): LaunchDocument {
  return Object.keys(doc.jobPriorities).length ? { ...doc, jobPriorities: {} } : doc;
}

/** The entries of `doc.jobPriorities` that still name a run of the preview (others are dropped). */
export function liveJobPriorities(
  doc: Pick<LaunchDocument, 'jobPriorities'>,
  jobs: readonly Pick<DryRunJob, 'environment_id' | 'combo_index' | 'dataset_index'>[] | undefined,
): JobPriorityRequest[] {
  if (!jobs) return [];
  const out: JobPriorityRequest[] = [];
  for (const job of jobs) {
    const priority = doc.jobPriorities[jobKey(job)];
    if (priority)
      out.push({
        environment_id: job.environment_id,
        combo_index: job.combo_index,
        dataset_index: job.dataset_index ?? 0,
        priority,
      });
  }
  return out;
}

/** Drops the changes that name a run the preview no longer has (a sweep changed). */
export function pruneJobPriorities(
  doc: LaunchDocument,
  jobs: readonly Pick<DryRunJob, 'environment_id' | 'combo_index' | 'dataset_index'>[] | undefined,
): LaunchDocument {
  if (!jobs || !Object.keys(doc.jobPriorities).length) return doc;
  const keys = new Set(jobs.map(jobKey));
  const kept = Object.entries(doc.jobPriorities).filter(([k]) => keys.has(k));
  return kept.length === Object.keys(doc.jobPriorities).length ? doc : { ...doc, jobPriorities: Object.fromEntries(kept) };
}

export interface RunOption {
  value: Priority;
  label: string;
  disabled: boolean;
  description?: string;
}

/** Options of one run's select: High needs a manager and the run's environment cap. */
export function runPriorityOptions(
  envMax: Priority | null | undefined,
  envName: string,
  isManager: boolean,
): RunOption[] {
  const cap = envMax ?? 'NORMAL';
  return PRIORITIES.map((p) => {
    const overCap = PRIORITY_ORDER[p] > PRIORITY_ORDER[cap];
    const gated = p === 'HIGH' && !isManager;
    return {
      value: p,
      label: priorityLabel(p),
      disabled: overCap || gated,
      description: gated ? 'Only project managers' : overCap ? `Capped at ${priorityLabel(cap)} on ${envName}` : undefined,
    };
  });
}

/** The environments (in run order, once each) of the runs that are High. */
export function highEnvironments(
  doc: Pick<LaunchDocument, 'jobPriorities'>,
  jobs: readonly DryRunJob[] | undefined,
  fallback: Priority,
): string[] {
  const out: string[] = [];
  for (const job of jobs ?? []) {
    if (runPriority(doc, jobKey(job), fallback) === 'HIGH') {
      const name = job.environment_name ?? job.environment_id;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

export function highRunCount(
  doc: Pick<LaunchDocument, 'jobPriorities'>,
  jobs: readonly DryRunJob[] | undefined,
  fallback: Priority,
): number {
  return (jobs ?? []).filter((j) => runPriority(doc, jobKey(j), fallback) === 'HIGH').length;
}
