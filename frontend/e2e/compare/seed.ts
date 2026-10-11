/**
 * Compare seeding through the public API (RunEventV1 NDJSON stream).
 * Header helpers (rng, EventStream, createRun, ensureProject, createApiKey)
 * copied from ui/run-detail e2e/run-detail/seed.ts (commit b74a482).
 *
 * Scenarios: several runs on ONE dataset with identical item ids so they align:
 *   base / cand-a / cand-b / cand-c  single-pass runs (boolean + percentage metrics,
 *       task errors, metric (scorer) errors), different models
 *   repeat3                           samples=3 repeat run on the same dataset
 *   cohort                            helper returning two cohorts of 2 runs
 */

export interface SeedClient {
  baseUrl: string;
  /** Extra headers (none under QYM_AUTH_MODE=none). */
  headers?: Record<string, string>;
}

export interface SeedRun {
  runId: string;
  token: string;
  projectId: string;
  slug: string;
}

export interface SeedResult {
  slug: string;
  projectId: string;
  token: string;
  runs: Record<string, string>;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(random: () => number): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(random() * 4)];
    else out += hex[Math.floor(random() * 16)];
  }
  return out;
}

async function call<T>(
  client: SeedClient,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const h: Record<string, string> = { ...(client.headers ?? {}), ...headers };
  let payload: string | undefined;
  if (body !== undefined) {
    if (typeof body === 'string') payload = body;
    else {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${client.baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function ensureProject(
  client: SeedClient,
  name: string,
  slug: string,
): Promise<{ id: string; slug: string }> {
  try {
    return await call<{ id: string; slug: string }>(client, 'POST', '/v1/projects', { name, slug });
  } catch {
    return call<{ id: string; slug: string }>(
      client,
      'GET',
      `/v1/projects/by-slug/${encodeURIComponent(slug)}`,
    );
  }
}

export async function createApiKey(client: SeedClient, projectId: string): Promise<string> {
  const res = await call<{ token: string }>(client, 'POST', `/v1/projects/${projectId}/api-keys`, {
    name: 'seed',
  });
  return res.token;
}

export class EventStream {
  private seq = 0;
  private lines: string[] = [];
  private readonly random: () => number;
  private readonly client: SeedClient;
  private readonly token: string;
  readonly runId: string;
  constructor(client: SeedClient, token: string, runId: string, seed: number) {
    this.client = client;
    this.token = token;
    this.runId = runId;
    this.random = rng(seed);
  }

  push(type: string, payload: Record<string, unknown>): void {
    this.seq += 1;
    this.lines.push(
      JSON.stringify({
        schema_version: 1,
        event_id: uuid(this.random),
        sequence: this.seq,
        sent_at: new Date(Date.UTC(2026, 9, 1, 12, 0, this.seq % 60)).toISOString(),
        type,
        run_id: this.runId,
        payload,
      }),
    );
  }

  async flush(): Promise<void> {
    while (this.lines.length) {
      const batch = this.lines.splice(0, 400);
      const res = await call<{ rejected: number; rejected_events?: unknown[] }>(
        this.client,
        'POST',
        `/v1/runs/${this.runId}/events`,
        batch.join('\n') + '\n',
        { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-ndjson' },
      );
      if (res.rejected)
        throw new Error(`events rejected: ${JSON.stringify(res.rejected_events).slice(0, 800)}`);
    }
  }
}

export async function createRun(
  client: SeedClient,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await call<{ run_id: string }>(client, 'POST', '/v1/runs', body, {
    Authorization: `Bearer ${token}`,
  });
  return res.run_id;
}

const DOMAINS = ['commerce', 'finance', 'support', 'analytics'];
const COMPLEXITIES = ['easy', 'medium', 'hard'];

export const COMPARE_DATASET = 'cmp-qa-v1';
const SPECS = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: {
    score_type: 'percentage',
    direction: 'maximize',
    pass_threshold: 0.7,
    primary: true,
    schema_version: 2,
  },
};

export interface CompareRunOptions {
  name: string;
  model: string;
  /** Skill in [0,1]: probability shift for passing. */
  skill: number;
  items?: number;
  samples?: number;
  /** Item numbers (1-based) that raise a task error / a metric error. */
  taskErrors?: number[];
  metricErrors?: number[];
  seed?: number;
}

/** One run on the shared dataset; item ids are `cmp-001..` so every run aligns. */
export async function seedCompareRun(
  client: SeedClient,
  token: string,
  opts: CompareRunOptions,
): Promise<string> {
  const n = opts.items ?? 40;
  const samples = opts.samples ?? 1;
  const random = rng(opts.seed ?? 1);
  const runId = await createRun(client, token, {
    task: 'qa_task',
    dataset: COMPARE_DATASET,
    model: opts.model,
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    run_metadata: { run_name: opts.name },
    run_config: { samples, temperature: 0.2, run_name: opts.name },
  });
  const stream = new EventStream(client, token, runId, (opts.seed ?? 1) + 100);
  stream.push('run_started', {
    task: 'qa_task',
    dataset: COMPARE_DATASET,
    model: opts.model,
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    total_items: n,
    started_at: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)).toISOString(),
    run_metadata: { run_name: opts.name },
    run_config: { samples, run_name: opts.name },
  });
  const taskErrors = new Set(opts.taskErrors ?? []);
  const metricErrors = new Set(opts.metricErrors ?? []);
  for (let p = 1; p <= samples; p++) {
    for (let i = 0; i < n; i++) {
      const id = `cmp-${String(i + 1).padStart(3, '0')}`;
      const pass = samples > 1 ? { pass_number: p } : {};
      stream.push('item_started', {
        item_id: id,
        index: i,
        ...pass,
        input: `Question ${i + 1}: what does clause ${i % 9} of the ${DOMAINS[i % 4]} policy require?`,
        expected: `Clause ${i % 9} requires written approval.`,
        item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] },
      });
      const latency = Math.round(300 + random() * 1800);
      if (taskErrors.has(i + 1) && p === 1) {
        stream.push('item_failed', {
          item_id: id,
          index: i,
          ...pass,
          error: 'TimeoutError: task exceeded 30s',
          latency_ms: latency,
        });
        continue;
      }
      // Easier items pass more often; skill shifts every item.
      const base = COMPLEXITIES[i % 3] === 'easy' ? 0.25 : COMPLEXITIES[i % 3] === 'hard' ? -0.2 : 0;
      const quality = Math.min(1, Math.max(0, 0.5 + base + opts.skill + (random() - 0.5) * 0.5));
      const correct = quality > 0.7 ? 1 : 0;
      stream.push('metric_scored', {
        item_id: id,
        ...pass,
        metric_name: 'correct',
        score_numeric: correct,
        score_raw: correct === 1,
        meta: { reason: correct ? '' : 'Missing approval requirement' },
      });
      if (metricErrors.has(i + 1) && p === 1) {
        stream.push('metric_scored', {
          item_id: id,
          ...pass,
          metric_name: 'quality',
          score_numeric: 0,
          meta: { status: 'error', error: 'JudgeError: malformed JSON' },
        });
      } else {
        stream.push('metric_scored', {
          item_id: id,
          ...pass,
          metric_name: 'quality',
          score_numeric: Number(quality.toFixed(3)),
          explanation: quality > 0.7 ? 'Cites the right clause.' : 'Hedges, no clause named.',
          meta: { judge_model: 'gpt-5' },
        });
      }
      stream.push('item_completed', {
        item_id: id,
        index: i,
        ...pass,
        is_final_pass: p === samples,
        output: correct ? `Clause ${i % 9} requires written approval.` : `Not sure about clause ${i % 9}.`,
        latency_ms: latency,
        item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] },
      });
    }
    if (samples > 1) stream.push('pass_completed', { pass_number: p, samples });
  }
  stream.push('run_completed', {
    ended_at: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)).toISOString(),
    final_status: 'COMPLETED',
  });
  await stream.flush();
  return runId;
}

export interface CompareSeed {
  slug: string;
  projectId: string;
  runs: { base: string; a: string; b: string; c: string; repeat3: string; other: string };
}

/** Seeds >= 4 aligned runs, a 3-pass repeat run, and one run on a different dataset. */
export async function seedCompareScenario(client: SeedClient, slug: string): Promise<CompareSeed> {
  const project = await ensureProject(client, 'Compare demo', slug);
  const token = await createApiKey(client, project.id);
  const base = await seedCompareRun(client, token, {
    name: 'baseline-gpt-mini',
    model: 'openai/gpt-5-mini',
    skill: 0,
    seed: 1,
    taskErrors: [5, 22],
    metricErrors: [9],
  });
  const a = await seedCompareRun(client, token, {
    name: 'cand-a-sonnet',
    model: 'anthropic/claude-sonnet-4',
    skill: 0.15,
    seed: 2,
    taskErrors: [7],
    metricErrors: [9, 30],
  });
  const b = await seedCompareRun(client, token, {
    name: 'cand-b-small',
    model: 'openai/gpt-5-nano',
    skill: -0.15,
    seed: 3,
    taskErrors: [5, 6, 7],
  });
  const c = await seedCompareRun(client, token, {
    name: 'cand-c-same',
    model: 'openai/gpt-5-mini',
    skill: 0.01,
    seed: 4,
  });
  const repeat3 = await seedCompareRun(client, token, {
    name: 'repeat-3x',
    model: 'anthropic/claude-sonnet-4',
    skill: 0.1,
    samples: 3,
    seed: 5,
    metricErrors: [3],
  });
  const other = await seedCompareRun(client, token, {
    name: 'short-other',
    model: 'openai/gpt-5-mini',
    skill: 0,
    seed: 6,
    items: 10,
  });
  return { slug, projectId: project.id, runs: { base, a, b, c, repeat3, other } };
}

/* ── additive extensions used by the compare specs ── */

/** Spans for one trace (AGENT root + LLM child), copied in spirit from ui/run-detail seed pushTrace. */
export function pushCompareTrace(stream: EventStream, traceId: string): void {
  const base = 1_700_000_000_000_000_000;
  const ms = 1_000_000;
  const span = (id: string, parent: string | null, name: string, kind: string, startMs: number, durMs: number, attrs: Record<string, unknown>) =>
    stream.push('span_completed', {
      trace_id: traceId,
      span_id: `${traceId}-${id}`,
      parent_span_id: parent ? `${traceId}-${parent}` : null,
      name,
      kind: 'INTERNAL',
      start_time_ns: base + startMs * ms,
      end_time_ns: base + (startMs + durMs) * ms,
      duration_ms: durMs,
      status: 'OK',
      attributes: attrs,
      events: [],
      links: [],
    });
  span('root', null, 'answer_question', 'AGENT', 0, 400, { 'openinference.span.kind': 'AGENT', 'input.value': 'q', 'output.value': 'a' });
  span('llm', 'root', 'ChatOpenAI', 'LLM', 10, 300, {
    'openinference.span.kind': 'LLM',
    'llm.model_name': 'gpt-5-mini',
    'llm.input_messages.0.message.role': 'user',
    'llm.input_messages.0.message.content': 'What does the policy require?',
    'llm.output_messages.0.message.role': 'assistant',
    'llm.output_messages.0.message.content': 'Written approval.',
  });
}

/** A run on another dataset name / the same items (for the different-data notice). */
export async function seedCompareRunOnDataset(client: SeedClient, token: string, dataset: string, name: string, items = 10): Promise<string> {
  const SPEC = SPECS;
  const runId = await createRun(client, token, {
    task: 'qa_task',
    dataset,
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPEC),
    metric_specs: SPEC,
    run_metadata: { run_name: name },
    run_config: { samples: 1, run_name: name },
  });
  const stream = new EventStream(client, token, runId, 777);
  stream.push('run_started', {
    task: 'qa_task',
    dataset,
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPEC),
    metric_specs: SPEC,
    total_items: items,
    started_at: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)).toISOString(),
    run_metadata: { run_name: name },
    run_config: { samples: 1, run_name: name },
  });
  for (let i = 0; i < items; i++) {
    const id = `cmp-${String(i + 1).padStart(3, '0')}`;
    stream.push('item_started', { item_id: id, index: i, input: `Question ${i + 1}`, expected: 'x', item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] } });
    stream.push('metric_scored', { item_id: id, metric_name: 'correct', score_numeric: i % 2, score_raw: i % 2 === 1, meta: {} });
    stream.push('metric_scored', { item_id: id, metric_name: 'quality', score_numeric: 0.4 + (i % 5) / 10, meta: {} });
    stream.push('item_completed', { item_id: id, index: i, is_final_pass: true, output: `Answer ${i}`, latency_ms: 500, item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] } });
  }
  stream.push('run_completed', { ended_at: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)).toISOString(), final_status: 'COMPLETED' });
  await stream.flush();
  return runId;
}

/** One traced item (cmp-010) on a run: item_attempt_started + spans + trace_id on completion. */
export async function seedTracedRun(client: SeedClient, token: string, name: string): Promise<string> {
  const runId = await createRun(client, token, {
    task: 'qa_task',
    dataset: COMPARE_DATASET,
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    run_metadata: { run_name: name },
    run_config: { samples: 1, run_name: name },
  });
  const stream = new EventStream(client, token, runId, 888);
  stream.push('run_started', {
    task: 'qa_task',
    dataset: COMPARE_DATASET,
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    total_items: 12,
    started_at: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)).toISOString(),
    run_metadata: { run_name: name },
    run_config: { samples: 1, run_name: name },
  });
  for (let i = 0; i < 12; i++) {
    const id = `cmp-${String(i + 1).padStart(3, '0')}`;
    const traceId = i === 9 ? `trace-${id}` : undefined;
    stream.push('item_started', { item_id: id, index: i, input: `Question ${i + 1}`, expected: 'x', item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] } });
    if (traceId) {
      stream.push('item_attempt_started', { item_id: id, index: i, attempt_number: 1, trace_id: traceId, task_started_at_ms: 1_700_000_000_000 });
      pushCompareTrace(stream, traceId);
    }
    stream.push('metric_scored', { item_id: id, metric_name: 'correct', score_numeric: i % 2, score_raw: i % 2 === 1, meta: {} });
    stream.push('metric_scored', { item_id: id, metric_name: 'quality', score_numeric: 0.4 + (i % 5) / 10, meta: {} });
    stream.push('item_completed', { item_id: id, index: i, is_final_pass: true, output: `Answer ${i}`, latency_ms: 500, trace_id: traceId, task_started_at_ms: 1_700_000_000_000, item_metadata: { domain: DOMAINS[i % 4], complexity: COMPLEXITIES[i % 3] } });
  }
  stream.push('run_completed', { ended_at: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)).toISOString(), final_status: 'COMPLETED' });
  await stream.flush();
  return runId;
}
