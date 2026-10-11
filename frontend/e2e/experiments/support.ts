/// <reference lib="dom" />
/**
 * Experiments-area e2e support (TypeScript port of frontend/scripts/seed_experiments.py).
 * Everything goes through the platform API; the two stand-in Evaluation Services
 * (frontend/scripts/fake_eval_service.py) are driven through their /__control API.
 *
 * Each environment gets a unique URL `http://127.0.0.1:<port>/<unique-name>`, so specs never
 * collide on the platform's one-URL-per-project rule. The fakes are shared by all specs
 * (one process each), so every test starts with `resetFakes()`.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createProject, uniqueSlug, type SeededProject } from '../helpers';

const PLATFORM_PORT = Number(process.env.QYM_PLATFORM_PORT ?? '8800');
export const FAKE_A = PLATFORM_PORT + 100;
export const FAKE_B = PLATFORM_PORT + 101;
export const PRIMARY = 'endpoint:primary';

export { axeSeriousViolations, describeViolations } from '../shell/support';

async function control(request: APIRequestContext, port: number, path: string, data?: unknown) {
  const res = await request.post(`http://127.0.0.1:${port}/__control${path}`, { data: data ?? {} });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** Forget every job on both fakes and restore their health. */
export async function resetFakes(request: APIRequestContext): Promise<void> {
  await control(request, FAKE_A, '/reset');
  await control(request, FAKE_B, '/reset');
}

export interface FakeJob {
  id: string;
  status: string;
  priority: string;
  eval_input: {
    config?: { run_name?: string; run_metadata?: { qym_launch?: { token?: string; job_id?: string } } };
  };
}

export async function fakeJobs(request: APIRequestContext, port = FAKE_A): Promise<FakeJob[]> {
  const res = await request.get(`http://127.0.0.1:${port}/__control/jobs`);
  return (await res.json()) as FakeJob[];
}

export async function setFakeJob(
  request: APIRequestContext,
  jobId: string,
  patch: { status?: string; error?: string | null },
  port = FAKE_A,
): Promise<void> {
  await control(request, port, `/jobs/${jobId}`, patch);
}

export async function setFakeHealth(request: APIRequestContext, down: boolean, port = FAKE_A): Promise<void> {
  await control(request, port, '/health', { down });
}

// ── Project, connection, environments, presets ──────────────────────────

export interface Seeded {
  project: SeededProject;
  connectionId: string;
}

export async function seedProject(request: APIRequestContext, prefix = 'exp'): Promise<Seeded> {
  const slug = uniqueSlug(prefix);
  const project = await createProject(request, `E2E ${prefix}`, slug);
  const res = await request.post(`/v1/projects/${project.id}/llm-connections`, {
    data: {
      name: 'gpt-4o prod',
      llm_model: 'gpt-4o',
      llm_base_url: 'https://api.example.com/v1',
      llm_api_key: 'sk-test-1234567890',
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { project, connectionId: ((await res.json()) as { id: string }).id };
}

export interface SeededEnv {
  id: string;
  name: string;
  url: string;
}

interface EnvOptions {
  port?: number;
  maxPriority?: 'LOW' | 'NORMAL' | 'HIGH';
  allowKeys?: boolean;
  confirmSlots?: boolean;
}

export async function createEnvironment(
  request: APIRequestContext,
  projectId: string,
  name: string,
  opts: EnvOptions = {},
): Promise<SeededEnv> {
  const { port = FAKE_A, maxPriority = 'HIGH', allowKeys = true, confirmSlots = true } = opts;
  const url = `http://127.0.0.1:${port}/${uniqueSlug(name.replace(/\W+/g, '-').toLowerCase())}`;
  const created = await request.post(`/v1/projects/${projectId}/eval-environments`, {
    data: { name, base_url: url, api_key: 'fake-key-12345' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const env = ((await created.json()) as { environment: { id: string } }).environment;
  const base = `/v1/projects/${projectId}/eval-environments/${env.id}`;
  if (confirmSlots) {
    const slots = (await (await request.get(`${base}/model-slots`)).json()) as {
      schema_id: string;
      slots: Record<string, unknown>[];
    };
    const keys = ['slot_key', 'kind', 'label', 'field_map', 'transport_fields', 'extra_field_maps'];
    const put = await request.put(`${base}/model-slots`, {
      data: {
        schema_id: slots.schema_id,
        slots: slots.slots.map((s) => Object.fromEntries(keys.map((k) => [k, s[k]]))),
      },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
  }
  const upd = await request.put(base, {
    data: { max_priority: maxPriority, allow_connection_keys: allowKeys },
  });
  expect(upd.ok(), await upd.text()).toBeTruthy();
  return { id: env.id, name, url };
}

/** Evaluator + slot binding + timeout override, the same shape the seed script launches. */
export function experimentSpec(connectionId: string, timeout: number | { sweep: number[] } = 60) {
  return {
    evaluator: { dataset: 'golden', config: { samples: 2, report_k: 1 } },
    slot_bindings: { [PRIMARY]: { connection_id: connectionId } },
    env_overrides: { LLM_OVERRIDES: { endpoints: { primary: { timeout } } } },
  };
}

export async function publishDefaultPreset(
  request: APIRequestContext,
  projectId: string,
  envId: string,
  spec: unknown,
): Promise<void> {
  const res = await request.post(`/v1/projects/${projectId}/eval-environments/${envId}/presets`, {
    data: { kind: 'official', name: 'Default', config: spec, notes: 'Initial default' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function saveSavedPreset(
  request: APIRequestContext,
  projectId: string,
  envId: string,
  name: string,
  spec: unknown,
): Promise<void> {
  const res = await request.post(`/v1/projects/${projectId}/eval-environments/${envId}/presets`, {
    data: { kind: 'saved', name, config: spec, notes: '' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

// ── Experiments ─────────────────────────────────────────────────────────

export interface JobView {
  id: string;
  status: string;
  combo_index: number;
  attempt: number;
  superseded?: boolean;
  environment_id: string;
  run_id: string | null;
  remote_job_id?: string | null;
}
export interface ExperimentView {
  id: string;
  name: string;
  status: string;
  jobs: JobView[];
}

export async function launchExperiment(
  request: APIRequestContext,
  projectId: string,
  body: {
    name: string;
    environment_ids: string[];
    spec: unknown;
    priority?: string;
    acknowledge_preemption?: boolean;
    secrets?: Record<string, string>;
    description?: string;
  },
): Promise<ExperimentView> {
  const res = await request.post(`/v1/projects/${projectId}/experiments`, { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as ExperimentView;
}

export async function getExperiment(
  request: APIRequestContext,
  projectId: string,
  experimentId: string,
): Promise<ExperimentView> {
  const res = await request.get(`/v1/projects/${projectId}/experiments/${experimentId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as ExperimentView;
}

/** Poll the API until `ready` holds for the experiment (the dispatcher runs in the background). */
export async function waitForExperiment(
  request: APIRequestContext,
  projectId: string,
  experimentId: string,
  ready: (x: ExperimentView) => boolean,
  what = 'experiment state',
): Promise<ExperimentView> {
  let last: ExperimentView | null = null;
  await expect
    .poll(
      async () => {
        last = await getExperiment(request, projectId, experimentId);
        return ready(last);
      },
      { message: what, timeout: 25_000, intervals: [400] },
    )
    .toBe(true);
  return last as unknown as ExperimentView;
}

/** The dispatcher sends every job, so wait until all of them hold a remote job on the fake. */
export async function waitForSubmitted(
  request: APIRequestContext,
  projectId: string,
  experimentId: string,
): Promise<ExperimentView> {
  return waitForExperiment(
    request,
    projectId,
    experimentId,
    (x) => x.jobs.every((j) => ['SUBMITTED', 'RUNNING'].includes(j.status)),
    'all jobs submitted',
  );
}

/**
 * Finish a job from the outside: flip it on the fake and wait until the platform reflects it.
 * `port` is the fake that holds the job.
 */
export async function finishJob(
  request: APIRequestContext,
  projectId: string,
  experimentId: string,
  jobId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
  error: string | null = null,
  port = FAKE_A,
): Promise<ExperimentView> {
  const exp = await getExperiment(request, projectId, experimentId);
  const job = exp.jobs.find((j) => j.id === jobId)!;
  const remote = (await fakeJobs(request, port)).find(
    (f) => f.eval_input?.config?.run_metadata?.qym_launch?.job_id === job.id,
  );
  expect(remote, `fake job for ${jobId}`).toBeTruthy();
  await setFakeJob(request, remote!.id, { status, error }, port);
  const want = status;
  return waitForExperiment(
    request,
    projectId,
    experimentId,
    (x) => x.jobs.find((j) => j.id === jobId)?.status === want,
    `job ${status}`,
  );
}

// ── Runs (SDK-style ingest) ─────────────────────────────────────────────

export async function createApiKey(request: APIRequestContext, projectId: string): Promise<string> {
  const res = await request.post(`/v1/projects/${projectId}/api-keys`, { data: { name: 'e2e experiments' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

function runEvent(runId: string, type: string, payload: Record<string, unknown>, sequence: number): string {
  return JSON.stringify({
    schema_version: 1,
    event_id: crypto.randomUUID(),
    sequence,
    sent_at: new Date().toISOString(),
    type,
    run_id: runId,
    payload,
  });
}

export interface IngestRunOptions {
  name: string;
  task?: string;
  dataset?: string;
  model?: string;
  items?: number;
  /** Per-item scores of exact_match; defaults to alternating 1/0 */
  scores?: number[];
  runMetadata?: Record<string, unknown>;
  finish?: boolean;
  /** Send no external run id / run name, like a script that never named its run. */
  nameless?: boolean;
}

/** Create and complete a run through the ingest API, as the SDK would. */
export async function ingestRun(
  request: APIRequestContext,
  token: string,
  opts: IngestRunOptions,
): Promise<string> {
  const {
    name,
    task = 'qa',
    dataset = 'golden',
    model = 'model-a',
    items = 4,
    runMetadata,
    finish = true,
  } = opts;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post('/v1/runs', {
    headers,
    data: {
      external_run_id: opts.nameless ? undefined : name,
      run_name: opts.nameless ? undefined : name,
      task,
      dataset,
      model,
      metrics: ['exact_match'],
      metric_specs: { exact_match: { score_type: 'boolean', direction: 'maximize', pass_threshold: 0.5 } },
      run_metadata: runMetadata,
      run_config: {},
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const runId = ((await created.json()) as { run_id: string }).run_id;
  const events: string[] = [
    runEvent(
      runId,
      'run_started',
      {
        external_run_id: opts.nameless ? undefined : name,
        task,
        dataset,
        model,
        metrics: ['exact_match'],
        metric_specs: { exact_match: { score_type: 'boolean', direction: 'maximize', pass_threshold: 0.5 } },
        started_at: new Date().toISOString(),
        total_items: items,
      },
      1,
    ),
  ];
  let seq = 2;
  for (let i = 0; i < items; i++) {
    const itemId = `item-${i}`;
    const score = opts.scores ? opts.scores[i] : i % 2;
    events.push(runEvent(runId, 'item_started', { item_id: itemId, index: i, input: { q: `q${i}` } }, seq++));
    events.push(
      runEvent(
        runId,
        'metric_scored',
        { item_id: itemId, metric_name: 'exact_match', score_numeric: score },
        seq++,
      ),
    );
    events.push(
      runEvent(runId, 'item_completed', { item_id: itemId, output: `a${i}`, latency_ms: 10 }, seq++),
    );
  }
  if (finish) {
    events.push(
      runEvent(
        runId,
        'run_completed',
        { ended_at: new Date().toISOString(), final_status: 'COMPLETED' },
        seq++,
      ),
    );
  }
  const posted = await request.post(`/v1/runs/${runId}/events`, {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
    data: events.join('\n') + '\n',
  });
  expect(posted.ok(), await posted.text()).toBeTruthy();
  return runId;
}

/**
 * Link a finished official run to a job: read the one-time launch token the dispatcher
 * sent to the fake service and create the run with it, as a conforming worker would.
 */
export async function linkRunToJob(
  request: APIRequestContext,
  apiKey: string,
  job: JobView,
  experimentId: string,
  name: string,
  port = FAKE_A,
): Promise<string> {
  const remote = (await fakeJobs(request, port)).find(
    (f) => f.eval_input?.config?.run_metadata?.qym_launch?.job_id === job.id,
  );
  const launch = remote?.eval_input.config?.run_metadata?.qym_launch;
  expect(launch?.token, `launch token of ${job.id}`).toBeTruthy();
  return ingestRun(request, apiKey, {
    name,
    runMetadata: {
      qym_launch: {
        ...launch,
        experiment_id: experimentId,
        environment_id: job.environment_id,
        combo_index: job.combo_index,
      },
    },
  });
}

// ── UI helpers ──────────────────────────────────────────────────────────

/** No horizontal scroll on the page itself (tables scroll inside their own wrapper). */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const message = await pageOverflow(page);
  expect(message, 'horizontal page overflow').toBe('');
}

/** '' when the page fits; otherwise the overflow in px and the widest offenders. */
export async function pageOverflow(page: Page): Promise<string> {
  const info = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide: string[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0)
        wide.push(
          `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 50)} right=${Math.round(r.right)}`,
        );
    });
    return { over: document.documentElement.scrollWidth - w, wide: wide.slice(0, 6) };
  });
  return info.over > 0 ? `${info.over}px at ${new URL(page.url()).pathname}: ${info.wide.join(' | ')}` : '';
}

export const expPath = (slug: string, tail = '') => `/projects/${slug}/experiments${tail}`;

/**
 * Make an environment's queue stable: the fake goes down, then the platform's health test
 * marks the environment unhealthy, so the dispatcher holds new jobs as QUEUED ("Dispatch is
 * paused until the health check passes"). Bring the fake back with `resetFakes`.
 */
export async function pauseEnvironment(
  request: APIRequestContext,
  projectId: string,
  envId: string,
  port = FAKE_A,
): Promise<void> {
  await setFakeHealth(request, true, port);
  const res = await request.post(`/v1/projects/${projectId}/eval-environments/${envId}/test`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { ok?: boolean };
  expect(body.ok, 'environment test must fail while the fake is down').toBe(false);
}

/** The dashboard summaries are projected asynchronously: wait until the runs are visible to Models. */
export async function waitForDashboardRuns(
  request: APIRequestContext,
  slug: string,
  expected: number,
  task = 'qa',
  dataset = 'golden',
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.post('/api/dashboard/models', {
          data: { project_slug: slug, filters: { tasks: [task], datasets: [dataset] }, k: 100, selected: {} },
        });
        if (!res.ok()) return -1;
        const body = (await res.json()) as { models?: { total_runs?: number }[] };
        return (body.models ?? []).reduce((n, m) => n + (m.total_runs ?? 0), 0);
      },
      { message: 'dashboard summaries for the seeded runs', timeout: 30_000, intervals: [500] },
    )
    .toBe(expected);
}

/**
 * Stop every job of an experiment (running ones too). A live HIGH job makes the fake service
 * refuse every other priority, so tests that leave one behind must stop it before the next test.
 */
export async function stopExperiment(
  request: APIRequestContext,
  projectId: string,
  experimentId: string,
): Promise<void> {
  const res = await request.post(`/v1/projects/${projectId}/experiments/${experimentId}/cancel`, {
    data: { include_running: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}
