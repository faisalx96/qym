/**
 * Seeds runs through the public ingest API (POST /v1/runs + NDJSON events),
 * the same way frontend/scripts/seed_runs.py does. Never touches the DB.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import { createProject, uniqueSlug, type SeededProject } from '../helpers';

export interface SeedRunSpec {
  name: string;
  task: string;
  dataset: string;
  model: string;
  metrics: Record<string, { score_type: 'boolean' | 'percentage' | 'number'; direction: 'maximize' | 'minimize' }>;
  /** item scores per metric (one value per item; null = item fails) */
  items: (Record<string, number> | null)[];
  status?: 'COMPLETED' | 'FAILED' | 'STOPPED' | 'RUNNING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  samples?: number;
  gitBranch?: string;
  gitCommit?: string;
  startedAt?: Date;
  latencyMs?: number;
}

export interface SeededRun {
  id: string;
  name: string;
  spec: SeedRunSpec;
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export async function createApiKey(request: APIRequestContext, projectId: string): Promise<string> {
  const res = await request.post(`/v1/projects/${projectId}/api-keys`, { data: { name: `e2e-${Date.now()}` } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

function event(runId: string, seq: number, type: string, payload: unknown, at: Date): string {
  return JSON.stringify({
    schema_version: 1,
    event_id: uuid(),
    sequence: seq,
    sent_at: at.toISOString(),
    type,
    run_id: runId,
    payload,
  });
}

export async function seedRun(request: APIRequestContext, token: string, spec: SeedRunSpec): Promise<SeededRun> {
  const headers = { Authorization: `Bearer ${token}` };
  const metrics = Object.keys(spec.metrics);
  const samples = spec.samples ?? 1;
  const config: Record<string, unknown> = { samples, run_name: spec.name };
  if (spec.gitBranch) config.git_branch = spec.gitBranch;
  if (spec.gitCommit) config.git_commit = spec.gitCommit;
  const specs = Object.fromEntries(Object.entries(spec.metrics).map(([k, v]) => [k, { ...v, schema_version: 2 }]));
  const created = await request.post('/v1/runs', {
    headers,
    data: {
      external_run_id: spec.name,
      task: spec.task,
      dataset: spec.dataset,
      model: spec.model,
      metrics,
      metric_specs: specs,
      run_config: config,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { id?: string; run_id?: string };
  const runId = body.id ?? body.run_id!;
  const started = spec.startedAt ?? new Date(Date.now() - 60_000);
  const status = spec.status ?? 'COMPLETED';
  const running = status === 'RUNNING';
  const lines: string[] = [];
  let seq = 1;
  let t = new Date(started);
  lines.push(
    event(
      runId,
      seq,
      'run_started',
      {
        external_run_id: spec.name,
        task: spec.task,
        dataset: spec.dataset,
        model: spec.model,
        metrics,
        metric_specs: specs,
        total_items: spec.items.length,
        run_config: config,
        started_at: started.toISOString(),
      },
      t,
    ),
  );
  const doneItems = running ? Math.ceil(spec.items.length / 2) : spec.items.length;
  const latency = spec.latencyMs ?? 900;
  for (let pass = 1; pass <= samples; pass++) {
    if (running && pass > 1) break;
    const means: Record<string, number[]> = Object.fromEntries(metrics.map((m) => [m, []]));
    for (let i = 0; i < doneItems; i++) {
      const itemId = `item-${i + 1}`;
      t = new Date(t.getTime() + 1500);
      lines.push(
        event(
          runId,
          ++seq,
          'item_started',
          { item_id: itemId, index: i, pass_number: pass, input: { q: `q${i + 1}` }, expected: 'x' },
          t,
        ),
      );
      const scores = spec.items[i];
      if (!scores) {
        lines.push(
          event(
            runId,
            ++seq,
            'item_failed',
            { item_id: itemId, index: i, pass_number: pass, error: 'TimeoutError', latency_ms: latency },
            t,
          ),
        );
        continue;
      }
      for (const m of metrics) {
        const val = scores[m] ?? 0;
        means[m]!.push(val);
        lines.push(
          event(
            runId,
            ++seq,
            'metric_scored',
            { item_id: itemId, pass_number: pass, metric_name: m, score_numeric: val, meta: {} },
            t,
          ),
        );
      }
      lines.push(
        event(
          runId,
          ++seq,
          'item_completed',
          {
            item_id: itemId,
            index: i,
            pass_number: pass,
            is_final_pass: pass === samples,
            output: `a${i + 1}`,
            latency_ms: latency,
            retry_count: 0,
          },
          t,
        ),
      );
      lines.push(
        event(
          runId,
          ++seq,
          'item_attempt_finished',
          {
            item_id: itemId,
            index: i,
            pass_number: pass,
            attempt_number: 1,
            status: 'completed',
            latency_ms: latency,
            is_last_attempt: true,
          },
          t,
        ),
      );
    }
    if (samples > 1 && !running) {
      lines.push(
        event(
          runId,
          ++seq,
          'pass_completed',
          {
            pass_number: pass,
            samples,
            metrics: Object.fromEntries(
              metrics.map((m) => [m, means[m]!.length ? means[m]!.reduce((a, b) => a + b, 0) / means[m]!.length : null]),
            ),
          },
          t,
        ),
      );
    }
  }
  if (!running) {
    const final = status === 'FAILED' ? 'FAILED' : status === 'STOPPED' ? 'STOPPED' : 'COMPLETED';
    lines.push(
      event(runId, ++seq, 'run_completed', { ended_at: new Date(t.getTime() + 2000).toISOString(), final_status: final }, t),
    );
  }
  const ingested = await request.post(`/v1/runs/${runId}/events`, {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
    data: lines.join('\n') + '\n',
  });
  expect(ingested.ok(), await ingested.text()).toBeTruthy();
  if (status === 'SUBMITTED' || status === 'APPROVED' || status === 'REJECTED') {
    expect((await request.post(`/v1/runs/${runId}/submit`, { data: { comment: 'review' } })).ok()).toBeTruthy();
    if (status === 'APPROVED')
      expect((await request.post(`/v1/runs/${runId}/approve`, { data: { comment: 'ok' } })).ok()).toBeTruthy();
    if (status === 'REJECTED')
      expect((await request.post(`/v1/runs/${runId}/reject`, { data: { comment: 'no' } })).ok()).toBeTruthy();
  }
  return { id: runId, name: spec.name, spec };
}

/** Finish a RUNNING run (used by the live-status journey). */
export async function completeRun(
  request: APIRequestContext,
  token: string,
  runId: string,
  finalStatus: 'COMPLETED' | 'FAILED' | 'STOPPED' = 'COMPLETED',
): Promise<void> {
  const now = new Date();
  const res = await request.post(`/v1/runs/${runId}/events`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
    data: event(runId, 9_000, 'run_completed', { ended_at: now.toISOString(), final_status: finalStatus }, now) + '\n',
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export const SCORE = { score_type: 'percentage' as const, direction: 'maximize' as const };
export const BOOL = { score_type: 'boolean' as const, direction: 'maximize' as const };
export const LOWER = { score_type: 'number' as const, direction: 'minimize' as const };

export interface SeededProjectWithRuns {
  project: SeededProject;
  token: string;
  runs: SeededRun[];
}

/**
 * The standard fixture: 3 tasks, 2 models, mixed statuses, one RUNNING run,
 * one repeat run, two git versions. `count` runs (default 42) + 1 running.
 */
export async function seedProjectWithRuns(
  request: APIRequestContext,
  opts: { count?: number; slugPrefix?: string; running?: boolean } = {},
): Promise<SeededProjectWithRuns> {
  const count = opts.count ?? 42;
  const project = await createProject(request, 'Runs E2E', uniqueSlug(opts.slugPrefix ?? 'runs'));
  const token = await createApiKey(request, project.id);
  const tasks: Record<string, string[]> = { text2sql: ['spider-dev'], summarize: ['cnn-sample'], 'rag-qa': ['hotpot-small'] };
  const models = ['openai/gpt-4o', 'anthropic/claude-sonnet-4'];
  const statuses: SeedRunSpec['status'][] = [
    'COMPLETED', 'COMPLETED', 'COMPLETED', 'FAILED', 'COMPLETED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STOPPED', 'COMPLETED',
  ];
  const runs: SeededRun[] = [];
  for (let i = 0; i < count; i++) {
    const task = Object.keys(tasks)[i % 3]!;
    const model = models[Math.floor(i / 2) % 2]!;
    const quality = 0.4 + ((i * 7) % 10) / 16;
    const items = Array.from({ length: 6 }, (_, j) =>
      statuses[i % statuses.length] === 'FAILED' && j % 2 === 0
        ? null
        : { accuracy: j / 5 < quality ? 1 : 0, quality: Math.min(1, quality + j / 40), latency_s: 0.5 + j / 4 },
    );
    runs.push(
      await seedRun(request, token, {
        name: `${task}-${model.split('/')[1]}-${String(i).padStart(3, '0')}`,
        task,
        dataset: tasks[task]![0]!,
        model,
        metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
        items,
        status: statuses[i % statuses.length],
        samples: i === 5 ? 3 : 1,
        gitBranch: i % 3 === 2 ? undefined : 'main',
        gitCommit: i % 3 === 2 ? undefined : i % 2 ? 'a1b2c3d' : 'e4f5a6b',
        startedAt: new Date(Date.now() - (i * 1.37 * 86_400_000) % (45 * 86_400_000) - i * 60_000),
        latencyMs: 400 + (i % 7) * 300,
      }),
    );
  }
  if (opts.running !== false) {
    runs.push(
      await seedRun(request, token, {
        name: `text2sql-gpt-4o-live`,
        task: 'text2sql',
        dataset: 'spider-dev',
        model: 'openai/gpt-4o',
        metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
        items: Array.from({ length: 10 }, () => ({ accuracy: 1, quality: 0.9, latency_s: 0.7 })),
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 120_000),
      }),
    );
  }
  return { project, token, runs };
}

/** Poll until the dashboard projection lists `expected` runs for the project. */
export async function waitForProjection(
  request: APIRequestContext,
  slug: string,
  expected: number,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request.post('/api/dashboard/runs', {
      data: { project_slug: slug, filters: {}, limit: 1, offset: 0 },
    });
    if (res.ok()) {
      const body = (await res.json()) as { total_count: number; freshness?: { updating: boolean } };
      if (body.total_count >= expected && !body.freshness?.updating) return;
    }
    if (Date.now() > deadline) throw new Error(`projection did not reach ${expected} runs for ${slug}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
