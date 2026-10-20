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
  metrics: Record<
    string,
    { score_type: 'boolean' | 'percentage' | 'number'; direction: 'maximize' | 'minimize' }
  >;
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
  const res = await request.post(`/v1/projects/${projectId}/api-keys`, {
    data: { name: `e2e-${Date.now()}` },
  });
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

export async function seedRun(
  request: APIRequestContext,
  token: string,
  spec: SeedRunSpec,
): Promise<SeededRun> {
  const headers = { Authorization: `Bearer ${token}` };
  const metrics = Object.keys(spec.metrics);
  const samples = spec.samples ?? 1;
  const config: Record<string, unknown> = { samples, run_name: spec.name };
  if (spec.gitBranch) config.git_branch = spec.gitBranch;
  if (spec.gitCommit) config.git_commit = spec.gitCommit;
  const specs = Object.fromEntries(
    Object.entries(spec.metrics).map(([k, v]) => [k, { ...v, schema_version: 2 }]),
  );
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
              metrics.map((m) => [
                m,
                means[m]!.length ? means[m]!.reduce((a, b) => a + b, 0) / means[m]!.length : null,
              ]),
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
      event(
        runId,
        ++seq,
        'run_completed',
        { ended_at: new Date(t.getTime() + 2000).toISOString(), final_status: final },
        t,
      ),
    );
  }
  const ingested = await request.post(`/v1/runs/${runId}/events`, {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
    data: lines.join('\n') + '\n',
  });
  expect(ingested.ok(), await ingested.text()).toBeTruthy();
  if (status === 'SUBMITTED' || status === 'APPROVED' || status === 'REJECTED') {
    expect(
      (await request.post(`/v1/runs/${runId}/submit`, { data: { comment: 'review' } })).ok(),
    ).toBeTruthy();
    if (status === 'APPROVED')
      expect(
        (await request.post(`/v1/runs/${runId}/approve`, { data: { comment: 'ok' } })).ok(),
      ).toBeTruthy();
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
    data:
      event(runId, 9_000, 'run_completed', { ended_at: now.toISOString(), final_status: finalStatus }, now) +
      '\n',
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
  const tasks: Record<string, string[]> = {
    text2sql: ['spider-dev'],
    summarize: ['cnn-sample'],
    'rag-qa': ['hotpot-small'],
  };
  const models = ['openai/gpt-4o', 'anthropic/claude-sonnet-4'];
  const statuses: SeedRunSpec['status'][] = [
    'COMPLETED',
    'COMPLETED',
    'COMPLETED',
    'FAILED',
    'COMPLETED',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'STOPPED',
    'COMPLETED',
  ];
  const runs: SeededRun[] = [];
  for (let i = 0; i < count; i++) {
    const task = Object.keys(tasks)[i % 3]!;
    const model = models[Math.floor(i / 2) % 2]!;
    const quality = 0.4 + ((i * 7) % 10) / 16;
    const items = Array.from({ length: 6 }, (_, j) =>
      statuses[i % statuses.length] === 'FAILED' && j % 2 === 0
        ? null
        : {
            accuracy: j / 5 < quality ? 1 : 0,
            quality: Math.min(1, quality + j / 40),
            latency_s: 0.5 + j / 4,
          },
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
        startedAt: new Date(Date.now() - ((i * 1.37 * 86_400_000) % (45 * 86_400_000)) - i * 60_000),
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

// ---- Round 7 (docs/internal/ui-migration/redesign7/qa.md): repeat runs with several passes --------------------------

export interface SeededR7 {
  project: SeededProject;
  token: string;
  /** Repeat runs of `passes` passes x `items` items, newest first on the runs page. */
  repeat: Array<{ id: string; name: string }>;
  /** A run with 19 passes (more placeholder rows than the old cap of 10), when asked for. */
  passes19?: { id: string; name: string };
  /** One 10-pass run with `big` items (the 10 x 1,200 case of Q2-5), when asked for. */
  big?: { id: string; name: string };
  classic: Array<{ id: string; name: string }>;
  /** Everything on the page, newest first. */
  all: Array<{ id: string; name: string }>;
}

const R7_SPECS = {
  correct: {
    score_type: 'boolean',
    direction: 'maximize',
    pass_threshold: 1,
    primary: true,
    schema_version: 2,
  },
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  faithfulness: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
};

/** A repeat run (`passes` passes x `items` items, per-pass variation) through the ingest API. */
async function seedR7Repeat(
  request: APIRequestContext,
  token: string,
  name: string,
  passes: number,
  items: number,
  startedAt: Date,
): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const metrics = Object.keys(R7_SPECS);
  const created = await request.post('/v1/runs', {
    headers,
    data: {
      external_run_id: name,
      task: 'sql_agent',
      dataset: `r7-${items}`,
      model: 'openai/gpt-5-mini',
      metrics,
      metric_specs: R7_SPECS,
      run_metadata: { run_name: name },
      run_config: { samples: passes, run_name: name },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { id?: string; run_id?: string };
  const runId = body.id ?? body.run_id!;
  const lines: string[] = [];
  let seq = 0;
  const push = (type: string, payload: unknown) => {
    seq += 1;
    lines.push(event(runId, seq, type, payload, new Date(startedAt.getTime() + seq * 5)));
  };
  push('run_started', {
    task: 'sql_agent',
    dataset: `r7-${items}`,
    model: 'openai/gpt-5-mini',
    metrics,
    metric_specs: R7_SPECS,
    total_items: items,
    started_at: startedAt.toISOString(),
    run_metadata: { run_name: name },
    run_config: { samples: passes, run_name: name },
  });
  for (let p = 1; p <= passes; p++) {
    for (let i = 0; i < items; i++) {
      const id = `q-${String(i + 1).padStart(3, '0')}`;
      push('item_started', {
        item_id: id,
        index: i,
        pass_number: p,
        input: `Question ${i + 1}`,
        expected: 'x',
      });
      // stable items repeat their verdict, the rest flip by pass: a spread of Reliability / Pass@k values
      const stable = i % 4 !== 0;
      const correct = stable ? (i % 3 === 0 ? 0 : 1) : (i + p) % 2;
      const q = Math.min(1, Math.max(0, (correct ? 0.82 : 0.42) + (((i * 7 + p * 3) % 10) - 5) / 50));
      push('metric_scored', {
        item_id: id,
        pass_number: p,
        metric_name: 'correct',
        score_numeric: correct,
        score_raw: correct === 1,
        meta: {},
      });
      push('metric_scored', {
        item_id: id,
        pass_number: p,
        metric_name: 'quality',
        score_numeric: Number(q.toFixed(3)),
        meta: {},
      });
      push('metric_scored', {
        item_id: id,
        pass_number: p,
        metric_name: 'faithfulness',
        score_numeric: Number(Math.min(1, q + 0.05).toFixed(3)),
        meta: {},
      });
      push('item_completed', {
        item_id: id,
        index: i,
        pass_number: p,
        is_final_pass: p === passes,
        output: `answer ${i + 1}`,
        latency_ms: 400 + ((i * 37 + p * 11) % 900),
      });
    }
    push('pass_completed', { pass_number: p, samples: passes });
  }
  push('run_completed', {
    ended_at: new Date(startedAt.getTime() + 600_000).toISOString(),
    final_status: 'COMPLETED',
  });
  for (let at = 0; at < lines.length; at += 1500) {
    const res = await request.post(`/v1/runs/${runId}/events`, {
      headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
      data: lines.slice(at, at + 1500).join('\n') + '\n',
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return runId;
}

/**
 * The round 7 runs page: `repeat` runs of 10 passes x `items` items, optionally one 19-pass run, and `classic` plain
 * runs. A scaled-down copy of docs/internal/ui-migration/redesign7/seed-r7.mts (which seeds the 50-run measurement page).
 */
export async function seedR7(
  request: APIRequestContext,
  opts: {
    repeat?: number;
    items?: number;
    passes19?: boolean;
    big?: number;
    classic?: number;
    slugPrefix?: string;
  } = {},
): Promise<SeededR7> {
  const nRepeat = opts.repeat ?? 3;
  const items = opts.items ?? 24;
  const project = await createProject(request, 'R7 E2E', uniqueSlug(opts.slugPrefix ?? 'r7'));
  const token = await createApiKey(request, project.id);
  const base = Date.now() - 3_600_000;
  let clock = 0;
  const started = () => new Date(base - clock++ * 60_000);
  const repeat: SeededR7['repeat'] = [];
  for (let r = 0; r < nRepeat; r++) {
    const name = `r7-repeat-${String(r + 1).padStart(2, '0')}`;
    repeat.push({ id: await seedR7Repeat(request, token, name, 10, items, started()), name });
  }
  let passes19: SeededR7['passes19'];
  if (opts.passes19) {
    const name = 'r7-passes19';
    passes19 = { id: await seedR7Repeat(request, token, name, 19, 8, started()), name };
  }
  let big: SeededR7['big'];
  if (opts.big) {
    const name = `r7-big-${opts.big}`;
    big = { id: await seedR7Repeat(request, token, name, 10, opts.big, started()), name };
  }
  const classic: SeededR7['classic'] = [];
  for (let c = 0; c < (opts.classic ?? 3); c++) {
    const name = `r7-classic-${c + 1}`;
    const run = await seedRun(request, token, {
      name,
      task: 'text2sql',
      dataset: 'spider-dev',
      model: 'openai/gpt-4o',
      metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
      items: Array.from({ length: 6 }, (_, j) => ({
        accuracy: j % 2,
        quality: 0.5 + j / 20,
        latency_s: 0.5,
      })),
      startedAt: started(),
    });
    classic.push({ id: run.id, name });
  }
  const all = [...repeat, ...(passes19 ? [passes19] : []), ...(big ? [big] : []), ...classic];
  await waitForProjection(request, project.slug, all.length);
  return { project, token, repeat, passes19, big, classic, all };
}
