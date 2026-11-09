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
  dataiku: { url: string; database: string };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  };
}
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
  running: LiveWorkerValues | null;
  models: { listed_at: string; ids: string[] } | null;
  errors_last_hour: number;
  last_error: { at: string; component: string; code: string; message: string } | null;
  job: { id: string; kind: string; progress: Record<string, unknown> } | null;
}
export interface LiveWorkerVersion {
  version: number;
  created_at: string;
  created_by: string | null;
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
  kind: 'backfill_preview' | 'backfill';
  params: {
    since_day: string;
    until_day: string;
    since: string;
    until: string;
    limit: number;
    redo?: string[];
  };
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
  };
  error: string | null;
  requested_by: string | null;
  requested_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested: boolean;
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
  Record<'langfuse_secret_key' | 'dataiku_api_key' | 'database_password', string>
>;
export interface LiveWorkerRead {
  state: { desired: 'running' | 'paused'; changed_at: string | null; changed_by: string | null };
  running: LiveWorkerControl | null;
  stale: boolean;
  status: LiveSourceInfo;
  today: { day: string; turns_seen: number; evaluated: number; failed: number; in_qym: number };
  worker_key: LiveWorkerKey | null;
  api_keys: Pick<LiveWorkerKey, 'id' | 'name' | 'prefix'>[];
  settings: (LiveWorkerVersion & { values: LiveWorkerValues; secret_hints: LiveWorkerSecrets }) | null;
  versions: LiveWorkerVersion[];
  jobs: LiveJob[];
  connections: { id: string; name: string; base_url: string; api_key_last4: string }[];
  model_ids: string[];
}
export interface WorkerEventsFilters {
  component?: string;
  level?: 'error' | 'warning';
  limit?: number;
}
export interface SaveWorkerSettings {
  values: LiveWorkerValues;
  secrets?: LiveWorkerSecrets;
  note?: string;
}
export interface CreateWorkerJob {
  kind: LiveJob['kind'];
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
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, String(value));
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
    queryFn: () => api.get<{ events: LiveWorkerEvent[] }>(livePath(slug, source, '/events', filters)),
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
    dataiku: { url: '', database: '' },
    database: { host: '', port: 5432, database: '', user: '', sslmode: 'require' },
  };
}
const checkPrefixes: Partial<Record<keyof LiveWorkerValues, string>> = {
  database: 'database.',
  langfuse: 'langfuse.',
  models: 'gateway.',
  dataiku: 'dataiku.',
};
function failedChecks(section: keyof LiveWorkerValues, read: LiveWorkerRead) {
  const prefix = checkPrefixes[section];
  const verification = read.running?.verification;
  return prefix && read.settings && verification?.version === read.settings.version && !verification.ok
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
