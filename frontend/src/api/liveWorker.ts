/** Live worker control, settings and jobs. Secrets are write-only. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { safeZone, zoneDateTime, zoneLabel } from '@/features/live/lib/zone';
import { api } from '@/lib/http';
import type { LiveSourceInfo } from './live';
export { errorReport } from '@/lib/error-report';

export interface LiveWorkerValues {
  evaluation: {
    chart_vision_enabled: boolean;
    chart_design_enabled: boolean;
    chart_images_upload: boolean;
    dataiku_execution: boolean;
    parallel_turns: number;
    poll_interval_s: number;
    lookback_hours: number;
  };
  models: {
    connection_id: string;
    judge_a: string;
    judge_b: string;
    vision_judge: string;
    vision_extractor: string;
    vision_design_judge: string;
  };
  langfuse: { host: string; public_key: string };
  evaluator_traces: { enabled: boolean; host: string; public_key: string };
  dataiku: { url: string; database: string };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  };
}
/** Stored versions and older workers may omit the evaluator traces section. */
export type LiveWorkerStoredValues = Omit<LiveWorkerValues, 'evaluator_traces'> &
  Partial<Pick<LiveWorkerValues, 'evaluator_traces'>>;
export interface LiveWorkerControl {
  state: 'waiting' | 'running' | 'paused';
  reason: string | null;
  settings_version_applied: number | null;
  applied_at: string | null;
  verification: null | {
    version: number;
    ok: boolean;
    checked_at: string;
    checks: Record<string, { ok: boolean; latency_ms: number | null; error: string | null }>;
  };
  running: LiveWorkerStoredValues | null;
  models: { listed_at: string; ids: string[] } | null;
  errors_last_hour: number;
  last_error: { at: string; component: string; code: string; message: string } | null;
  job: {
    id?: string;
    kind?: string;
    progress?: Record<string, unknown>;
    waiting_reason?: string;
    blocked_job_id?: string;
  } | null;
}
export interface LiveWorkerVersion {
  /** Section identifiers only; omitted by older servers or when history cannot be decrypted. */
  changed_sections?: string[];
  version: number;
  created_at: string;
  created_by: string | null;
  created_by_user_id?: string | null;
  note: string | null;
}
export interface LiveWorkerKey {
  id: string;
  name: string;
  prefix: string;
  changed_at: string | null;
  changed_by: string | null;
}
export interface LiveJob {
  id: string;
  /** 'reevaluate' redoes one turn: its params name the turn in trace_ids and carry no day range. */
  kind: 'backfill_preview' | 'backfill' | 'reevaluate';
  params: {
    since_day: string;
    until_day: string;
    since: string;
    until: string;
    limit: number;
    redo?: string[];
    trace_ids?: string[];
  };
  /** The turn of a re-evaluation, when the server names it on the job itself. */
  trace_id?: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: {
    found?: number;
    listed?: number;
    redone?: number;
    skipped_existing?: number;
    evaluated?: number;
    failed?: number;
    last_turn_at?: string;
    paused?: boolean;
    resumed?: number;
    judged?: number;
    recorded?: number;
    incomplete?: number;
    fetch_failed?: number;
    deferred?: number;
    limit_reached?: boolean;
    remaining?: number;
    would_evaluate?: number;
    would_redo?: number;
    beyond_limit?: number;
    waiting?: string;
    /** The worker stopped listing once it had enough turns, so no exact count of the rest exists. */
    listing_stopped_early?: boolean;
    rejected?: {
      [key: string]: unknown;
      other_names?: number;
      no_session?: number;
      excluded_users?: number;
      other_environment?: number;
      bad_timestamp?: number;
    };
    effective_until?: string;
  };
  error: string | null;
  requested_by: string | null;
  requested_by_user_id?: string | null;
  requested_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested: boolean;
}
/** Older workers cannot distinguish redo or turns beyond the selection limit. */
export function jobPreviewSentence(job: LiveJob): string {
  const p = job.progress;
  if (p.would_evaluate === undefined && p.would_redo === undefined && p.beyond_limit === undefined) {
    return `${p.found ?? 0} turns, ${p.skipped_existing ?? 0} already evaluated, ${(p.found ?? 0) - (p.skipped_existing ?? 0)} to evaluate`;
  }
  return `${p.would_evaluate ?? 0} to evaluate · ${p.would_redo ?? 0} to redo · ${p.skipped_existing ?? 0} already evaluated · ${p.beyond_limit ?? 0} beyond the limit of ${job.params.limit}`;
}

export interface LiveWorkerEvent {
  id: number;
  level: 'error' | 'warning';
  component: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
  count: number;
  first_at: string;
  last_at: string;
}
export type LiveWorkerSecrets = Partial<
  Record<
    'langfuse_secret_key' | 'evaluator_traces_secret_key' | 'dataiku_api_key' | 'database_password',
    string
  >
>;
export interface LiveWorkerRead {
  state: { desired: 'running' | 'paused'; changed_at: string | null; changed_by: string | null };
  running: LiveWorkerControl | null;
  stale: boolean;
  status: LiveSourceInfo;
  today: { day: string; turns_seen: number; evaluated: number; failed: number; in_qym: number };
  worker_key: LiveWorkerKey | null;
  api_keys: Pick<LiveWorkerKey, 'id' | 'name' | 'prefix'>[];
  settings: (LiveWorkerVersion & { values: LiveWorkerStoredValues; secret_hints: LiveWorkerSecrets }) | null;
  versions: LiveWorkerVersion[];
  jobs: LiveJob[];
  connections: { id: string; name: string; base_url: string; api_key_last4: string }[];
  model_ids: string[];
}
export interface WorkerEventsFilters {
  component?: string[];
  level?: ('error' | 'warning')[];
  limit?: number;
  page?: number;
}
export interface LiveWorkerEvents {
  events: LiveWorkerEvent[];
  total?: number;
  page?: number;
  limit?: number;
}
export interface SaveWorkerSettings {
  values: LiveWorkerValues;
  secrets?: LiveWorkerSecrets;
  note?: string;
}
export interface CreateWorkerJob {
  kind: 'backfill_preview' | 'backfill';
  since_day: string;
  until_day: string;
  limit: number;
  redo?: ('failed' | 'inconclusive' | 'all')[];
}

const workerKey = (slug: string, source: string) => ['project', slug, 'live', 'worker', source];
function livePath(
  slug: string,
  source: string,
  sub = '',
  filters: WorkerEventsFilters & { jobs_limit?: number } = {},
) {
  const params = new URLSearchParams({ source });
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, String(value));
  }
  return `/api/projects/${encodeURIComponent(slug)}/live/worker${sub}?${params}`;
}
export function useLiveWorker(slug: string, source: string, jobsLimit?: number) {
  return useQuery({
    queryKey: [...workerKey(slug, source), jobsLimit],
    queryFn: () => api.get<LiveWorkerRead>(livePath(slug, source, '', { jobs_limit: jobsLimit })),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === slug && query.queryKey[4] === source ? previous : undefined,
    refetchInterval: (query) =>
      query.state.data?.jobs?.some((job) => job.status === 'queued' || job.status === 'running')
        ? 5000
        : 15000,
    refetchIntervalInBackground: false,
  });
}
export function useLiveWorkerEvents(slug: string, source: string, filters: WorkerEventsFilters = {}) {
  return useQuery({
    queryKey: ['project', slug, 'live', 'worker-events', source, filters],
    queryFn: () => api.get<LiveWorkerEvents>(livePath(slug, source, '/events', filters)),
    placeholderData: (previous, query) => {
      const previousFilters = query?.queryKey[5] as WorkerEventsFilters | undefined;
      return query?.queryKey[1] === slug &&
        query.queryKey[4] === source &&
        JSON.stringify(previousFilters?.component ?? []) === JSON.stringify(filters.component ?? []) &&
        JSON.stringify(previousFilters?.level ?? []) === JSON.stringify(filters.level ?? [])
        ? previous
        : undefined;
    },
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
}
function useWorkerMutation<T, R>(
  slug: string,
  source: string,
  mutationFn: (input: T) => Promise<R>,
  sources = false,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: workerKey(slug, source) }),
        ...(sources ? [client.invalidateQueries({ queryKey: ['project', slug, 'live', 'sources'] })] : []),
      ]);
    },
  });
}
export function useSetWorkerState(slug: string, source: string) {
  return useWorkerMutation(
    slug,
    source,
    (state: LiveWorkerRead['state']['desired']) =>
      api.put<LiveWorkerRead['state']>(livePath(slug, source, '/state'), { state }),
    true,
  );
}
export function useSetWorkerKey(slug: string, source: string) {
  return useWorkerMutation(
    slug,
    source,
    (api_key_id: string | null) =>
      api.put<{ worker_key: LiveWorkerKey | null }>(livePath(slug, source, '/key'), { api_key_id }),
    true,
  );
}
export function useSaveWorkerSettings(slug: string, source: string) {
  return useWorkerMutation(slug, source, (body: SaveWorkerSettings) =>
    api.post<{ version: number }>(livePath(slug, source, '/settings'), body),
  );
}
export function useRestoreWorkerSettings(slug: string, source: string) {
  return useWorkerMutation(slug, source, (version: number) =>
    api.post<{ version: number }>(livePath(slug, source, `/settings/${version}/restore`)),
  );
}
export function useCreateWorkerJob(slug: string, source: string) {
  return useWorkerMutation(slug, source, (body: CreateWorkerJob) =>
    api.post<LiveJob>(livePath(slug, source, '/jobs'), body),
  );
}
/** The turn a re-evaluation job redoes (the turn id is the trace id), or null for a day-range job. */
export function jobTurnId(job: Pick<LiveJob, 'kind' | 'trace_id'> & { params?: { trace_ids?: string[] } }) {
  if (job.kind !== 'reevaluate') return null;
  return job.trace_id || job.params?.trace_ids?.[0] || null;
}

/** One slot of the worker's own report: what the live loop or the job runner is doing now. */
export interface LiveActivitySlot {
  kind: string;
  job_id?: string | null;
  trace_id?: string | null;
  /** A name from `steps`, or null between turns. */
  step?: string | null;
  step_index?: number | null;
  step_count?: number | null;
  done?: number | null;
  total?: number | null;
  started_at?: string | null;
  reported_at?: string | null;
}
export interface LiveActivityJob {
  id: string;
  kind: LiveJob['kind'];
  status: 'queued' | 'running';
  trace_id?: string | null;
  progress?: LiveJob['progress'];
  params?: Partial<LiveJob['params']>;
  requested_at?: string;
  requested_by?: string | null;
  updated_at?: string;
}
export interface LiveActivity {
  server_time: string;
  worker: {
    state: 'running' | 'paused' | 'waiting';
    reason: string | null;
    /** When qym last heard from the worker (server clock). */
    last_report_at: string | null;
    stale: boolean;
    last_poll_at: string | null;
    poll_interval_s: number | null;
  };
  /** Null for a worker that does not report its activity (older than the activity line). */
  activity: null | {
    steps: string[];
    live: LiveActivitySlot | null;
    job: LiveActivitySlot | null;
  };
  /** The queued or running job, if any. */
  job: LiveActivityJob | null;
}
export const liveActivityKey = (slug: string, source: string) => [...workerKey(slug, source), 'activity'];
/**
 * What the worker reports it is doing, for the activity line: polled every 5 seconds while the tab is visible.
 * Nothing here is derived on the client: a worker that stops reporting shows as silence.
 */
export function useLiveActivity(slug: string, source: string, enabled = true) {
  return useQuery({
    queryKey: liveActivityKey(slug, source),
    queryFn: async () => {
      const data = await api.get<LiveActivity>(livePath(slug, source, '/activity'));
      // The client clock when the answer arrived, to read server times without trusting both clocks to agree.
      return { ...data, received_at: Date.now() };
    },
    enabled,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
}
export type LiveActivityRead = LiveActivity & { received_at: number };
/** Queue a re-evaluation of one turn (the turn id is its trace id). */
export function useReevaluateTurn(slug: string, source: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (trace_id: string) =>
      api.post<LiveJob>(livePath(slug, source, '/jobs'), { kind: 'reevaluate', trace_id }),
    onSuccess: async (_job, trace_id) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: workerKey(slug, source) }),
        client.invalidateQueries({ queryKey: ['project', slug, 'live', 'turn', source, trace_id] }),
      ]);
    },
  });
}
export function useCancelWorkerJob(slug: string, source: string) {
  return useWorkerMutation(slug, source, (id: string) =>
    api.post<LiveJob>(livePath(slug, source, `/jobs/${encodeURIComponent(id)}/cancel`)),
  );
}
export function workerDefaults(): LiveWorkerValues {
  return {
    evaluation: {
      chart_vision_enabled: true,
      chart_design_enabled: true,
      chart_images_upload: true,
      dataiku_execution: true,
      parallel_turns: 3,
      poll_interval_s: 60,
      lookback_hours: 1,
    },
    models: {
      connection_id: '',
      judge_a: '',
      judge_b: '',
      vision_judge: '',
      vision_extractor: '',
      vision_design_judge: '',
    },
    langfuse: { host: '', public_key: '' },
    evaluator_traces: { enabled: false, host: '', public_key: '' },
    dataiku: { url: '', database: '' },
    database: { host: '', port: 5432, database: '', user: '', sslmode: 'require' },
  };
}
/** Fill absent sections at the form boundary, for both saved and running values. */
export function normalizeWorkerValues(values?: Partial<LiveWorkerValues> | null): LiveWorkerValues {
  const defaults = workerDefaults();
  return {
    evaluation: values?.evaluation ?? defaults.evaluation,
    models: values?.models ?? defaults.models,
    langfuse: values?.langfuse ?? defaults.langfuse,
    evaluator_traces: values?.evaluator_traces ?? defaults.evaluator_traces,
    dataiku: values?.dataiku ?? defaults.dataiku,
    database: values?.database ?? defaults.database,
  };
}
const checkPrefixes: Partial<Record<keyof LiveWorkerValues, string>> = {
  database: 'database.',
  langfuse: 'langfuse.',
  evaluator_traces: 'evaluator_traces.',
  models: 'gateway.',
  dataiku: 'dataiku.',
};
function failedChecks(section: keyof LiveWorkerValues, read: LiveWorkerRead) {
  const prefix = checkPrefixes[section];
  const verification = read.running?.verification;
  return prefix &&
    read.settings &&
    verification?.version === read.settings.version &&
    (!verification.ok || section === 'evaluator_traces')
    ? Object.entries(verification.checks).filter(([name, check]) => name.startsWith(prefix) && !check.ok)
    : [];
}
export function fieldStatus(
  section: keyof LiveWorkerValues,
  read: LiveWorkerRead,
): 'running' | 'pending' | 'failed' | 'waiting' {
  if (!read.settings) return 'waiting';
  if (failedChecks(section, read).length) return 'failed';
  if (read.running?.settings_version_applied === read.settings.version) return 'running';
  return 'pending';
}
export function failedCheckText(section: keyof LiveWorkerValues, read: LiveWorkerRead): string | null {
  return (
    failedChecks(section, read)
      .map(([name, check]) => check.error || name)
      .join('; ') || null
  );
}
export function validateDateRange(
  since_day: string,
  until_day: string,
  limit: number,
  // A day key in the source's timezone, supplied by the caller.
  today: string,
): string | null {
  if (
    !since_day ||
    !until_day ||
    !Number.isFinite(Date.parse(since_day)) ||
    !Number.isFinite(Date.parse(until_day))
  )
    return 'Choose both days';
  if (until_day < since_day) return 'The end day is before the start day';
  if ((Date.parse(until_day) - Date.parse(since_day)) / 86400000 >= 31) return 'At most 31 days per job';
  if (until_day > today) return 'The end day is in the future';
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) return 'Limit must be 1 to 2,000';
  return null;
}
export interface ProblemReportInput {
  day_key_timezone?: string;
  source: string;
  environment?: string | null;
  worker_version?: string | null;
  eval_code_version?: string | null;
  settings_version_applied?: number | null;
  event: LiveWorkerEvent;
}
export function problemReport(input: ProblemReportInput): string {
  const { event } = input;
  const zone = safeZone(input.day_key_timezone);
  return Object.entries({
    Source: input.source,
    Environment: input.environment,
    'Worker version': input.worker_version,
    'Eval code version': input.eval_code_version,
    'Settings version applied': input.settings_version_applied,
    ...(zone === 'UTC' ? {} : { [`Time (${zoneLabel(zone)})`]: zoneDateTime(event.last_at, zone, true) }),
    'Time (UTC)': event.last_at,
    Component: event.component,
    Code: event.code,
    Message: event.message,
    Details: JSON.stringify(event.details, null, 2),
  })
    .map(([key, value]) => `${key}: ${value ?? '—'}`)
    .join('\n');
}
