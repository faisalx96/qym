/** WP-C design seed: project multi-demo, three single-dataset runs (label-only datasets) through the public API.
 *  usage: node seed-c.mts http://127.0.0.1:8994  -> prints {slug, runs:{name:id}} */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8994';
const SLUG = 'multi-demo';
const J = { 'content-type': 'application/json' };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...J, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const METRICS = ['answer_correctness', 'faithfulness', 'tone'];
async function run(token: string, name: string, dataset: string, model: string, n: number, bias: number) {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await call('POST', '/v1/runs', { external_run_id: name, task: 'answer-ticket', dataset, model, metrics: METRICS, run_config: { run_name: name } }, headers);
  const runId = String(created.run_id ?? created.id);
  const now = new Date().toISOString();
  let seq = 0;
  const ev = (type: string, payload: Record<string, unknown>) => JSON.stringify({ schema_version: 1, event_id: randomUUID(), sequence: ++seq, sent_at: now, type, run_id: runId, payload });
  const lines = [ev('run_started', { external_run_id: name, task: 'answer-ticket', dataset, model, metrics: METRICS, total_items: n, started_at: now, run_config: { run_name: name } })];
  for (let i = 0; i < n; i++) {
    const id = `t-${String(i + 1).padStart(4, '0')}`;
    lines.push(ev('item_started', { item_id: id, index: i, input: `Customer ticket ${i + 1}: where is my refund?`, expected: 'Refunds take 5 business days.', item_metadata: { channel: i % 2 ? 'email' : 'chat' } }));
    METRICS.forEach((m, k) => {
      const s = Math.max(0, Math.min(1, bias + ((i * (k + 3)) % 10) / 20 - 0.2));
      lines.push(ev('metric_scored', { item_id: id, metric_name: m, score_numeric: s, score_value: s, score_raw: s }));
    });
    lines.push(ev('item_completed', { item_id: id, index: i, output: 'Your refund arrives within 5 business days.', latency_ms: 900 + ((i * 37) % 600) }));
  }
  lines.push(ev('run_completed', { ended_at: now, final_status: 'COMPLETED' }));
  await call('POST', `/v1/runs/${runId}/events`, lines.join('\n') + '\n', { ...headers, 'content-type': 'application/x-ndjson' });
  return runId;
}
let proj: any;
try { proj = await call('POST', '/v1/projects', { name: 'Multi demo', slug: SLUG }); } catch { proj = await call('GET', `/v1/projects/by-slug/${SLUG}`); }
const key = await call('POST', `/v1/projects/${proj.id}/api-keys`, { name: `seed-${Date.now()}` });
const runs: Record<string, string> = {};
runs['ticket-triage-nightly'] = await run(key.token, 'ticket-triage-nightly', 'support-tickets', 'openai/gpt-4o', 60, 0.62);
runs['ticket-triage-baseline'] = await run(key.token, 'ticket-triage-baseline', 'support-tickets', 'openai/gpt-4o-mini', 60, 0.55);
runs['billing-faq-check'] = await run(key.token, 'billing-faq-check', 'billing-faq', 'openai/gpt-4o', 30, 0.7);
const out = { slug: SLUG, project_id: proj.id, runs };
writeFileSync(new URL('./seed-c.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
