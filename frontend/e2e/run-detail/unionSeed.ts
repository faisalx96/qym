/**
 * Union-run seeding (multi-dataset round, WP-C): platform datasets with published versions, then ONE run over their
 * concatenation uploaded the way SDK 2.1.0 does (create-run `datasets`, namespaced item ids, `qym_*` item tags), through
 * the public API only. The default entries reproduce the design mock: 412 + 438 + 96 = 946 items, 8 errors, run means
 * 68.9 / 85.5 / 78.1 % (a constant score per dataset and metric, errors counting as 0 like the platform's mean rule).
 */
import { randomUUID } from 'node:crypto';
import { createApiKey, ensureProject, type SeedClient } from './seed';
import { uniqueSlug } from '../helpers';

export const UNION_METRICS = ['answer_correctness', 'faithfulness', 'tone'] as const;

export interface UnionEntry {
  /** Dataset name; the same name twice makes two versions of one dataset. */
  name: string;
  items: number;
  errors: number;
  /** Target mean per metric over ALL items of the entry, errors included (as the Overview computes it). */
  means: [number, number, number];
  /** Request the entry by alias (`production`) instead of by version. */
  alias?: string;
}

export const MOCK_ENTRIES: UnionEntry[] = [
  { name: 'support-tickets', items: 412, errors: 3, means: [0.661, 0.842, 0.774] },
  { name: 'support-tickets', items: 438, errors: 5, means: [0.708, 0.857, 0.781] },
  { name: 'billing-faq', items: 96, errors: 0, means: [0.719, 0.901, 0.812], alias: 'production' },
];

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Made {
  id: string;
  name: string;
  slug: string;
  versions: Array<{ id: string; version: string; items: number }>;
}

const rawId = (n: number) => `t-${String(n + 1).padStart(4, '0')}`;

/** One platform dataset with one published version per entry that names it (later versions extend the earlier). */
async function makeDatasets(client: SeedClient, slug: string, entries: UnionEntry[]): Promise<Map<string, Made>> {
  const made = new Map<string, Made>();
  for (const entry of entries) {
    let ds = made.get(entry.name);
    if (!ds) {
      const created = await call<{ dataset: { id: string; name: string; slug: string } }>(client, 'POST', '/v1/datasets', {
        name: entry.name,
        project_slug: slug,
      });
      ds = { ...created.dataset, versions: [] };
      made.set(entry.name, ds);
    }
    const previous = ds.versions[ds.versions.length - 1];
    const created = await call<{ version: { id: string; version: string } }>(
      client,
      'POST',
      `/v1/datasets/${encodeURIComponent(ds.slug)}/versions?project_slug=${slug}`,
      previous ? { from_version: previous.version } : {},
    );
    const version = created.version.version;
    const upserts = Array.from({ length: entry.items }, (_, n) => ({
      item_id: rawId(n),
      input: `Customer ticket ${n + 1}: where is my refund for order ${88000 + n}?`,
      expected_output: 'Refunds take 5 business days.',
      metadata: { channel: n % 2 ? 'email' : 'chat' },
    })).slice(previous?.items ?? 0);
    for (let i = 0; i < upserts.length; i += 1000) {
      await call(
        client,
        'POST',
        `/v1/datasets/${encodeURIComponent(ds.slug)}/versions/${version}/items:bulk?project_slug=${slug}`,
        { upserts: upserts.slice(i, i + 1000) },
      );
    }
    await call(
      client,
      'POST',
      `/v1/datasets/${encodeURIComponent(ds.slug)}/versions/${version}:publish?project_slug=${slug}`,
      entry.alias ? { set_alias: entry.alias } : {},
    );
    ds.versions.push({ id: created.version.id, version, items: entry.items });
  }
  return made;
}

export interface UnionRun {
  slug: string;
  projectId: string;
  token: string;
  runId: string;
  name: string;
  datasets: Map<string, Made>;
}

export interface UnionOptions {
  name?: string;
  entries?: UnionEntry[];
  slug?: string;
  /** Datasets to delete after the run (the "deleted dataset" state). */
  deleteAfter?: string[];
  versioning?: Record<string, string>;
}

/** Seed a project, its datasets and one union run; returns what the specs need. */
export async function seedUnionRun(client: SeedClient, o: UnionOptions = {}): Promise<UnionRun> {
  const entries = o.entries ?? MOCK_ENTRIES;
  const name = o.name ?? 'release-gate-nightly';
  const slug = o.slug ?? uniqueSlug('union');
  const project = await ensureProject(client, 'Multi demo', slug);
  const token = await createApiKey(client, project.id);
  const datasets = await makeDatasets(client, slug, entries);

  const seenNames = new Map<string, number>();
  const described = entries.map((entry, position) => {
    const ds = datasets.get(entry.name)!;
    const ordinal = seenNames.get(entry.name) ?? 0;
    seenNames.set(entry.name, ordinal + 1);
    const version = ds.versions[ordinal]!;
    return { entry, position, ds, version };
  });
  const label = described
    .map((d) => `${d.entry.name}@${d.entry.alias ?? d.version.version}`)
    .join(' + ')
    .slice(0, 120);
  const entryList = described.map((d) => ({
    dataset: d.entry.name,
    dataset_id: d.ds.id,
    dataset_version_id: d.version.id,
    version: d.version.version,
    alias: d.entry.alias ?? null,
    items: d.entry.items,
    disabled_items: 0,
  }));
  const specs = Object.fromEntries(
    UNION_METRICS.map((m) => [m, { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 }]),
  );
  const total = entries.reduce((n, e) => n + e.items, 0);
  const first = entryList[0]!;
  const runBody = {
    external_run_id: name,
    task: 'answer-ticket',
    dataset: label,
    model: 'openai/gpt-4o',
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    dataset_id: first.dataset_id,
    dataset_version_id: first.dataset_version_id,
    datasets: entryList,
    versioning_details: o.versioning ?? { agent_version: 'v2.4.1' },
    run_metadata: { datasets: entryList, total_items: total },
    run_config: { run_name: name, max_concurrency: 8 },
  };
  const created = await call<{ run_id: string }>(client, 'POST', '/v1/runs', runBody, { Authorization: `Bearer ${token}` });
  const runId = created.run_id;
  const sent = new Date(Date.UTC(2026, 9, 22, 12, 0, 0)).toISOString();
  let seq = 0;
  const lines: string[] = [];
  const push = (type: string, payload: Record<string, unknown>) =>
    lines.push(
      JSON.stringify({
        schema_version: 1,
        event_id: randomUUID(),
        sequence: ++seq,
        sent_at: sent,
        type,
        run_id: runId,
        payload,
      }),
    );
  push('run_started', {
    external_run_id: name,
    task: 'answer-ticket',
    dataset: label,
    model: 'openai/gpt-4o',
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    datasets: entryList,
    total_items: total,
    started_at: sent,
    run_config: { run_name: name, max_concurrency: 8 },
    run_metadata: { datasets: entryList, total_items: total },
  });
  let index = 0;
  for (const d of described) {
    const { entry } = d;
    for (let n = 0; n < entry.items; n++) {
      const id = `${entry.name}@${d.version.version}/${rawId(n)}`;
      push('item_started', {
        item_id: id,
        index,
        input: `Customer ticket ${n + 1}: where is my refund for order ${88000 + n}?`,
        expected: 'Refunds take 5 business days.',
        item_metadata: {
          channel: n % 2 ? 'email' : 'chat',
          qym_dataset: entry.name,
          qym_dataset_version: d.version.version,
          qym_dataset_index: d.position,
          qym_item_id: rawId(n),
          qym_dataset_version_id: d.version.id,
        },
      });
      if (n < entry.errors) {
        push('item_failed', { item_id: id, index, error: 'Timeout calling the ticket model', latency_ms: 30000 });
      } else {
        UNION_METRICS.forEach((metric, k) => {
          // a constant score s with `errors` items counting as 0 gives the target mean over all items
          const s = Math.min(1, (entry.means[k]! * entry.items) / (entry.items - entry.errors));
          push('metric_scored', { item_id: id, metric_name: metric, score_numeric: s, score_value: s, score_raw: s });
        });
        push('item_completed', {
          item_id: id,
          index,
          output: 'Your refund arrives within 5 business days.',
          latency_ms: 900 + ((index * 37) % 600),
        });
      }
      index++;
    }
  }
  push('run_completed', { ended_at: sent, final_status: 'COMPLETED' });
  for (let i = 0; i < lines.length; i += 400) {
    const res = await call<{ rejected: number; rejected_events?: unknown[] }>(
      client,
      'POST',
      `/v1/runs/${runId}/events`,
      lines.slice(i, i + 400).join('\n') + '\n',
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
    );
    if (res.rejected) throw new Error(`events rejected: ${JSON.stringify(res.rejected_events).slice(0, 600)}`);
  }
  for (const gone of o.deleteAfter ?? []) {
    const ds = datasets.get(gone);
    if (ds) await call(client, 'DELETE', `/v1/datasets/${encodeURIComponent(ds.slug)}?project_slug=${slug}`);
  }
  return { slug, projectId: project.id, token, runId, name, datasets };
}

/** A single-dataset run on the first entry (for the runs list and compare mocks). */
export async function seedSingleRunOn(
  client: SeedClient,
  union: UnionRun,
  name: string,
  datasetName: string,
  items: number,
  mean: number,
): Promise<string> {
  const ds = union.datasets.get(datasetName)!;
  const version = ds.versions[0]!;
  const specs = Object.fromEntries(
    UNION_METRICS.map((m) => [m, { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 }]),
  );
  const created = await call<{ run_id: string }>(
    client,
    'POST',
    '/v1/runs',
    {
      external_run_id: name,
      task: 'answer-ticket',
      dataset: ds.name,
      model: 'openai/gpt-4o',
      metrics: [...UNION_METRICS],
      metric_specs: specs,
      dataset_id: ds.id,
      dataset_version_id: version.id,
      run_config: { run_name: name },
    },
    { Authorization: `Bearer ${union.token}` },
  );
  const runId = created.run_id;
  const sent = new Date(Date.UTC(2026, 9, 22, 11, 0, 0)).toISOString();
  let seq = 0;
  const lines: string[] = [];
  const push = (type: string, payload: Record<string, unknown>) =>
    lines.push(
      JSON.stringify({ schema_version: 1, event_id: randomUUID(), sequence: ++seq, sent_at: sent, type, run_id: runId, payload }),
    );
  push('run_started', {
    external_run_id: name,
    task: 'answer-ticket',
    dataset: ds.name,
    model: 'openai/gpt-4o',
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    dataset_id: ds.id,
    dataset_version_id: version.id,
    total_items: items,
    started_at: sent,
    run_config: { run_name: name },
  });
  for (let n = 0; n < items; n++) {
    const id = rawId(n);
    push('item_started', { item_id: id, index: n, input: `Customer ticket ${n + 1}`, expected: 'Refunds take 5 business days.' });
    UNION_METRICS.forEach((metric) =>
      push('metric_scored', { item_id: id, metric_name: metric, score_numeric: mean, score_value: mean, score_raw: mean }),
    );
    push('item_completed', { item_id: id, index: n, output: 'Your refund arrives within 5 business days.', latency_ms: 900 });
  }
  push('run_completed', { ended_at: sent, final_status: 'COMPLETED' });
  for (let i = 0; i < lines.length; i += 400) {
    await call(client, 'POST', `/v1/runs/${runId}/events`, lines.slice(i, i + 400).join('\n') + '\n', {
      Authorization: `Bearer ${union.token}`,
      'Content-Type': 'application/x-ndjson',
    });
  }
  return runId;
}
