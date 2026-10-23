import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const w = +process.argv[2];
for (const [name, url, pat] of [['list', '/feedback', /\/v1\/feedback\?/], ['request', '/feedback/FB-0010', /\/v1\/feedback\/FB-0010$/], ['chat', '/feedback/' + ids.asking, /\/v1\/feedback\/[0-9a-f-]{36}$/]]) {
  const { browser, page } = await open(w);
  let release; const gate = new Promise(r => (release = r));
  await page.route('**/v1/feedback**', async (route) => { if (pat.test(route.request().url()) && route.request().method() === 'GET') await gate; await route.continue(); });
  const nav = page.goto(BASE + url).catch(() => {}); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${process.cwd()}/dl/loading-${name}-${w}.png`, fullPage: true });
  const blocks = () => page.evaluate(() => { const m = document.querySelector('main') ?? document.body; return [...m.querySelectorAll(':scope > div > *, :scope > * > * > *')].filter(e => e.getBoundingClientRect().height > 20).slice(0, 12).map(e => [e.tagName, (e.getAttribute('data-testid') || e.className.toString().slice(0, 25)), +e.getBoundingClientRect().height.toFixed(1)]); });
  const L = await blocks();
  release(); await nav; await page.waitForTimeout(1200); await ready(page);
  const D = await blocks();
  console.log(name, w, 'LOADING', JSON.stringify(L)); console.log(name, w, 'LOADED ', JSON.stringify(D));
  await browser.close();
}
