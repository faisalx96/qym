/// <reference lib="dom" />
/**
 * Analyzer e2e seeding: project + API key + LLM connection (pointing at the
 * local stub server, see scripts/stub_llm.py) + runs with failing metrics, all
 * through the public API with the Playwright `request` fixture.
 */
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';
import { createProject, uniqueSlug, type SeededProject } from '../helpers';

export const PLATFORM_PORT = Number(process.env.QYM_PLATFORM_PORT ?? '8800');
export const STUB_URL = `http://127.0.0.1:${PLATFORM_PORT + 1000}/v1`;

const METRIC_SPECS: Record<string, unknown> = {
  exact_match: { direction: 'maximize', score_type: 'boolean', schema_version: 2 },
  execution_accuracy: { direction: 'maximize', score_type: 'percentage', schema_version: 2 },
};

export interface SeedItem {
  input: unknown;
  expected: unknown;
  output: unknown;
  /** Scores per metric; or per sample (index 0 = sample 1) for repeat runs. */
  scores: Record<string, number> | Array<Record<string, number>>;
}

export interface RunSpec {
  name: string;
  task?: string;
  samples?: number;
  items: SeedItem[];
}

const nd = (type: string, runId: string, seq: number, payload: unknown) =>
  JSON.stringify({
    schema_version: 1,
    event_id: randomUUID(),
    sequence: seq,
    sent_at: new Date(Date.now() - 60_000 + seq * 50).toISOString(),
    type,
    run_id: runId,
    payload,
  });

/** Push one finished run (metrics exact_match + execution_accuracy). */
export async function pushRun(request: APIRequestContext, token: string, spec: RunSpec): Promise<string> {
  const metrics = ['exact_match', 'execution_accuracy'];
  const samples = spec.samples ?? 1;
  const task = spec.task ?? 'text2sql';
  const metricSpecs = Object.fromEntries(metrics.map((m) => [m, METRIC_SPECS[m]]));
  const config = { samples, run_name: spec.name, max_concurrency: 2 };
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post('/v1/runs', {
    headers,
    data: {
      external_run_id: spec.name,
      task,
      dataset: 'spider-dev',
      model: 'openai/gpt-4o',
      metrics,
      metric_specs: metricSpecs,
      run_config: config,
      run_metadata: {},
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { id?: string; run_id?: string };
  const runId = (body.id ?? body.run_id) as string;
  const started = new Date(Date.now() - 120_000).toISOString();
  const lines: string[] = [];
  let seq = 1;
  lines.push(
    nd('run_started', runId, seq, {
      external_run_id: spec.name,
      task,
      dataset: 'spider-dev',
      model: 'openai/gpt-4o',
      metrics,
      metric_specs: metricSpecs,
      total_items: spec.items.length,
      run_config: config,
      started_at: started,
    }),
  );
  for (let pass = 1; pass <= samples; pass += 1) {
    spec.items.forEach((item, i) => {
      const itemId = `item-${i + 1}`;
      const scores = Array.isArray(item.scores) ? (item.scores[pass - 1] ?? item.scores[0]) : item.scores;
      seq += 1;
      lines.push(
        nd('item_started', runId, seq, { item_id: itemId, index: i, pass_number: pass, input: item.input, expected: item.expected }),
      );
      for (const m of metrics) {
        seq += 1;
        lines.push(
          nd('metric_scored', runId, seq, {
            item_id: itemId,
            pass_number: pass,
            metric_name: m,
            score_numeric: scores?.[m] ?? 1,
            meta: { verdict: (scores?.[m] ?? 1) >= 0.5 ? 'correct' : 'incorrect', detail: { reason: 'seeded', rows: 3 } },
          }),
        );
      }
      seq += 1;
      lines.push(
        nd('item_completed', runId, seq, {
          item_id: itemId,
          index: i,
          pass_number: pass,
          is_final_pass: pass === samples,
          output: item.output,
          latency_ms: 900,
          retry_count: 0,
          task_metadata: {},
        }),
      );
      seq += 1;
      lines.push(
        nd('item_attempt_finished', runId, seq, {
          item_id: itemId,
          index: i,
          pass_number: pass,
          attempt_number: 1,
          status: 'completed',
          latency_ms: 900,
          is_last_attempt: true,
        }),
      );
    });
    if (samples > 1) {
      seq += 1;
      const avg = Object.fromEntries(
        metrics.map((m) => [
          m,
          spec.items.reduce((n, it) => {
            const sc = Array.isArray(it.scores) ? (it.scores[pass - 1] ?? it.scores[0]) : it.scores;
            return n + (sc?.[m] ?? 1);
          }, 0) / spec.items.length,
        ]),
      );
      lines.push(nd('pass_completed', runId, seq, { pass_number: pass, samples, metrics: avg }));
    }
  }
  seq += 1;
  lines.push(nd('run_completed', runId, seq, { ended_at: new Date().toISOString(), final_status: 'COMPLETED' }));
  const res = await request.post(`/v1/runs/${runId}/events`, {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
    data: lines.join('\n') + '\n',
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return runId;
}

/** Six text2sql items; items 1-4 fail exact_match, items 1-2 also fail execution_accuracy; inputs are nested JSON. */
export function failingItems(prefix = 'q'): SeedItem[] {
  return Array.from({ length: 6 }, (_, i) => ({
    input: {
      question: `${prefix} ${i + 1}: list orders over ${i * 10}`,
      db: { name: 'sales', dialect: 'sqlite', tables: ['orders', 'customers'] },
      hints: { level: i, tags: ['join', 'filter'] },
    },
    expected: `SELECT * FROM orders WHERE total > ${i * 10}`,
    output: `SELECT id FROM orders WHERE total >= ${i * 10}`,
    scores: { exact_match: i < 4 ? 0 : 1, execution_accuracy: i < 2 ? 0.2 : 1 },
  }));
}

export interface SeedOptions {
  /** LLM model of the project connection ("slow-model" sleeps 5 s, "bad-model" returns 500, "" = no connection). */
  model?: string;
  slugPrefix?: string;
  withRepeat?: boolean;
  withArabic?: boolean;
}

export interface Seeded {
  project: SeededProject;
  slug: string;
  token: string;
  /** single-sample run with 4 failing items. */
  runId: string;
  /** samples=2 run (when withRepeat). */
  repeatId?: string;
  /** run whose inputs are plain Arabic strings (when withArabic). */
  arabicId?: string;
  connectionId?: string;
}

export async function createLlmConnection(
  request: APIRequestContext,
  projectId: string,
  model = 'stub-model',
  name = `stub-${model}`,
): Promise<string> {
  const res = await request.post(`/v1/projects/${projectId}/llm-connections`, {
    data: { name, llm_base_url: STUB_URL, llm_model: model, llm_api_key: 'sk-dummy' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

export async function seedAnalyzer(request: APIRequestContext, opts: SeedOptions = {}): Promise<Seeded> {
  const slug = uniqueSlug(opts.slugPrefix ?? 'an');
  const project = await createProject(request, `Analyzer ${slug}`, slug);
  const key = await request.post(`/v1/projects/${project.id}/api-keys`, { data: { name: 'e2e' } });
  expect(key.ok(), await key.text()).toBeTruthy();
  const token = ((await key.json()) as { token: string }).token;
  const model = opts.model ?? 'stub-model';
  const connectionId = model ? await createLlmConnection(request, project.id, model) : undefined;
  const runId = await pushRun(request, token, { name: `single-${slug}`, items: failingItems() });
  const out: Seeded = { project, slug, token, runId, connectionId };
  if (opts.withRepeat) {
    out.repeatId = await pushRun(request, token, {
      name: `repeat-${slug}`,
      samples: 2,
      items: failingItems('r').slice(0, 4).map((it) => ({ ...it, scores: [{ exact_match: 0, execution_accuracy: 0.2 }, { exact_match: 0, execution_accuracy: 0.3 }] })),
    });
  }
  if (opts.withArabic) {
    out.arabicId = await pushRun(request, token, {
      name: `arabic-${slug}`,
      items: ['اعرض جميع الطلبات التي تزيد قيمتها عن مائة', 'ما هو عدد العملاء في الرياض'].map((q) => ({
        input: q,
        expected: 'SELECT 1',
        output: 'SELECT 2',
        scores: { exact_match: 0, execution_accuracy: 0 },
      })),
    });
  }
  return out;
}

export const analysisUrl = (slug: string, runId: string, query = '') => `/projects/${slug}/analysis?run=${runId}${query}`;

/** Pass the real response of `pattern` through `patch` (e.g. analysis-config flags). */
export async function patchJson(
  page: Page,
  pattern: string | RegExp,
  patch: (json: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await page.route(pattern, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const json = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: patch(json) });
  });
}

/** Collect console errors and uncaught page errors (the happy path must have none). */
export function trackErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // network 4xx/5xx the specs provoke on purpose are logged by the browser as console errors
    if (/Failed to load resource/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return { errors };
}

/** Wait until the analyzer workspace (stepper) is on screen. */
export async function waitWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole('list', { name: 'Analysis steps' })).toBeVisible();
}

export const step = (page: Page, label: 'Configure' | 'Preview' | 'Run' | 'Review') =>
  page.getByRole('list', { name: 'Analysis steps' }).getByRole('button', { name: new RegExp(`^${label}`) });

/** The visual box of our Checkbox/Switch sits over the native input: click its wrapping label instead. */
export async function toggleBox(box: Locator): Promise<void> {
  await box.locator('xpath=ancestor::label[1]').click();
}
