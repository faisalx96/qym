// Round 10 measurement helpers (design stage). Vite dev server :5998 proxying the platform :8998 (seed_r10.py).
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../../../frontend/node_modules/@playwright/test'));
exports.chromium = chromium;
exports.SHOTS = path.resolve(__dirname, '../shots');
exports.base = process.env.R10_BASE ?? 'http://127.0.0.1:5998';
exports.PROJ = '/projects/exp-demo';
exports.open = async (w = 1440, h = 900) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  return { browser, page };
};
/** Environment ids and the two-axis experiment id, read from the API (the seed's ids change per run). */
exports.ids = async (page) =>
  page.evaluate(async () => {
    const p = await (await fetch('/v1/projects/by-slug/exp-demo')).json();
    const envs = await (await fetch(`/v1/projects/${p.id}/eval-environments`)).json();
    const exps = await (await fetch(`/v1/projects/${p.id}/experiments?limit=50`)).json();
    const list = exps.experiments ?? exps.items ?? exps;
    const envList = envs.environments ?? envs;
    return {
      project: p.id,
      envs: Object.fromEntries(envList.map((e) => [e.name, e.id])),
      twoAxis: list.find((e) => e.name === 'model x threshold x timeout')?.id,
      sweep: list.find((e) => e.name === 'timeout sweep')?.id,
    };
  });
/** Rect of a selector (first match), rounded to 0.1 px. */
exports.rect = async (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const f = (v) => Math.round(v * 10) / 10;
    return { x: f(r.x), y: f(r.y), w: f(r.width), h: f(r.height), bottom: f(r.bottom) };
  }, sel);
