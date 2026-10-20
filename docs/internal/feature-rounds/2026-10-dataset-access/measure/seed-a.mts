/**
 * WP-A design seed (public API only). Usage: node seed-a.mts http://127.0.0.1:8981 [project-slug]
 * Creates project "access-demo" with three datasets:
 *   support-faq     public, v1 published (130 items), v2 draft copy (130 items), alias production -> v1, one run on v1
 *   legal-clauses   (restricted in the mocks; the dev user is an admin so the API shows it as public today), 40 items, one run
 *   pricing-golden  private test set, 24 items
 * Item metadata has nested objects: domain, difficulty, source.region.code, source.channel.
 */
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8981';
const SLUG = process.argv[3] ?? 'access-demo';
const J = { 'content-type': 'application/json' };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...J, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const DOMAINS = ['finance', 'health', 'retail', 'legal'];
const REGIONS = ['sa', 'ae', 'eg', 'kw'];
function items(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => {
    const ar = i % 5 === 0;
    return {
      item_id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      input: ar ? `ما هي سياسة الاسترجاع للطلب رقم ${i + 1}؟` : `What is the refund policy for order #${i + 1}?`,
      expected_output: ar ? 'يمكنك إرجاع المنتج خلال 30 يوماً' : `Refunds within 30 days for order #${i + 1}.`,
      // finance = 42 of 130: items whose index % 3 === 0 up to 42 hits -> deterministic below
      metadata: {
        domain: i < 42 ? 'finance' : DOMAINS[1 + (i % 3)],
        difficulty: i % 3,
        source: { region: { code: REGIONS[i % 4] }, channel: i % 2 ? 'chat' : 'email' },
      },
      labels: ar ? ['arabic'] : i % 7 === 0 ? ['edge'] : [],
    };
  });
}

async function dataset(name: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/v1/datasets', { name, project_slug: SLUG, ...extra });
  return r.dataset as { id: string; name: string; slug: string };
}
async function version(ref: string, body: Record<string, unknown> = {}) {
  const r = await call('POST', `/v1/datasets/${ref}/versions?project_slug=${SLUG}`, body);
  return r.version as { id: string; version: string };
}
async function bulk(ref: string, v: string, upserts: unknown[]) {
  for (let i = 0; i < upserts.length; i += 1000)
    await call('POST', `/v1/datasets/${ref}/versions/${v}/items:bulk?project_slug=${SLUG}`, { upserts: upserts.slice(i, i + 1000) });
}
async function publish(ref: string, v: string, prod = false) {
  await call('POST', `/v1/datasets/${ref}/versions/${v}:publish?project_slug=${SLUG}`, prod ? { set_alias: 'production' } : {});
}

async function run(ds: { id: string; name: string }, ver: { id: string }, list: ReturnType<typeof items>, name: string, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await call('POST', '/v1/runs', {
    external_run_id: name, task: 'faq', dataset: ds.name, model: 'openai/gpt-4o', metrics: ['exact_match'],
    dataset_id: ds.id, dataset_version_id: ver.id, run_config: { run_name: name },
  }, headers);
  const runId = String(created.run_id ?? created.id);
  const now = new Date().toISOString();
  let seq = 0;
  const ev = (type: string, payload: Record<string, unknown>) =>
    JSON.stringify({ schema_version: 1, event_id: randomUUID(), sequence: ++seq, sent_at: now, type, run_id: runId, payload });
  const lines = [ev('run_started', { external_run_id: name, task: 'faq', dataset: ds.name, model: 'openai/gpt-4o', metrics: ['exact_match'], dataset_id: ds.id, dataset_version_id: ver.id, total_items: list.length, started_at: now, run_config: { run_name: name } })];
  list.forEach((it, i) => {
    lines.push(ev('item_started', { item_id: it.item_id, index: i, input: it.input, expected: it.expected_output, item_metadata: it.metadata }));
    lines.push(ev('metric_scored', { item_id: it.item_id, metric_name: 'exact_match', score_numeric: i % 3 ? 1 : 0, score_value: i % 3 ? 1 : 0, score_raw: i % 3 ? 1 : 0 }));
    lines.push(ev('item_completed', { item_id: it.item_id, index: i, output: i % 3 ? it.expected_output : 'I do not know', latency_ms: 120 + i }));
  });
  lines.push(ev('run_completed', { ended_at: now, final_status: 'COMPLETED' }));
  await call('POST', `/v1/runs/${runId}/events`, lines.join('\n') + '\n', { ...headers, 'content-type': 'application/x-ndjson' });
  return runId;
}

const proj = await call('GET', `/v1/projects/by-slug/${SLUG}`);
const key = await call('POST', `/v1/projects/${proj.id}/api-keys`, { name: `seed-${Date.now()}` });

const faq = await dataset('support-faq', { description: 'Customer support questions in Arabic and English.', tags: ['support', 'bilingual'] });
const faqItems = items(130, 'faq');
const v1 = await version(faq.slug, { name: 'v1' });
await bulk(faq.slug, v1.version, faqItems);
await publish(faq.slug, v1.version, true);
const v2 = await version(faq.slug, { from_version: v1.version });
await bulk(faq.slug, v2.version, [{ item_id: 'faq-001', input: 'What is the refund policy for order #1 (edited)?', expected_output: 'Refunds within 30 days.', metadata: faqItems[0].metadata }]);

const legal = await dataset('legal-clauses', { description: 'Clause extraction cases reviewed by counsel.', tags: ['legal'] });
const legalItems = items(40, 'clause');
const lv1 = await version(legal.slug, { name: 'v1' });
await bulk(legal.slug, lv1.version, legalItems);
await publish(legal.slug, lv1.version, true);

const price = await dataset('pricing-golden', { description: 'Held-out pricing questions.', private_test_set: true });
const pv1 = await version(price.slug, { name: 'v1' });
await bulk(price.slug, pv1.version, items(24, 'price'));
await publish(price.slug, pv1.version, true);

const r1 = await run(faq, v1, faqItems.slice(0, 20), 'faq-nightly', key.token);
const r2 = await run(legal, lv1, legalItems.slice(0, 20), 'legal-baseline', key.token);
console.log(JSON.stringify({ project: SLUG, faq: faq.slug, v1: v1.version, v2: v2.version, legal: legal.slug, price: price.slug, runs: [r1, r2] }));
