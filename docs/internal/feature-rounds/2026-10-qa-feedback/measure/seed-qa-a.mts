/**
 * QA-A design seed (public API only; run seed-members.py first). Usage: node seed-qa-a.mts http://127.0.0.1:8981 [project-slug]
 * Project access-demo, 6 datasets:
 *   support-faq       public, v1 published (130 items) + v2 draft copy; list metadata (see items())
 *   legal-clauses     restricted, 12 grants      onboarding-checks restricted, 1 grant     refund-cases restricted, 0 grants
 *   pricing-golden    private test set (24)      release-notes     public, 12 items
 * List metadata on support-faq: tags (list of 1-3 of 8 strings), source.labels (nested list), channels (list on 1/3 of items,
 * a string on the rest: mixed), attachments (list of objects), flags (empty list on every item), levels (list of numbers).
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8981';
const SLUG = process.argv[3] ?? 'access-demo';
const J = { 'content-type': 'application/json' };
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const DOMAINS = ['finance', 'health', 'retail', 'legal'];
const REGIONS = ['sa', 'ae', 'eg', 'kw'];
const TAGS = ['billing', 'refund', 'shipping', 'account', 'vip', 'urgent', 'fraud', 'arabic'];
const LABELS = ['gold', 'silver', 'reviewed', 'needs-review', 'synthetic'];
function items(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => {
    // one base tag, a second one on every 3rd item, a third on every 5th: billing and refund co-occur on some items
    const tags = [TAGS[i % 8], ...(i % 3 === 0 ? [TAGS[(i + 1) % 8]] : []), ...(i % 5 === 0 ? [TAGS[(i + 3) % 8]] : [])];
    return {
      item_id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      input: `What is the refund policy for order #${i + 1}?`,
      expected_output: `Refunds within 30 days for order #${i + 1}.`,
      metadata: {
        domain: i < 42 ? 'finance' : DOMAINS[1 + (i % 3)],
        difficulty: i % 3,
        tags: [...new Set(tags)],
        source: { region: { code: REGIONS[i % 4] }, channel: i % 2 ? 'chat' : 'email', labels: i % 2 === 0 ? [LABELS[i % 5], LABELS[(i + 2) % 5]] : [LABELS[i % 5]] },
        channels: i % 3 === 0 ? ['chat', 'email', 'phone'].slice(0, 1 + (i % 2) + 1) : i % 2 ? 'chat' : 'email',
        attachments: i % 4 === 0 ? [{ kind: 'pdf', pages: 2 }] : [],
        flags: [],
        levels: [i % 3, (i % 3) + 1],
      },
      labels: [],
    };
  });
}
async function dataset(name: string, extra: Record<string, unknown> = {}) {
  return (await call('POST', '/v1/datasets', { name, project_slug: SLUG, ...extra })).dataset as { id: string; slug: string };
}
async function version(ref: string, body: Record<string, unknown> = {}) {
  return (await call('POST', `/v1/datasets/${ref}/versions?project_slug=${SLUG}`, body)).version as { version: string };
}
async function bulk(ref: string, v: string, upserts: unknown[]) {
  for (let i = 0; i < upserts.length; i += 1000)
    await call('POST', `/v1/datasets/${ref}/versions/${v}/items:bulk?project_slug=${SLUG}`, { upserts: upserts.slice(i, i + 1000) });
}
async function publish(ref: string, v: string) {
  await call('POST', `/v1/datasets/${ref}/versions/${v}:publish?project_slug=${SLUG}`, { set_alias: 'production' });
}
async function full(name: string, n: number, extra: Record<string, unknown> = {}, draft = false) {
  const ds = await dataset(name, extra);
  const list = items(n, name.slice(0, 4));
  const v1 = await version(ds.slug, { name: 'v1' });
  await bulk(ds.slug, v1.version, list);
  await publish(ds.slug, v1.version);
  if (draft) await version(ds.slug, { from_version: v1.version });
  return ds;
}
async function access(ref: string, mode: string, users: number[]) {
  const level = (k: number) => (k % 3 === 0 ? 'modify' : 'view');
  await call('PUT', `/v1/datasets/${ref}/access?project_slug=${SLUG}`, {
    access_mode: mode,
    grants: users.map((k) => ({ user_id: `qa-user-${String(k).padStart(2, '0')}`, level: level(k) })),
  });
}
const faq = await full('support-faq', 130, { description: 'Customer support questions in Arabic and English.', tags: ['support', 'bilingual'] }, true);
const legal = await full('legal-clauses', 40, { description: 'Clause extraction cases reviewed by counsel.', tags: ['legal'] });
const onboard = await full('onboarding-checks', 20, { description: 'Checks run before a new customer goes live.' });
const refund = await full('refund-cases', 20, { description: 'Edge cases for refunds.' });
await full('pricing-golden', 24, { description: 'Held-out pricing questions.', private_test_set: true });
await full('release-notes', 12, { description: 'Release note summaries.' });
await access(legal.slug, 'restricted', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
await access(onboard.slug, 'restricted', [4]);
await access(refund.slug, 'restricted', []);
console.log(JSON.stringify({ project: SLUG, faq: faq.slug, legal: legal.slug, onboard: onboard.slug, refund: refund.slug }));
