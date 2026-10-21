/**
 * Seed of the QA-B design measurements, public API only. Needs the platform on PERF_BASE and two fakes
 * (`python frontend/scripts/fake_eval_service.py 9082 --flags`, `... 9083 --flags`). Writes seed-qab.json here.
 * Project `design-qab`: dataset golden, environments staging (open) and production (latency flag managers only),
 * experiments: nightly baseline (old-style versioning_details), latency check (flag), prompt sweep (2 combos, no flag),
 * staging vs prod (flag, 2 envs). Every finished job gets a linked official run; plus 3 local runs.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './lib.mts';

const FA = process.env.FAKE_A ?? '9082';
const FB = process.env.FAKE_B ?? '9083';
const slug = 'design-qab';
const post = (p: string, body: unknown, method = 'POST', headers: Record<string, string> = {}) =>
  fetch(API + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ctl = (port: string, p: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/__control${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let r = await post('/v1/projects', { name: 'Design QA B', slug });
const proj: any = r.ok ? await r.json() : await (await fetch(`${API}/v1/projects/by-slug/${slug}`)).json();
const pid = proj.id;
await post('/v1/datasets', { project_slug: slug, name: 'golden', description: 'design' });
const conn: any = await (await post(`/v1/projects/${pid}/llm-connections`, { name: 'gpt-4o prod', llm_model: 'gpt-4o', llm_base_url: 'https://api.example.com/v1', llm_api_key: 'sk-test-1234567890' })).json();
const envs: Record<string, string> = {};
for (const [name, port] of [['staging', FA], ['production', FB]] as const) {
  const c: any = await (await post(`/v1/projects/${pid}/eval-environments`, { name, base_url: `http://127.0.0.1:${port}/${slug}`, api_key: 'fake-key-12345' })).json();
  const id = c.environment.id;
  const slots: any = await (await fetch(`${API}/v1/projects/${pid}/eval-environments/${id}/model-slots`)).json();
  const keys = ['slot_key', 'kind', 'label', 'field_map', 'transport_fields', 'extra_field_maps'];
  await post(`/v1/projects/${pid}/eval-environments/${id}/model-slots`, { schema_id: slots.schema_id, slots: slots.slots.map((s: any) => Object.fromEntries(keys.map((k) => [k, s[k]]))) }, 'PUT');
  await post(`/v1/projects/${pid}/eval-environments/${id}`, { max_priority: 'HIGH', allow_connection_keys: true, ...(name === 'production' ? { latency_sensitive_min_role: 'manager' } : {}) }, 'PUT');
  envs[name] = id;
}
const spec = (timeout: unknown = 60) => ({
  evaluator: { dataset: 'golden', config: { samples: 2, report_k: 1 } },
  slot_bindings: { 'endpoint:primary': { connection_id: conn.id } },
  env_overrides: { LLM_OVERRIDES: { endpoints: { primary: { timeout } } } },
});
await post(`/v1/projects/${pid}/eval-environments/${envs.staging}/presets`, { kind: 'official', name: 'Default', config: spec(), notes: 'Initial default' });
const keyRes: any = await (await post(`/v1/projects/${pid}/api-keys`, { name: 'qab seed' })).json();
const token = keyRes.token;
const experiments: Record<string, string> = {};
const bodies: Record<string, any> = {
  baseline: { name: 'nightly baseline', environment_ids: [envs.staging], spec: spec(), versioning_details: { agent_version: 'manual-1.0', owner: 'qa' } },
  latency: { name: 'latency check', environment_ids: [envs.staging], spec: spec(), latency_sensitive: true },
  sweep: { name: 'prompt sweep', description: 'Timeout 10/30', environment_ids: [envs.staging], spec: spec({ sweep: [10, 30] }) },
  both: { name: 'staging vs prod', environment_ids: [envs.staging, envs.production], spec: spec(), latency_sensitive: true },
};
for (const [key, body] of Object.entries(bodies)) {
  const res = await post(`/v1/projects/${pid}/experiments`, body);
  const j: any = await res.json();
  if (!res.ok) console.error(key, res.status, JSON.stringify(j));
  experiments[key] = j.id;
}
await new Promise((ok) => setTimeout(ok, 14000));
const ev = (runId: string, type: string, payload: unknown, sequence: number) =>
  JSON.stringify({ schema_version: 1, event_id: crypto.randomUUID(), sequence, sent_at: new Date().toISOString(), type, run_id: runId, payload });
async function ingest(name: string, runMetadata: unknown, model = 'model-a') {
  const h = { Authorization: `Bearer ${token}` };
  const spec = { exact_match: { score_type: 'boolean', direction: 'maximize', pass_threshold: 0.5 } };
  const c: any = await (await post('/v1/runs', { external_run_id: name, run_name: name, task: 'qa', dataset: 'golden', model, metrics: ['exact_match'], metric_specs: spec, run_metadata: runMetadata, run_config: {} }, 'POST', h)).json();
  const id = c.run_id;
  const events = [ev(id, 'run_started', { external_run_id: name, task: 'qa', dataset: 'golden', model, metrics: ['exact_match'], metric_specs: spec, started_at: new Date().toISOString(), total_items: 4 }, 1)];
  let seq = 2;
  for (let i = 0; i < 4; i++) {
    events.push(ev(id, 'item_started', { item_id: `i${i}`, index: i, input: { q: `q${i}` } }, seq++));
    events.push(ev(id, 'metric_scored', { item_id: `i${i}`, metric_name: 'exact_match', score_numeric: i % 2 }, seq++));
    events.push(ev(id, 'item_completed', { item_id: `i${i}`, output: `a${i}`, latency_ms: 10 }, seq++));
  }
  events.push(ev(id, 'run_completed', { ended_at: new Date().toISOString(), final_status: 'COMPLETED' }, seq++));
  const pr = await fetch(`${API}/v1/runs/${id}/events`, { method: 'POST', headers: { ...h, 'content-type': 'application/x-ndjson' }, body: events.join('\n') + '\n' });
  if (!pr.ok) console.error('events', pr.status, await pr.text());
  return id;
}
const runs: string[] = [];
for (const [port, key] of [[FA, 'staging'], [FB, 'production']] as const) {
  const jobs: any[] = await (await fetch(`http://127.0.0.1:${port}/__control/jobs`)).json();
  for (const j of jobs) {
    const launch = j.eval_input?.config?.run_metadata?.qym_launch;
    if (!launch?.token) continue;
    const name = j.eval_input.config.run_name ?? `run ${launch.job_id}`;
    const expId = Object.entries(experiments).find(([, v]) => v === launch.experiment_id)?.[0];
    runs.push(await ingest(name, { qym_launch: { ...launch } }));
    if (expId) await ctl(port, `/jobs/${j.id}`, { status: 'SUCCEEDED' });
  }
}
await ingest('local smoke', {}, 'model-b');
await ingest('local regression', {}, 'model-b');
const out = { slug, project_id: pid, envs, experiments, runs };
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-qab.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
