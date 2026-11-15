// Implementation stage: after-shots of the real pages, the same surfaces and sizes as the mock-page-* set (shots_mock.cjs):
// whole page at 1440 and 390, the K4 pages also as the viewport the user sees (1440x900, 1440x1400, 390x844).
// Needs the seed_r10.py data; the fakes' versioning payloads are set per surface through /__control/versioning.
// Usage: R10_BASE=http://127.0.0.1:5970 R10_FAKE_PORTS=9070,9071 node shots_after.cjs [filter]
const { chromium, base, SHOTS, ids, PROJ } = require('./pw.cjs');
const only = process.argv[2];
const [STAGING, PRODUCTION] = (process.env.R10_FAKE_PORTS ?? '9098,9099').split(',').map((p) => `http://127.0.0.1:${p}`);
const V3 = { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' };
const V2 = { agent_version: 'agent-1.5.0', kb_version: 'kb-81' };
const V5 = {
  agent_version: 'agent-1.5.0',
  kb_version: 'kb-81',
  prompt_set: 'prompts-2026-11-01',
  model_routing: { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' },
  build: 4127,
};
// surface -> [url builder, production payload, staging payload]
const SURFACES = {
  'customize-where': [(i) => `${PROJ}/experiments/new?clone=${i.twoAxis}&step=where`, V2, V3],
  'customize-start': [(i) => `${PROJ}/experiments/new?clone=${i.twoAxis}&step=start`, V2, V3],
  review: [(i) => `${PROJ}/experiments/new?clone=${i.twoAxis}&step=review`, V2, V3],
  'env-versions': [(i) => `${PROJ}/experiments/new?env=${i.envs.production}&env=${i.envs.staging}`, V5, V2],
  'env-versions-none': [(i) => `${PROJ}/experiments/new?env=${i.envs.production}`, {}, V3],
  'home-short': [(i) => `${PROJ}/experiments/new?env=${i.envs.production}`, V3, V3],
};
const VIEWPORT = ['home-short', 'customize-start', 'customize-where'];
(async () => {
  const browser = await chromium.launch();
  const shot = async (w, h, id, mode) => {
    if (only && !id.includes(only)) return;
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage();
    const [url, prod, stag] = SURFACES[id];
    await page.request.post(`${PRODUCTION}/__control/versioning`, { data: prod });
    await page.request.post(`${STAGING}/__control/versioning`, { data: stag });
    await page.goto(`${base}${PROJ}/experiments`);
    const i = await ids(page);
    await page.goto(base + url(i));
    await page.waitForSelector('[data-part=launch-bar]');
    if (id === 'review') await page.waitForSelector('[data-part=runs-table] [data-run], [data-part=runs-cards] [data-run]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    if (mode === 'viewport') {
      await page.screenshot({ path: `${SHOTS}/after-page-${id}-${w}x${h}.png` });
      console.log(id, `${w}x${h}`, 'viewport');
    } else {
      // a viewport as tall as the page: the sticky bar then sits where the flow puts it, as at the end of a scroll
      const extra = await page.evaluate(() => {
        const s = document.querySelector('main');
        return s ? s.scrollHeight - s.clientHeight : 0;
      });
      await page.setViewportSize({ width: w, height: h + Math.max(0, extra) });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/after-page-${id}-${w}.png` });
      console.log(id, w, `${w}x${h + Math.max(0, extra)}`);
    }
    await page.close();
  };
  for (const id of Object.keys(SURFACES)) {
    await shot(1440, 900, id, 'full');
    await shot(390, 844, id, 'full');
  }
  for (const id of VIEWPORT) {
    await shot(1440, 900, id, 'viewport');
    await shot(1440, 1400, id, 'viewport');
    await shot(390, 844, id, 'viewport');
  }
  await page_reset();
  await browser.close();
  async function page_reset() {
    const ctx = await browser.newContext();
    for (const u of [PRODUCTION, STAGING]) await ctx.request.post(`${u}/__control/versioning`, { data: V3 });
    await ctx.close();
  }
})();
