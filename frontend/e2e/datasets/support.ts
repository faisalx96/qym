/**
 * Datasets / reviews / trash e2e seeding through the API as dev@local (ADMIN
 * under QYM_AUTH_MODE=none). Runs are ingested through the SDK path
 * (`POST /v1/runs` + NDJSON events with an API key) so they link to the
 * dataset version and carry scores; corrections come from
 * `POST /api/runs/update_root_cause_issue`.
 */
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export interface SeededDataset {
  id: string;
  name: string;
  slug: string;
}
export interface SeededVersion {
  id: string;
  version: string;
  status: 'draft' | 'published';
}

async function ok<T>(resPromise: Promise<APIResponse>): Promise<T> {
  const res = await resPromise;
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

export async function createDataset(
  request: APIRequestContext,
  projectSlug: string,
  name: string,
  extra: { description?: string; tags?: string[]; private_test_set?: boolean; slug?: string } = {},
): Promise<SeededDataset> {
  const r = await ok<{ dataset: SeededDataset }>(
    request.post('/v1/datasets', { data: { name, project_slug: projectSlug, ...extra } }),
  );
  return r.dataset;
}

export async function createVersion(
  request: APIRequestContext,
  projectSlug: string,
  ref: string,
  body: { name?: string; from_version?: string } = {},
): Promise<SeededVersion> {
  const r = await ok<{ version: SeededVersion }>(
    request.post(`/v1/datasets/${encodeURIComponent(ref)}/versions?project_slug=${projectSlug}`, { data: body }),
  );
  return r.version;
}

export interface SeedItem {
  item_id?: string;
  input: unknown;
  expected_output?: unknown;
  metadata?: Record<string, unknown>;
  labels?: string[];
}

export async function bulkItems(
  request: APIRequestContext,
  projectSlug: string,
  ref: string,
  version: string,
  upserts: SeedItem[],
): Promise<void> {
  for (let i = 0; i < upserts.length; i += 1000) {
    await ok(
      request.post(
        `/v1/datasets/${encodeURIComponent(ref)}/versions/${version}/items:bulk?project_slug=${projectSlug}`,
        { data: { upserts: upserts.slice(i, i + 1000) } },
      ),
    );
  }
}

export async function patchItem(
  request: APIRequestContext,
  projectSlug: string,
  ref: string,
  version: string,
  itemId: string,
  body: Partial<SeedItem>,
): Promise<void> {
  await ok(
    request.patch(
      `/v1/datasets/${encodeURIComponent(ref)}/versions/${version}/items/${encodeURIComponent(itemId)}?project_slug=${projectSlug}`,
      { data: body },
    ),
  );
}

export async function publishVersion(
  request: APIRequestContext,
  projectSlug: string,
  ref: string,
  version: string,
  setProduction = false,
): Promise<void> {
  await ok(
    request.post(`/v1/datasets/${encodeURIComponent(ref)}/versions/${version}:publish?project_slug=${projectSlug}`, {
      data: setProduction ? { set_alias: 'production' } : {},
    }),
  );
}

export async function deleteDataset(request: APIRequestContext, projectSlug: string, ref: string): Promise<void> {
  await ok(request.delete(`/v1/datasets/${encodeURIComponent(ref)}?project_slug=${projectSlug}`));
}

/** N question/answer items; every 5th is Arabic. */
export function sampleItems(n: number, prefix = 'q'): SeedItem[] {
  return Array.from({ length: n }, (_, i) => {
    const arabic = i % 5 === 0;
    return {
      item_id: `${prefix}-${String(i).padStart(3, '0')}`,
      input: arabic ? `ما هي سياسة الاسترجاع للطلب رقم ${i}؟` : `What is the refund policy for order #${i}?`,
      expected_output: arabic ? 'يمكنك إرجاع المنتج خلال 30 يوماً' : `Refunds within 30 days for order #${i}.`,
      metadata: { topic: ['refunds', 'shipping', 'billing'][i % 3], difficulty: i % 3 },
      labels: arabic ? ['arabic'] : [],
    };
  });
}

export async function createApiKey(request: APIRequestContext, projectId: string): Promise<string> {
  const r = await ok<{ token: string }>(
    request.post(`/v1/projects/${projectId}/api-keys`, { data: { name: `e2e-${Date.now()}` } }),
  );
  return r.token;
}

export interface IngestedRun {
  id: string;
  run_name: string;
}

/**
 * Ingest a completed run against a dataset version. `score(itemId, i)` returns
 * the per-metric scores (0..1); default: every third item scores 0.
 */
export async function ingestRun(
  request: APIRequestContext,
  opts: {
    apiKey: string;
    task: string;
    runName: string;
    model?: string;
    dataset: SeededDataset;
    version: SeededVersion;
    items: SeedItem[];
    metrics?: string[];
    score?: (itemId: string, index: number, metric: string) => number;
    output?: (item: SeedItem, index: number) => unknown;
  },
): Promise<IngestedRun> {
  const metrics = opts.metrics ?? ['exact_match', 'fuzzy_match'];
  const headers = { Authorization: `Bearer ${opts.apiKey}` };
  const created = await ok<{ run_id?: string; id?: string }>(
    request.post('/v1/runs', {
      headers,
      data: {
        external_run_id: opts.runName,
        task: opts.task,
        dataset: opts.dataset.name,
        model: opts.model ?? 'openai/gpt-4o',
        metrics,
        dataset_id: opts.dataset.id,
        dataset_version_id: opts.version.id,
        run_config: { run_name: opts.runName },
      },
    }),
  );
  const runId = String(created.run_id ?? created.id);
  const now = new Date().toISOString();
  let seq = 0;
  const event = (type: string, payload: Record<string, unknown>) =>
    JSON.stringify({
      schema_version: 1,
      event_id: randomUUID(),
      sequence: ++seq,
      sent_at: now,
      type,
      run_id: runId,
      payload,
    });
  const lines: string[] = [
    event('run_started', {
      external_run_id: opts.runName,
      task: opts.task,
      dataset: opts.dataset.name,
      model: opts.model ?? 'openai/gpt-4o',
      metrics,
      dataset_id: opts.dataset.id,
      dataset_version_id: opts.version.id,
      total_items: opts.items.length,
      started_at: now,
      run_config: { run_name: opts.runName },
    }),
  ];
  opts.items.forEach((item, index) => {
    const itemId = item.item_id ?? `item-${index + 1}`;
    lines.push(
      event('item_started', { item_id: itemId, index, input: item.input, expected: item.expected_output, item_metadata: item.metadata ?? {} }),
    );
    for (const metric of metrics) {
      const score = opts.score ? opts.score(itemId, index, metric) : index % 3 === 0 ? 0 : 1;
      lines.push(event('metric_scored', { item_id: itemId, metric_name: metric, score_numeric: score, score_value: score, score_raw: score }));
    }
    lines.push(
      event('item_completed', {
        item_id: itemId,
        index,
        output: opts.output ? opts.output(item, index) : index % 3 === 0 ? 'I do not know' : item.expected_output,
        latency_ms: 120 + index,
      }),
    );
  });
  lines.push(event('run_completed', { ended_at: now, final_status: 'COMPLETED' }));
  for (let i = 0; i < lines.length; i += 200) {
    const res = await request.post(`/v1/runs/${runId}/events`, {
      headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
      data: lines.slice(i, i + 200).join('\n') + '\n',
    });
    expect(res.ok(), `events → ${res.status()} ${await res.text()}`).toBeTruthy();
  }
  return { id: runId, run_name: opts.runName };
}

/** Adds a human root-cause issue → one pending correction row. Returns the correction id. */
export async function addCorrection(
  request: APIRequestContext,
  run: IngestedRun,
  itemId: string,
  issue: { category: string; subcategory?: string; finding?: string },
  metric = 'exact_match',
): Promise<void> {
  await ok(
    request.post('/api/runs/update_root_cause_issue', {
      data: { run_id: run.id, item_id: itemId, metric_name: metric, action: 'add', issue },
    }),
  );
}

export interface CorrectionSummary {
  id: number;
  item_id: string;
  status: string;
  run_id: string;
}

export async function listCorrections(
  request: APIRequestContext,
  projectSlug: string,
  status?: string,
): Promise<CorrectionSummary[]> {
  const q = new URLSearchParams({ project_slug: projectSlug, limit: '200' });
  if (status) q.set('status', status);
  const r = await ok<{ corrections: CorrectionSummary[] }>(request.get(`/api/corrections?${q.toString()}`));
  return r.corrections;
}

export async function softDeleteRun(request: APIRequestContext, runId: string): Promise<void> {
  await ok(request.post('/api/runs/delete', { data: { file_path: runId } }));
}

/** Project review rules (require a different reviewer, approvers). */
export async function setReviewRules(
  request: APIRequestContext,
  projectId: string,
  rules: { correction_approvers?: 'members' | 'managers'; correction_require_different_reviewer?: boolean },
): Promise<void> {
  await ok(
    request.patch(`/v1/projects/${projectId}/review-rules`, {
      data: { correction_approvers: 'members', correction_require_different_reviewer: false, ...rules },
    }),
  );
}
