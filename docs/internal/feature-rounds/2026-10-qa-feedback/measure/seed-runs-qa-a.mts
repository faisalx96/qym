/** QA-A design seed, step 3: two runs on support-faq v1 and legal-clauses v1 (events API). usage: node seed-runs-qa-a.mts http://127.0.0.1:8981 */
import { randomUUID } from 'node:crypto';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8981';
const SLUG = 'access-demo';
const J = { 'content-type': 'application/json' };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...J, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
async function run(ds: { id: string; name: string }, ver: { id: string }, list: any[], name: string, token: string) {
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
for (const [name, runName] of [['support-faq', 'faq-nightly'], ['legal-clauses', 'legal-baseline']]) {
  const ds = (await call('GET', `/v1/datasets/${name}?project_slug=${SLUG}`)).dataset;
  const vs = (await call('GET', `/v1/datasets/${name}/versions?project_slug=${SLUG}`)).versions;
  const v1 = vs.find((v: any) => v.version === 'v1');
  const its = (await call('GET', `/v1/datasets/${name}/versions/v1/items?project_slug=${SLUG}&limit=20`)).items.map((i: any) => ({ item_id: i.item_id, input: i.input, expected_output: i.expected_output, metadata: i.metadata }));
  console.log(runName, await run(ds, v1, its, runName, key.token));
}
