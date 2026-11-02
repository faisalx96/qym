import { open, ready, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const surfaces = [['request', '/feedback/FB-0010', /\/v1\/feedback\/FB-0010$/, '[data-testid=feedback-request-page]', '[data-testid=request-loading]'], ['chat', '/feedback/' + ids.asking, /\/v1\/feedback\/[0-9a-f-]{36}$/, '[data-testid=feedback-chat-page]', '[data-testid=chat-loading]'], ['chat-msgs', '/feedback/' + ids.asking, /\/messages/, '[data-testid=feedback-chat-page]', '[data-testid=chat-loading]']];
for (const w of [1440, 1024, 390]) for (const [name, url, pat, loadedSel, loadingSel] of surfaces) {
  const { browser, page } = await open(w);
  let release; const gate = new Promise(r => (release = r));
  await page.route(/\/v1\/feedback\//, async (route) => { if (pat.test(route.request().url()) && route.request().method() === 'GET') await gate; await route.continue(); });
  const nav = page.goto(BASE + url).catch(() => {}); await page.waitForTimeout(1800);
  const h = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const kids = [...e.children].map(c => +c.getBoundingClientRect().height.toFixed(1)); return [+e.getBoundingClientRect().height.toFixed(1), kids]; }, sel);
  const L = await h(loadingSel);
  release(); await nav; await page.waitForTimeout(1500); await ready(page);
  const D = await h(loadedSel);
  console.log(JSON.stringify({ w, name, loading: L, loaded: D, delta: L && D ? +(D[0] - L[0]).toFixed(1) : null }));
  await browser.close();
}
