/**
 * Run-detail seeding through the public API only (RunEventV1 NDJSON stream).
 * Used by the dev walkthrough (scripts/seed-run-detail.ts) and by the
 * Playwright specs. Pure fetch, no Playwright types, so Node can run it.
 *
 * Scenarios (all deterministic, seeded PRNG):
 *   classic   240 items, 4 metrics (boolean / score / lower-is-better / numeric),
 *             task errors, scorer errors, retries, 3 not-received items, traces
 *   repeat    samples=3, 60 items, 2 metrics, failed passes
 *   running   RUNNING run with 30 completed items and no run_completed
 *   locked    a small COMPLETED run that is then submitted for review
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

const ARABIC_PROMPTS = [
  'ما هي عاصمة المملكة العربية السعودية؟',
  'اشرح الفرق بين التعلم الآلي والتعلم العميق باختصار.',
  'لخص هذا النص في جملة واحدة: الذكاء الاصطناعي يغير طريقة عملنا.',
];
const DOMAINS = ['commerce', 'finance', 'support', 'analytics', 'operations'];
const COMPLEXITIES = ['easy', 'medium', 'hard', 'expert'];

export interface ClassicOptions {
  items?: number;
  taskErrors?: number;
  scorerErrors?: number;
  retries?: number;
  notReceived?: number;
  traced?: number;
  complete?: boolean;
  runName?: string;
}

const CLASSIC_SPECS = {
  exact_match: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: {
    score_type: 'percentage',
    direction: 'maximize',
    pass_threshold: 0.7,
    primary: true,
    schema_version: 2,
  },
  hallucination: { score_type: 'percentage', direction: 'minimize', pass_threshold: 0.3, schema_version: 2 },
  tokens_used: { score_type: 'count', schema_version: 2 },
};

function startedAt(i: number): string {
  return new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + i * 1500).toISOString();
}

/** Spans for one trace: AGENT root → RETRIEVER + CHAIN → LLM (+ TOOL), plus an eval-phase LLM span. */
function pushTrace(
  stream: EventStream,
  traceId: string,
  random: () => number,
  opts: { error?: boolean; big?: boolean; model?: string; latency: number },
): void {
  const base = 1_700_000_000_000_000_000 + Math.floor(random() * 1e9);
  const ms = 1_000_000;
  const total = Math.max(50, opts.latency);
  const span = (
    id: string,
    parent: string | null,
    name: string,
    kind: string,
    startMs: number,
    durMs: number,
    attrs: Record<string, unknown>,
    status = 'OK',
    events: unknown[] = [],
  ) =>
    stream.push('span_completed', {
      trace_id: traceId,
      span_id: `${traceId}-${id}`,
      parent_span_id: parent ? `${traceId}-${parent}` : null,
      name,
      kind: 'INTERNAL',
      start_time_ns: base + startMs * ms,
      end_time_ns: base + (startMs + durMs) * ms,
      duration_ms: durMs,
      status,
      attributes: attrs,
      events,
      links: [],
    });
  const model = opts.model ?? 'gpt-5-mini';
  span(
    'root',
    null,
    'answer_question',
    'AGENT',
    0,
    total,
    {
      'openinference.span.kind': 'AGENT',
      'input.value': 'user question',
      'output.value': opts.error ? '' : 'final answer',
    },
    opts.error ? 'ERROR' : 'OK',
  );
  span('ret', 'root', 'retrieve_docs', 'RETRIEVER', 2, Math.round(total * 0.2), {
    'openinference.span.kind': 'RETRIEVER',
    'input.value': 'user question',
    'retrieval.documents.0.document.content': 'Riyadh is the capital of Saudi Arabia.',
    'retrieval.documents.0.document.score': 0.91,
    'retrieval.documents.0.document.metadata': JSON.stringify({ source: 'wiki', page: 3 }),
    'retrieval.documents.1.document.content': 'Jeddah is a port city on the Red Sea.',
    'retrieval.documents.1.document.score': 0.42,
  });
  const chainStart = Math.round(total * 0.22);
  span('chain', 'root', 'RunnableSequence', 'CHAIN', chainStart, Math.round(total * 0.7), {
    'openinference.span.kind': 'CHAIN',
  });
  const llmDur = Math.round(total * 0.55);
  const inputMessages: Record<string, unknown> = {
    'llm.input_messages.0.message.role': 'system',
    'llm.input_messages.0.message.content': 'You are a careful assistant. Answer briefly.',
    'llm.input_messages.1.message.role': 'user',
    'llm.input_messages.1.message.content': opts.big
      ? 'Explain. '.repeat(4000)
      : 'What is the capital of Saudi Arabia?',
  };
  span(
    'llm',
    'chain',
    'ChatOpenAI',
    'LLM',
    chainStart + 4,
    llmDur,
    {
      'openinference.span.kind': 'LLM',
      'llm.model_name': model,
      'llm.token_count.prompt': 120 + Math.floor(random() * 200),
      'llm.token_count.completion': 40 + Math.floor(random() * 120),
      'llm.token_count.total': 300,
      'llm.cost.total': 0.0012,
      ...inputMessages,
      'llm.output_messages.0.message.role': 'assistant',
      'llm.output_messages.0.message.content': opts.error ? '' : 'The capital of Saudi Arabia is Riyadh.',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'lookup',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"q":"capital"}',
    },
    opts.error ? 'ERROR' : 'OK',
    opts.error
      ? [
          {
            name: 'exception',
            attributes: {
              'exception.type': 'RateLimitError',
              'exception.message': 'Rate limit exceeded (429)',
            },
          },
        ]
      : [],
  );
  span('tool', 'chain', 'lookup', 'TOOL', chainStart + 4 + llmDur + 2, Math.round(total * 0.1), {
    'openinference.span.kind': 'TOOL',
    'tool.name': 'lookup',
    'input.value': '{"q":"capital"}',
    'output.value': '{"answer":"Riyadh"}',
  });
  span('guard', 'root', 'pii_guard', 'GUARDRAIL', total - 8, 6, {
    'openinference.span.kind': 'GUARDRAIL',
    'output.value': 'clean',
  });
  // eval phase
  span('eval', null, 'eval_metrics', 'CHAIN', total + 5, 180, {
    'openinference.span.kind': 'CHAIN',
    'qym.usage_scope': 'metric',
  });
  span('judge', 'eval', 'judge_quality', 'LLM', total + 10, 160, {
    'openinference.span.kind': 'LLM',
    'llm.model_name': 'gpt-5',
    'llm.token_count.total': 500,
    'qym.usage_scope': 'metric',
    'llm.input_messages.0.message.role': 'user',
    'llm.input_messages.0.message.content': 'Grade the answer.',
    'llm.output_messages.0.message.role': 'assistant',
    'llm.output_messages.0.message.content': '{"score": 0.8}',
  });
}

export async function seedClassicRun(
  client: SeedClient,
  token: string,
  opts: ClassicOptions = {},
): Promise<string> {
  const n = opts.items ?? 240;
  const random = rng(42);
  const runId = await createRun(client, token, {
    task: 'rag_answer',
    dataset: 'qa-arabic-v3',
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(CLASSIC_SPECS),
    metric_specs: CLASSIC_SPECS,
    run_metadata: {
      run_name: opts.runName ?? 'classic-rag-eval',
      langfuse_url: 'https://langfuse.example/project/proj-123/traces',
      git_branch: 'main',
      git_commit: 'abc1234',
      environment: 'staging',
      prompt_version: 'v7',
    },
    run_config: { temperature: 0.2, max_tokens: 512, retriever: { top_k: 4, index: 'qa-v3' } },
    versioning_details: { prompt: 'v7', retriever_index: 'qa-v3', model_tag: '2026-09' },
  });
  const stream = new EventStream(client, token, runId, 7);
  stream.push('run_started', {
    task: 'rag_answer',
    dataset: 'qa-arabic-v3',
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(CLASSIC_SPECS),
    metric_specs: CLASSIC_SPECS,
    total_items: n,
    started_at: startedAt(0),
    run_metadata: { run_name: opts.runName ?? 'classic-rag-eval' },
    run_config: { temperature: 0.2, max_tokens: 512 },
  });
  const taskErrors = new Set<number>();
  const scorerErrors = new Set<number>();
  const retried = new Set<number>();
  const notReceived = new Set<number>();
  const traced = new Set<number>();
  for (let i = 0; i < (opts.taskErrors ?? 12); i++) taskErrors.add(7 + i * 19);
  for (let i = 0; i < (opts.scorerErrors ?? 8); i++) scorerErrors.add(11 + i * 23);
  for (let i = 0; i < (opts.retries ?? 6); i++) retried.add(5 + i * 31);
  for (let i = 0; i < (opts.notReceived ?? 3); i++) notReceived.add(n - 1 - i);
  for (let i = 0; i < (opts.traced ?? 40); i++) traced.add(i * 3);

  for (let i = 0; i < n; i++) {
    const id = `item-${String(i + 1).padStart(4, '0')}`;
    const arabic = i % 7 === 0;
    const input = arabic
      ? ARABIC_PROMPTS[i % ARABIC_PROMPTS.length]
      : `Question ${i + 1}: what does clause ${i % 13} of the ${DOMAINS[i % 5]} policy require?`;
    const domain = DOMAINS[i % 5];
    const complexity = COMPLEXITIES[Math.floor(random() * 4)];
    stream.push('item_started', {
      item_id: id,
      index: i,
      input: i % 11 === 0 ? { prompt: input, context: ['doc-a', 'doc-b'] } : input,
      expected: arabic ? 'الرياض' : `Clause ${i % 13} requires written approval.`,
      item_metadata: { domain, complexity, source: i % 2 ? 'synthetic' : 'human' },
    });
    if (notReceived.has(i)) continue;
    const latency = Math.round(300 + random() * 2500 + (complexity === 'expert' ? 1500 : 0));
    const traceId = traced.has(i) || taskErrors.has(i) || retried.has(i) ? `trace-${id}` : undefined;
    const startedMs = Date.UTC(2026, 9, 1, 12, 0, 0) + i * 1500;
    if (retried.has(i)) {
      stream.push('item_attempt_started', {
        item_id: id,
        index: i,
        attempt_number: 1,
        trace_id: `${traceId}-a1`,
        task_started_at_ms: startedMs,
      });
      pushTrace(stream, `${traceId}-a1`, random, { error: true, latency: 400 });
      stream.push('item_attempt_finished', {
        item_id: id,
        index: i,
        attempt_number: 1,
        status: 'failed',
        latency_ms: 400,
        trace_id: `${traceId}-a1`,
        error: 'RateLimitError: 429 Too Many Requests',
        is_last_attempt: false,
      });
      stream.push('item_attempt_started', {
        item_id: id,
        index: i,
        attempt_number: 2,
        trace_id: traceId,
        task_started_at_ms: startedMs + 500,
      });
    } else if (traceId) {
      stream.push('item_attempt_started', {
        item_id: id,
        index: i,
        attempt_number: 1,
        trace_id: traceId,
        task_started_at_ms: startedMs,
      });
    }
    if (traceId)
      pushTrace(stream, traceId, random, {
        error: taskErrors.has(i),
        big: i === 3,
        latency,
        model: i % 4 === 0 ? 'gpt-5' : 'gpt-5-mini',
      });
    if (taskErrors.has(i)) {
      stream.push('item_failed', {
        item_id: id,
        index: i,
        error:
          i % 2 ? 'TimeoutError: task exceeded 30s' : 'RateLimitError: 429 Too Many Requests from provider',
        latency_ms: latency,
        trace_id: traceId,
        trace_url: traceId ? `https://langfuse.example/project/proj-123/traces/${traceId}` : undefined,
        task_started_at_ms: startedMs,
        retry_count: retried.has(i) ? 1 : 0,
      });
      continue;
    }
    const quality = Math.min(
      1,
      Math.max(
        0,
        0.55 + (complexity === 'easy' ? 0.3 : complexity === 'expert' ? -0.25 : 0) + (random() - 0.5) * 0.5,
      ),
    );
    const exact = quality > 0.75 ? 1 : 0;
    const halluc = Math.max(0, Math.min(1, 1 - quality + (random() - 0.5) * 0.3));
    const tokens = 80 + Math.round(random() * 900);
    const passed = quality >= 0.7;
    const output =
      i === 3
        ? '# Long answer\n\n' + 'The capital is Riyadh. '.repeat(3000)
        : arabic
          ? 'عاصمة المملكة العربية السعودية هي الرياض.'
          : passed
            ? `Clause ${i % 13} requires written approval from the ${domain} lead.\n\n**Source:** policy handbook §${i % 13}`
            : `I am not sure about clause ${i % 13}.`;
    stream.push('metric_scored', {
      item_id: id,
      metric_name: 'exact_match',
      score_numeric: exact,
      score_raw: exact === 1,
      meta: { reason: exact ? '' : 'Expected answer not found verbatim' },
    });
    if (scorerErrors.has(i)) {
      stream.push('metric_scored', {
        item_id: id,
        metric_name: 'quality',
        score_numeric: 0,
        meta: { status: 'error', error: 'JudgeError: judge returned malformed JSON' },
      });
    } else {
      stream.push('metric_scored', {
        item_id: id,
        metric_name: 'quality',
        score_numeric: Number(quality.toFixed(3)),
        label: passed ? 'pass' : 'fail',
        explanation: passed
          ? 'The answer cites the right clause and is concise.'
          : 'The answer hedges and does not name the clause requirement.',
        meta: {
          judge_model: 'gpt-5',
          reason: passed ? '' : 'Missing the approval requirement',
          confidence: Number((0.6 + random() * 0.4).toFixed(2)),
        },
      });
    }
    stream.push('metric_scored', {
      item_id: id,
      metric_name: 'hallucination',
      score_numeric: Number(halluc.toFixed(3)),
      meta: { judge_model: 'gpt-5' },
    });
    stream.push('metric_scored', {
      item_id: id,
      metric_name: 'tokens_used',
      score_numeric: tokens,
      meta: {},
    });
    stream.push('item_completed', {
      item_id: id,
      index: i,
      output: i % 17 === 0 ? { answer: output, citations: [{ doc: 'handbook', page: i % 13 }] } : output,
      latency_ms: latency,
      trace_id: traceId,
      trace_url: traceId ? `https://langfuse.example/project/proj-123/traces/${traceId}` : undefined,
      task_started_at_ms: startedMs,
      retry_count: retried.has(i) ? 1 : 0,
      item_metadata: { domain, complexity },
    });
  }
  if (opts.complete !== false) {
    stream.push('run_completed', {
      ended_at: startedAt(n + 2),
      final_status: 'COMPLETED',
      summary: { total_items: n },
    });
  }
  await stream.flush();
  return runId;
}

export async function seedRepeatRun(
  client: SeedClient,
  token: string,
  opts: { items?: number; samples?: number } = {},
): Promise<string> {
  const n = opts.items ?? 60;
  const samples = opts.samples ?? 3;
  const random = rng(99);
  const specs = {
    correct: {
      score_type: 'boolean',
      direction: 'maximize',
      pass_threshold: 1,
      primary: true,
      schema_version: 2,
    },
    quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  };
  const runId = await createRun(client, token, {
    task: 'sql_agent',
    dataset: 'text2sql-small',
    model: 'anthropic/claude-sonnet-4',
    metrics: Object.keys(specs),
    metric_specs: specs,
    run_metadata: { run_name: 'repeat-sql-eval' },
    run_config: { samples, temperature: 0.7 },
  });
  const stream = new EventStream(client, token, runId, 3);
  stream.push('run_started', {
    task: 'sql_agent',
    dataset: 'text2sql-small',
    model: 'anthropic/claude-sonnet-4',
    metrics: Object.keys(specs),
    metric_specs: specs,
    total_items: n,
    started_at: startedAt(0),
    run_config: { samples },
  });
  for (let p = 1; p <= samples; p++) {
    for (let i = 0; i < n; i++) {
      const id = `sql-${String(i + 1).padStart(3, '0')}`;
      stream.push('item_started', {
        item_id: id,
        index: i,
        pass_number: p,
        input: `List the top ${i + 1} customers by revenue in region ${i % 4}`,
        expected: `SELECT name FROM customers WHERE region = ${i % 4} ORDER BY revenue DESC LIMIT ${i + 1}`,
        item_metadata: { domain: DOMAINS[i % 5], complexity: COMPLEXITIES[i % 4] },
      });
      const traceId = `trace-${id}-p${p}`;
      const latency = Math.round(500 + random() * 3000);
      stream.push('item_attempt_started', {
        item_id: id,
        index: i,
        pass_number: p,
        attempt_number: 1,
        trace_id: traceId,
        task_started_at_ms: Date.UTC(2026, 9, 2, 9, 0, 0) + (p * n + i) * 1000,
      });
      if (i % 3 === 0)
        pushTrace(stream, traceId, random, {
          latency,
          model: 'claude-sonnet-4',
          error: i % 17 === 0 && p === 2,
        });
      if (i % 17 === 0 && p === 2) {
        stream.push('item_failed', {
          item_id: id,
          index: i,
          pass_number: p,
          error: 'DatabaseError: relation "customers" does not exist',
          latency_ms: latency,
          trace_id: traceId,
        });
        continue;
      }
      const stable = i % 5 !== 0;
      const correct = stable ? (i % 4 === 0 ? 0 : 1) : random() > 0.5 ? 1 : 0;
      const quality = Math.min(1, Math.max(0, (correct ? 0.8 : 0.4) + (random() - 0.5) * 0.3));
      stream.push('metric_scored', {
        item_id: id,
        pass_number: p,
        metric_name: 'correct',
        score_numeric: correct,
        score_raw: correct === 1,
        meta: { reason: correct ? '' : 'Wrong ORDER BY column' },
      });
      stream.push('metric_scored', {
        item_id: id,
        pass_number: p,
        metric_name: 'quality',
        score_numeric: Number(quality.toFixed(3)),
        meta: { judge_model: 'gpt-5' },
      });
      stream.push('item_completed', {
        item_id: id,
        index: i,
        pass_number: p,
        is_final_pass: p === samples,
        output: `SELECT name FROM customers WHERE region = ${i % 4} ORDER BY ${correct ? 'revenue' : 'name'} DESC LIMIT ${i + 1}${p === 3 && !stable ? ' -- variant' : ''}`,
        latency_ms: latency,
        trace_id: traceId,
      });
    }
    stream.push('pass_completed', { pass_number: p, samples });
  }
  stream.push('run_completed', { ended_at: startedAt(n * samples + 2), final_status: 'COMPLETED' });
  await stream.flush();
  return runId;
}

/** A RUNNING run: `items` completed, no run_completed. Returns the stream so a test can push more. */
export async function seedRunningRun(
  client: SeedClient,
  token: string,
  items = 30,
): Promise<{ runId: string; stream: EventStream; next: number }> {
  const specs = {
    quality: {
      score_type: 'percentage',
      direction: 'maximize',
      pass_threshold: 0.7,
      primary: true,
      schema_version: 2,
    },
  };
  const runId = await createRun(client, token, {
    task: 'rag_answer',
    dataset: 'qa-arabic-v3',
    model: 'openai/gpt-5-mini',
    metrics: ['quality'],
    metric_specs: specs,
    run_metadata: { run_name: 'live-rag-eval' },
  });
  const stream = new EventStream(client, token, runId, 11);
  stream.push('run_started', {
    task: 'rag_answer',
    dataset: 'qa-arabic-v3',
    model: 'openai/gpt-5-mini',
    metrics: ['quality'],
    metric_specs: specs,
    total_items: 50,
    started_at: new Date().toISOString(),
  });
  for (let i = 0; i < items; i++) pushLiveItem(stream, i);
  await stream.flush();
  return { runId, stream, next: items };
}

export function pushLiveItem(stream: EventStream, i: number): void {
  const id = `live-${String(i + 1).padStart(3, '0')}`;
  stream.push('item_started', { item_id: id, index: i, input: `Live question ${i + 1}`, expected: 'yes' });
  stream.push('metric_scored', {
    item_id: id,
    metric_name: 'quality',
    score_numeric: i % 3 === 0 ? 0.4 : 0.9,
    meta: {},
  });
  stream.push('item_completed', {
    item_id: id,
    index: i,
    output: `Live answer ${i + 1}`,
    latency_ms: 400 + i * 10,
  });
}

export async function completeRun(stream: EventStream): Promise<void> {
  stream.push('run_completed', { ended_at: new Date().toISOString(), final_status: 'COMPLETED' });
  await stream.flush();
}

export async function submitRun(client: SeedClient, runId: string): Promise<void> {
  await call(client, 'POST', `/v1/runs/${encodeURIComponent(runId)}/submit`, {});
}

/** Seed every scenario into one project; idempotent per slug (new runs each call). */
export async function seedAll(client: SeedClient, slug = 'rd-seed'): Promise<SeedResult> {
  const project = await ensureProject(client, 'Run detail seed', slug);
  const token = await createApiKey(client, project.id);
  const classic = await seedClassicRun(client, token);
  const repeat = await seedRepeatRun(client, token);
  const running = await seedRunningRun(client, token);
  const locked = await seedClassicRun(client, token, {
    items: 12,
    taskErrors: 1,
    scorerErrors: 1,
    retries: 0,
    notReceived: 0,
    traced: 2,
    runName: 'locked-small',
  });
  await submitRun(client, locked);
  return {
    slug: project.slug,
    projectId: project.id,
    token,
    runs: { classic, repeat, running: running.runId, locked },
  };
}
