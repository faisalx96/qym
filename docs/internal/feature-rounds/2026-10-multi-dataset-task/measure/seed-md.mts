/**
 * Seed of the multi-dataset launch design measurements (public API only). Needs the platform on PERF_BASE and two fakes
 * (`python frontend/scripts/fake_eval_service.py 9096 --flags`, `... 9097 --flags`). Writes seed-md.json here.
 * Project `design-md`: datasets support-tickets (v1 v2 v3, production -> v3), billing-faq (v1 v2, production -> v2),
 * refund-cases (v1), environments staging and production, one experiment `nightly baseline`.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './lib.mts';

const FA = process.env.FAKE_A ?? '9096';
const FB = process.env.FAKE_B ?? '9097';
const slug = 'design-md';
const post = (p: string, body: unknown, method = 'POST') =>
  fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let r = await post('/v1/projects', { name: 'Design MD', slug });
const proj: any = r.ok ? await r.json() : await (await fetch(`${API}/v1/projects/by-slug/${slug}`)).json();
const pid = proj.id;
const items = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ item_id: `${prefix}-${i}`, input: `question ${i}`, expected_output: `answer ${i}` }));
async function dataset(name: string, versions: number, production: number) {
  const c = await post('/v1/datasets', { name, project_slug: slug, description: 'design' });
  if (!c.ok) console.error('dataset', name, c.status, await c.text());
  for (let v = 1; v <= versions; v++) {
    const nv = await post(`/v1/datasets/${name}/versions?project_slug=${slug}`, v > 1 ? { from_version: `v${v - 1}` } : {});
    if (!nv.ok) console.error('version', name, v, nv.status, await nv.text());
    const b = await post(`/v1/datasets/${name}/versions/v${v}/items:bulk?project_slug=${slug}`, { upserts: items(6 + v, name.slice(0, 3)) });
    if (!b.ok) console.error('items', name, v, b.status, await b.text());
    const p = await post(`/v1/datasets/${name}/versions/v${v}:publish?project_slug=${slug}`, v === production ? { set_alias: 'production' } : {});
    if (!p.ok) console.error('publish', name, v, p.status, await p.text());
  }
}
await dataset('support-tickets', 3, 3);
await dataset('billing-faq', 2, 2);
await dataset('refund-cases', 1, 1);
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
const spec = {
  evaluator: { dataset: 'support-tickets', config: { samples: 1 } },
  slot_bindings: { 'endpoint:primary': { connection_id: conn.id } },
  env_overrides: {},
};
await post(`/v1/projects/${pid}/eval-environments/${envs.staging}/presets`, { kind: 'official', name: 'Default', config: spec, notes: 'Initial default' });
const res = await post(`/v1/projects/${pid}/experiments`, { name: 'nightly baseline', environment_ids: [envs.staging], spec });
const j: any = await res.json();
if (!res.ok) console.error('experiment', res.status, JSON.stringify(j));
const out = { slug, project_id: pid, envs, experiments: { baseline: j.id } };
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-md.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
