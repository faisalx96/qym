/**
 * Seed of the WP-B design measurements, through the public API only (needs the platform on PERF_BASE and the two fakes
 * of frontend/scripts/fake_eval_service.py on FAKE_A / FAKE_B). Writes seed-b.json next to this file.
 *   node seed-b.mts           (PERF_BASE=http://127.0.0.1:8982 FAKE_A=9082 FAKE_B=9083)
 * Result: project `design-b`, dataset `golden`, environments staging and production, and four experiments
 * (baseline run: finished; timeout sweep: 1 ok, 1 failed, 1 running; staging vs prod: running; urgent check: HIGH, running).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './lib-b.mts';

const FA = process.env.FAKE_A ?? '9082';
const FB = process.env.FAKE_B ?? '9083';
const slug = 'design-b';
const j = async (r: Response) => (r.status === 204 ? null : r.json());
const post = (p: string, body: unknown, method = 'POST') =>
  fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctl = (port: string, p: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/__control${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let r = await post('/v1/projects', { name: 'Design B', slug });
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
  await post(`/v1/projects/${pid}/eval-environments/${id}`, { max_priority: 'HIGH', allow_connection_keys: true }, 'PUT');
  envs[name] = id;
}
const spec = (timeout: unknown = 60) => ({
  evaluator: { dataset: 'golden', config: { samples: 2, report_k: 1 } },
  slot_bindings: { 'endpoint:primary': { connection_id: conn.id } },
  env_overrides: { LLM_OVERRIDES: { endpoints: { primary: { timeout } } } },
});
await post(`/v1/projects/${pid}/eval-environments/${envs.staging}/presets`, { kind: 'official', name: 'Default', config: spec(), notes: 'Initial default' });
const experiments: Record<string, string> = {};
for (const [key, body] of Object.entries({
  baseline: { name: 'baseline run', environment_ids: [envs.staging], spec: spec() },
  both: { name: 'staging vs prod', environment_ids: [envs.staging, envs.production], spec: spec() },
  sweep: { name: 'timeout sweep', description: 'Timeout 10/30/60', environment_ids: [envs.staging], spec: spec({ sweep: [10, 30, 60] }) },
  high: { name: 'urgent check', environment_ids: [envs.staging], spec: spec(), priority: 'HIGH', acknowledge_preemption: true },
})) {
  const res = await post(`/v1/projects/${pid}/experiments`, body);
  experiments[key] = ((await j(res)) as any).id;
}
await new Promise((ok) => setTimeout(ok, 12000));
const jobs: any[] = await (await fetch(`http://127.0.0.1:${FA}/__control/jobs`)).json();
const byName = (n: string) => jobs.find((x) => x.eval_input?.config?.run_name === n)?.id;
if (byName('baseline run')) await ctl(FA, `/jobs/${byName('baseline run')}`, { status: 'SUCCEEDED' });
if (byName('timeout sweep · timeout=10')) await ctl(FA, `/jobs/${byName('timeout sweep · timeout=10')}`, { status: 'SUCCEEDED' });
if (byName('timeout sweep · timeout=30')) await ctl(FA, `/jobs/${byName('timeout sweep · timeout=30')}`, { status: 'FAILED', error: 'timeout' });
const out = { slug, project_id: pid, envs, experiments };
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-b.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
