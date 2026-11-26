/**
 * Performance e2e support: seeding through the page API as dev@local, and a small fake runner that
 * speaks the twelve runner routes of docs/performance-runner-protocol-v1.0.md over HTTP, exactly as a
 * real runner process would (project API key, instance header, JSON bodies, raw HTML report).
 *
 * Time: a run ends `interrupted` after 120 s without a sign of life and a runner counts as connected
 * for 30 s after its last heartbeat. Instead of waiting, `ageRunner()` moves the stored receive times
 * back (frontend/scripts/seed_performance.py `age`), which is what the backend tests do with the clock.
 */
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from '../helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..', '..');
const repo = path.resolve(frontend, '..');

export const RUNNER_KEY = 'qa-runner-1';
export const PREPROD = { name: 'QA - Preprod', base_url: 'https://preprod.qa-target.example.test' };
export const PRODUCTION = { name: 'QA - Production', base_url: 'https://production.qa-target.example.test' };
export const DATASET_NAME = 'QA - Load questions';

type Json = Record<string, unknown>;
export type Tier = 'simple' | 'medium' | 'complex';

export interface DatasetItem {
  item_id: string;
  input: string;
  expected_output: null;
  metadata: { tier: Tier; follow_up?: string };
  labels: string[];
}

/** Six questions, two of each kind, one follow-up. */
export const QUESTIONS: DatasetItem[] = (
  [
    [
      'qa_simple_rows',
      'simple',
      'How many rows does the sample table hold?',
      'And how many of them are new?',
    ],
    ['qa_simple_regions', 'simple', 'Which regions are in the sample?', undefined],
    ['qa_medium_trend', 'medium', 'How did the sample totals change between the two years?', undefined],
    ['qa_medium_share', 'medium', 'What share of the sample is in the largest group?', undefined],
    ['qa_complex_compare', 'complex', 'Compare the monthly totals of the first quarter by group.', undefined],
    ['qa_complex_rank', 'complex', 'Rank the groups by growth and explain the top three.', undefined],
  ] as const
).map(([item_id, tier, input, follow_up]) => ({
  item_id,
  input,
  expected_output: null,
  metadata: follow_up ? { tier, follow_up } : { tier },
  labels: [tier],
}));

export function pageApi(slug: string, sub = ''): string {
  return `/api/projects/${encodeURIComponent(slug)}/performance${sub}`;
}

async function okJson<T>(response: APIResponse, status = 200): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} answered ${response.status()}: ${text}`).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

// ── Page API seeding (dev@local is a platform admin under QYM_AUTH_MODE=none) ────────────────────────

export interface SeededTarget {
  id: string;
  name: string;
  base_url: string;
  is_production: boolean;
}

export async function addTarget(
  request: APIRequestContext,
  slug: string,
  body: { name: string; base_url: string; is_production?: boolean; max_users?: number | null },
): Promise<SeededTarget> {
  return okJson<SeededTarget>(
    await request.post(pageApi(slug, '/targets'), { data: { is_production: false, ...body } }),
    201,
  );
}

export async function saveToken(
  request: APIRequestContext,
  slug: string,
  targetId: string,
  name: 'refresh_token' | 'access_token',
  token: string,
): Promise<{ name: string; hint: string; version: number }> {
  return okJson(await request.put(pageApi(slug, `/targets/${targetId}/tokens/${name}`), { data: { token } }));
}

export interface SeededDataset {
  id: string;
  versionId: string;
}

/** Upload a question file through the Datasets API, published, as the upload dialog does. */
export async function uploadDataset(
  request: APIRequestContext,
  slug: string,
  name: string,
  items: DatasetItem[] = QUESTIONS,
  publish = true,
): Promise<SeededDataset> {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    project_slug: slug,
    name,
    create_only: 'true',
    format: 'jsonl',
    file: {
      name: 'questions.jsonl',
      mimeType: 'application/x-ndjson',
      buffer: Buffer.from(items.map((item) => JSON.stringify(item)).join('\n')),
    },
  };
  if (publish) multipart.publish = 'true';
  const body = await okJson<{ dataset: { id: string }; version: { id: string } }>(
    await request.post('/v1/datasets:upload', { multipart }),
  );
  return { id: body.dataset.id, versionId: body.version.id };
}

export async function chooseRunnerKey(
  request: APIRequestContext,
  slug: string,
  apiKeyId: string,
): Promise<void> {
  await okJson(await request.put(pageApi(slug, '/runner/key'), { data: { api_key_id: apiKeyId } }));
}

export async function readSetup(request: APIRequestContext, slug: string): Promise<Json> {
  return okJson<Json>(await request.get(pageApi(slug, '/setup')));
}

export async function readRun(request: APIRequestContext, slug: string, runId: string): Promise<Json> {
  return okJson<Json>(await request.get(pageApi(slug, `/runs/${runId}`)));
}

export interface StartedRun {
  id: string;
  number: number;
}

/** POST B/runs with the platform's own default plan and mix for the test type. */
export async function startRun(
  request: APIRequestContext,
  slug: string,
  body: { target_id: string; dataset_version_id: string; test_type?: 'breakpoint' | 'smoke' | 'soak' } & Json,
): Promise<StartedRun> {
  const setup = await readSetup(request, slug);
  const testType = body.test_type ?? 'breakpoint';
  const defaults = (setup.defaults as Record<string, { plan: Json; mix: Json }>)[testType]!;
  return okJson<StartedRun>(
    await request.post(pageApi(slug, '/runs'), {
      data: { test_type: testType, plan: defaults.plan, mix: defaults.mix, ...body },
    }),
    201,
  );
}

// ── The fake runner ────────────────────────────────────────────────────────────────────────────────────

export interface ControlToken {
  name: string;
  value: string;
  hint: string;
  version: number;
}

export interface ControlRun {
  id: string;
  status: string;
  stop_requested: boolean;
  stop_reason: string | null;
  config: {
    test_type: string;
    target: { id: string; name: string; base_url: string; chat_path: string };
    plan: {
      total_seconds: number;
      stages: { role: string; target_users: number; start_s: number; end_s: number }[];
    };
    dataset: { version_id: string; item_count: number };
  };
  tokens?: ControlToken[];
  tokens_withheld?: boolean;
  token_needed: string | null;
}

export interface ControlDocument {
  state: 'idle' | 'queued' | 'active' | 'stopping';
  run: ControlRun | null;
  last_run: { id: string; status: string } | null;
  limits: Record<string, number>;
}

export interface ProgressAnswer {
  id: string;
  status: string;
  accepted: boolean;
  stop_requested: boolean;
  stop_reason: string | null;
  token_needed: string | null;
  token_versions: Record<string, number>;
}

export class FakeRunner {
  readonly instance = randomUUID();
  private readonly seq = new Map<string, number>();
  private etag: string | null = null;
  private document: ControlDocument | null = null;

  constructor(
    private readonly request: APIRequestContext,
    readonly projectId: string,
    private readonly apiKey: string,
    readonly key = RUNNER_KEY,
  ) {}

  get base(): string {
    return `/v1/projects/${this.projectId}/performance/runners/${this.key}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'X-Qym-Runner-Instance': this.instance, ...extra };
  }

  private runPath(runId: string, sub: string): string {
    return `${this.base}/runs/${runId}${sub}`;
  }

  /** 3.1 PUT /runners/{key} */
  async register(info: Json = {}): Promise<Json & { tokens_disclosed: boolean; instance_id: string }> {
    const response = await this.request.put(this.base, {
      headers: this.headers(),
      data: {
        name: 'QA - Runner',
        info: {
          runner_version: 'qa-1',
          k6_version: '1.4.2',
          suite_commit: 'qa0000',
          host: 'qa-runner-host',
          location: 'QA lab',
          ...info,
        },
      },
    });
    expect([200, 201], await response.text()).toContain(response.status());
    return response.json();
  }

  /** 3.2 POST /runners/{key}/heartbeat */
  async heartbeat(state = 'idle', runId: string | null = null): Promise<void> {
    await okJson(
      await this.request.post(`${this.base}/heartbeat`, {
        headers: this.headers(),
        data: { at: new Date().toISOString(), state, run_id: runId },
      }),
      204,
    );
  }

  /** 3.3 GET /runners/{key}/control, with the last ETag; a 304 keeps the last document. */
  async control(): Promise<ControlDocument> {
    const response = await this.request.get(`${this.base}/control`, {
      headers: this.headers(this.etag ? { 'If-None-Match': this.etag } : {}),
    });
    if (response.status() === 304) {
      expect(this.document, 'a 304 before any document').not.toBeNull();
      return this.document!;
    }
    this.document = await okJson<ControlDocument>(response);
    this.etag = response.headers()['etag'] ?? null;
    return this.document;
  }

  /** Read the control document until it shows a queued run, as the idle loop does. */
  async waitForQueued(runId: string): Promise<ControlRun> {
    await expect
      .poll(async () => {
        const document = await this.control();
        return document.state === 'queued' ? document.run?.id : document.state;
      })
      .toBe(runId);
    return this.document!.run!;
  }

  /** 3.4 POST /runs/{id}/claim */
  async claim(runId: string): Promise<{ id: string; status: string; claimed_at: string }> {
    return okJson(
      await this.request.post(this.runPath(runId, '/claim'), { headers: this.headers(), data: {} }),
    );
  }

  /** 3.5 POST /runs/{id}/progress; `seq` rises by one per call. Pass `expected` for a refusal. */
  async progress(
    runId: string,
    status: string,
    progress: Json,
    extra: { error?: string | null; exit_code?: number | null; expected?: number } = {},
  ): Promise<ProgressAnswer> {
    const seq = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, seq);
    const { expected = 200, ...rest } = extra;
    return okJson<ProgressAnswer>(
      await this.request.post(this.runPath(runId, '/progress'), {
        headers: this.headers(),
        data: { seq, status, at: new Date().toISOString(), progress, error: null, exit_code: null, ...rest },
      }),
      expected,
    );
  }

  /** 3.6 POST /runs/{id}/questions */
  async questions(runId: string, records: Json[]): Promise<{ accepted: number; rejected: number }> {
    return okJson(
      await this.request.post(this.runPath(runId, '/questions'), {
        headers: this.headers(),
        data: { records },
      }),
    );
  }

  /** 3.7 POST /runs/{id}/log */
  async log(runId: string, lines: Json[]): Promise<{ accepted: number; rejected: number }> {
    return okJson(
      await this.request.post(this.runPath(runId, '/log'), { headers: this.headers(), data: { lines } }),
    );
  }

  /** 3.8 POST /runners/{key}/events */
  async events(events: Json[]): Promise<{ accepted: number }> {
    return okJson(
      await this.request.post(`${this.base}/events`, { headers: this.headers(), data: { events } }),
    );
  }

  /** 3.9 PUT /runs/{id}/summary */
  async summary(runId: string, body: Json): Promise<{ id: string; verdict: string }> {
    return okJson(
      await this.request.put(this.runPath(runId, '/summary'), { headers: this.headers(), data: body }),
    );
  }

  /** 3.10 PUT /runs/{id}/report, the raw HTML file. */
  async report(runId: string, html: string): Promise<void> {
    await okJson(
      await this.request.put(this.runPath(runId, '/report'), {
        headers: this.headers({ 'Content-Type': 'text/html; charset=utf-8' }),
        data: Buffer.from(html, 'utf-8'),
      }),
      204,
    );
  }

  /** 3.11 GET /runs/{id}/dataset-items, every page. */
  async datasetItems(runId: string): Promise<{ item_id: string; input: unknown; metadata: Json }[]> {
    const items: { item_id: string; input: unknown; metadata: Json }[] = [];
    let after: string | null = null;
    for (;;) {
      // Two per page, so the paging by `next_after` is walked as a real runner walks it.
      const query: URLSearchParams = new URLSearchParams({ limit: '2', ...(after ? { after } : {}) });
      const page: { items: typeof items; next_after: string | null; total: number } = await okJson(
        await this.request.get(this.runPath(runId, `/dataset-items?${query}`), { headers: this.headers() }),
      );
      items.push(...page.items);
      after = page.next_after;
      if (!after) {
        expect(items).toHaveLength(page.total);
        return items;
      }
    }
  }

  /** 3.12 PUT /runs/{id}/tokens/{name}: the target answered with a new refresh token. */
  async rotateToken(
    runId: string,
    value: string,
    replacesVersion: number,
  ): Promise<{ name: string; version: number; hint: string }> {
    return okJson(
      await this.request.put(this.runPath(runId, '/tokens/refresh_token'), {
        headers: this.headers(),
        data: { value, replaces_version: replacesVersion, expires_at: null },
      }),
    );
  }

  /** Claim a queued run and report it running at level 20 with question records and log lines. */
  async runToLevel20(runId: string): Promise<ControlRun> {
    const run = await this.waitForQueued(runId);
    await this.claim(runId);
    await this.heartbeat('preflight', runId);
    await this.progress(runId, 'starting', { ...progressAt(run, 'preflight'), step: 'dataset' });
    const items = await this.datasetItems(runId);
    expect(items.map((item) => item.item_id)).toEqual(QUESTIONS.map((item) => item.item_id));
    await this.progress(runId, 'running', progressAt(run));
    await this.heartbeat('running', runId);
    const questions = await this.questions(
      runId,
      items.map((item, index) =>
        questionRecord(index + 1, item, index === 3 ? { status: 'error', http_status: 502 } : {}),
      ),
    );
    expect(questions).toMatchObject({ accepted: items.length, rejected: 0 });
    const log = await this.log(runId, LOG_LINES);
    expect(log).toMatchObject({ accepted: LOG_LINES.length, rejected: 0 });
    const events = await this.events([
      {
        at: new Date().toISOString(),
        level: 'info',
        code: 'level_passed',
        message: 'Level 10 passed: p95 48.0 s, errors 0.0%',
        details: { level: 10 },
        run_id: runId,
      },
    ]);
    expect(events.accepted).toBe(1);
    return run;
  }
}

// ── Runner bodies ──────────────────────────────────────────────────────────────────────────────────────

export const LOG_LINES = [
  { seq: 1, at: new Date().toISOString(), level: 'info', message: 'runner: QA run started' },
  { seq: 2, at: new Date().toISOString(), level: 'info', message: 'stage hold  level=10  users=10' },
  {
    seq: 3,
    at: new Date().toISOString(),
    level: 'warning',
    message: 'request  level=20  user=4  status=502  12.0 s  medium  qa_medium_share',
  },
  { seq: 4, at: new Date().toISOString(), level: 'info', message: 'stage hold  level=20  users=20' },
];

function level(users: number, state: 'done' | 'running', answers: number, p95: number): Json {
  return {
    level: users,
    state,
    hold_elapsed_pct: state === 'done' ? 100 : 40,
    answers,
    errors: users === 20 ? 1 : 0,
    error_pct: users === 20 ? 5.0 : 0,
    auth_errors: 0,
    interrupted: 0,
    p50_ms: p95 / 2,
    p95_ms: p95,
    max_ms: p95 + 4000,
    ttfb_p95_ms: p95 / 3,
    per_minute: 3.2,
    quality_mean: 97.5,
    no_data_pct: 0,
    result: 'pass',
    reason: null,
  };
}

/** A progress object of guide 4.3: level 10 done, level 20 holding, 37 answers. */
export function progressAt(run: ControlRun, phase = 'hold', changes: Json = {}): Json {
  const stages = run.config.plan.stages;
  const index = stages.findIndex((stage) => stage.role === 'hold' && stage.target_users === 20);
  const stage = stages[index]!;
  return {
    phase,
    step: null,
    elapsed_s: phase === 'preflight' ? 0 : stage.start_s + 120,
    planned_s: run.config.plan.total_seconds,
    stage: phase === 'preflight' ? null : { index: index + 1, of: stages.length, ...stage },
    level: phase === 'preflight' ? null : 20,
    users: phase === 'preflight' ? 0 : 20,
    users_max: Math.max(...stages.map((item) => item.target_users)),
    answers: {
      sent: 41,
      finished: 37,
      ok: 36,
      errors: 1,
      interrupted: 0,
      in_flight: 4,
      oldest_in_flight_s: 12.5,
      follow_ups: 5,
      warmup: 2,
    },
    errors_by_kind: { auth: 0, rate_limit: 0, server: 1, network: 0, run_failed: 0, other: 0 },
    p95_ms: 52000,
    ttfb_p95_ms: 17000,
    quality_mean: 97.5,
    no_data_pct: 0,
    levels: phase === 'preflight' ? [] : [level(10, 'done', 24, 48000), level(20, 'running', 13, 56000)],
    auth: {
      state: 'ok',
      token_versions: { refresh_token: 1, access_token: 1 },
      refresh_ok: 4,
      refresh_failed: 0,
      users_rejected: 0,
      users_recovered: 0,
      rejected_at: null,
      recovered_at: null,
    },
    waiting_for_token: null,
    dropped: { questions: 0, log_lines: 0 },
    ...changes,
  };
}

/** A question record of guide 4.4. */
export function questionRecord(
  seq: number,
  item: { item_id: string; input: unknown; metadata: Json },
  changes: Json = {},
): Json {
  const failed = changes.status === 'error';
  return {
    seq,
    asked_at: new Date().toISOString(),
    elapsed_s: 100 + seq,
    stage: 'hold',
    level: seq <= 3 ? 10 : 20,
    user: seq,
    tier: item.metadata.tier,
    question_id: item.item_id,
    is_followup: false,
    question: String(item.input),
    status: 'ok',
    http_status: 200,
    error_kind: failed ? 'server' : null,
    duration_ms: 40000 + seq * 1000,
    ttfb_ms: 12000,
    quality: failed ? null : 100,
    no_data: false,
    warmup: false,
    attempts: 1,
    answer: failed ? null : `QA answer ${seq}`,
    answer_truncated: false,
    ...changes,
  };
}

/** What the runner measured on the two levels it reached: 10 passes, 20 breaks the time limit 40% into its hold.
 * The figures follow the demo seed (frontend/scripts/seed_performance.py); by_tier is [answers, avg_ms, p95_ms]. */
const MEASURED: Record<number, Json & { answers: number; by_tier: Record<string, [number, number, number]> }> = {
  10: {
    hold_elapsed_pct: 100,
    answers: 24,
    interrupted: 0,
    follow_ups: 4,
    p50_ms: 21000,
    p90_ms: 41000,
    p95_ms: 48000,
    p99_ms: 57000,
    avg_ms: 24500,
    min_ms: 9100,
    max_ms: 60000,
    ttfb_p50_ms: 9800,
    ttfb_p95_ms: 15000,
    error_pct: 0,
    result: 'pass',
    passed: true,
    latency_breach: false,
    by_tier: { simple: [12, 15800, 26000], medium: [8, 27400, 41000], complex: [4, 44100, 57000] },
  },
  20: {
    hold_elapsed_pct: 40,
    answers: 13,
    interrupted: 2,
    follow_ups: 2,
    p50_ms: 61000,
    p90_ms: 171000,
    p95_ms: 196000,
    p99_ms: 214000,
    avg_ms: 82300,
    min_ms: 12400,
    max_ms: 221000,
    ttfb_p50_ms: 18400,
    ttfb_p95_ms: 31000,
    error_pct: 0,
    result: 'break',
    passed: false,
    latency_breach: true,
    by_tier: { simple: [7, 39800, 71000], medium: [4, 88400, 142000], complex: [2, 171500, 214000] },
  },
};

/** One entry of a Breakpoint result's `levels` (guide 4.7) with every field the runner sends, for every planned
 * level; a level never reached has no data, as the runner reports it. */
function summaryLevel(stage: { target_users: number; start_s: number; end_s: number }): Json {
  const level = stage.target_users;
  const hold = { level, hold_start_s: stage.start_s, hold_end_s: stage.end_s };
  const measured = MEASURED[level];
  if (!measured) {
    return {
      ...hold,
      answers: 0,
      interrupted: 0,
      p50_ms: null,
      p90_ms: 0,
      p95_ms: 0,
      p99_ms: null,
      avg_ms: 0,
      min_ms: null,
      max_ms: 0,
      ttfb_p50_ms: null,
      ttfb_p95_ms: null,
      error_pct: 0,
      no_data_pct: null,
      auth_error_pct: null,
      auth_contaminated: false,
      quality_mean: 0,
      follow_ups: 0,
      per_minute: 0,
      by_tier: Object.fromEntries(
        ['simple', 'medium', 'complex'].map((tier) => [tier, { answers: null, avg_ms: null, p95_ms: null }]),
      ),
      passed: false,
      latency_breach: false,
      error_breach: false,
      has_data: false,
      result: 'no_data',
      hold_elapsed_pct: 0,
    };
  }
  const { by_tier, ...figures } = measured;
  return {
    ...hold,
    ...figures,
    no_data_pct: 0,
    auth_error_pct: 0,
    auth_contaminated: false,
    quality_mean: 98,
    per_minute: Math.round((measured.answers / ((stage.end_s - stage.start_s) / 60)) * 10) / 10,
    by_tier: Object.fromEntries(
      Object.entries(by_tier).map(([tier, [answers, avg_ms, p95_ms]]) => [tier, { answers, avg_ms, p95_ms }]),
    ),
    error_breach: false,
    has_data: true,
  };
}

/** A Breakpoint summary of guide 4.7: breaks at 20 users, safe load 10; one level entry per planned level. */
export function breakpointSummary(run: ControlRun, changes: Json = {}): Json {
  const now = new Date().toISOString();
  return {
    schema: 1,
    test_type: 'breakpoint',
    verdict: 'breakpoint_found',
    verdict_reason: null,
    ended_by: 'auto_stop',
    exit_code: 99,
    started_at: now,
    ended_at: now,
    target_url: `${run.config.target.base_url}${run.config.target.chat_path}`,
    headline: {
      safe_load_users: 10,
      breaking_level_users: 20,
      breaking_reason: 'latency',
      recommended_max_users: 8,
      p95_at_safe_load_ms: 48000,
      answers_measured: 37,
      duration_s: 900,
      p95_ms: 190000,
      answers_total: 41,
      errors_total: 1,
      error_rate_pct: 2.44,
      ttfb_p95_ms: 17000,
      max_users: 20,
      quality_mean: 97.5,
    },
    thresholds: [
      {
        scope: 'run',
        metric: 'llm_response_duration',
        expression: 'p(95)<180000',
        measured: 190000,
        ok: false,
      },
    ],
    levels: run.config.plan.stages.filter((stage) => stage.role === 'hold').map(summaryLevel),
    ...changes,
  };
}

// ── One call that sets up a project the way a person would ────────────────────────────────────────────

export interface PerformanceSeed {
  projectId: string;
  projectSlug: string;
  apiKey: string;
  apiKeyId: string;
  runner: FakeRunner;
  preprod: SeededTarget;
  production: SeededTarget | null;
  dataset: SeededDataset;
}

/**
 * A project with a chosen runner key, a connected fake runner, the preprod target with both tokens
 * saved, and a published dataset. `production` adds a production target with tokens; `signIn: false`
 * leaves the preprod sign-in empty; `runner: false` registers no runner.
 */
export async function seedPerformance(
  request: APIRequestContext,
  slug: string,
  opts: { production?: boolean; signIn?: boolean; runner?: boolean; dataset?: boolean } = {},
): Promise<PerformanceSeed> {
  const project = await createProject(request, 'QA - Performance', slug);
  const key = await okJson<{ id: string; token: string }>(
    await request.post(`/v1/projects/${project.id}/api-keys`, { data: { name: 'QA - Runner key' } }),
  );
  await chooseRunnerKey(request, project.slug, key.id);
  const runner = new FakeRunner(request, project.id, key.token);
  if (opts.runner !== false) {
    const registered = await runner.register();
    expect(registered.tokens_disclosed).toBe(true);
    await runner.heartbeat();
  }
  const preprod = await addTarget(request, project.slug, PREPROD);
  if (opts.signIn !== false) {
    await saveToken(request, project.slug, preprod.id, 'access_token', 'qa-access-token-a1b2');
    await saveToken(request, project.slug, preprod.id, 'refresh_token', 'qa-refresh-token-c3d4');
  }
  let production: SeededTarget | null = null;
  if (opts.production) {
    production = await addTarget(request, project.slug, { ...PRODUCTION, is_production: true });
    await saveToken(request, project.slug, production.id, 'refresh_token', 'qa-prod-refresh-e5f6');
  }
  const dataset =
    opts.dataset === false
      ? { id: '', versionId: '' }
      : await uploadDataset(request, project.slug, DATASET_NAME);
  return {
    projectId: project.id,
    projectSlug: project.slug,
    apiKey: key.token,
    apiKeyId: key.id,
    runner,
    preprod,
    production,
    dataset,
  };
}

// ── Time control and roles ─────────────────────────────────────────────────────────────────────────────

function databaseFile(): string {
  return process.env.QYM_E2E_DB ?? path.join(frontend, '.qym-e2e.db');
}

function python(): string {
  const venv = path.join(repo, '.venv', 'bin', 'python');
  return process.env.QYM_PYTHON ?? (fs.existsSync(venv) ? venv : 'python');
}

/**
 * Move every stored receive time of the project's runner and of its runs back by `seconds`: the same
 * as that much time passing without a word from the runner.
 */
export function ageRunner(projectId: string, seconds: number): void {
  execFileSync(
    python(),
    [
      path.join(frontend, 'scripts', 'seed_performance.py'),
      'age',
      '--database-url',
      `sqlite:///${databaseFile()}`,
      '--project-id',
      projectId,
      '--seconds',
      String(seconds),
    ],
    { cwd: repo, env: { ...process.env, PYTHONPATH: 'packages/sdk:packages/platform' }, stdio: 'pipe' },
  );
}

/**
 * The page reads the person's project role from GET /v1/me; answer it with another role, as the
 * shell's access specs do. The platform still treats the caller as dev@local.
 */
export async function actAs(page: Page, role: 'MEMBER' | 'MANAGER' | 'VIEWER'): Promise<void> {
  await page.route(/\/v1\/me$/, async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as { role: string; projects: { role: string }[] };
    me.role = 'MEMBER';
    me.projects = me.projects.map((project) => ({ ...project, role }));
    await route.fulfill({ response, json: me });
  });
}

/**
 * A Member's view. Under QYM_AUTH_MODE=none the platform answers every read as for dev@local, a
 * platform admin, so the role flags of the area's reads are set to what the API gives a Member
 * (services/performance_views.py `setup`, services/performance_targets.py `target_payloads`,
 * api/performance.py `GET B/targets`): no target management, no start or sign-in on production.
 * The server's own refusal of a Member is covered by tests/platform/test_performance_api.py.
 */
export async function asMember(page: Page): Promise<void> {
  await actAs(page, 'MEMBER');
  await page.route(/\/api\/projects\/[^/]+\/performance\/(setup|targets)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as Json & { targets?: Json[] };
    if ('can_manage_targets' in body) body.can_manage_targets = false;
    if ('can_manage' in body) body.can_manage = false;
    body.targets = (body.targets ?? []).map((target) =>
      target.is_production ? { ...target, can_start: false, can_save_tokens: false } : target,
    );
    await route.fulfill({ response, json: body });
  });
}

/** Watch the page's writes under the area, to prove a role sends none. */
export function performanceWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' && url.pathname.includes('/performance')) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return writes;
}
