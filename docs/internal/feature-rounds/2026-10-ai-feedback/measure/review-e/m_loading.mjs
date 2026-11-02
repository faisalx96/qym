import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const surfaces = [['list', '/feedback', '[data-testid=feedback-list-page]', /\/v1\/feedback\?/], ['request', '/feedback/FB-0010', '[data-testid=feedback-request-page]', /\/v1\/feedback\/FB-0010$/], ['request-conv', '/feedback/FB-0010?tab=conversation', '[data-testid=feedback-request-page]', /\/v1\/feedback\/FB-0010\/messages/], ['chat', '/feedback/' + ids.plain, '[data-testid=feedback-chat-page]', /\/v1\/feedback\/[0-9a-f-]{36}$/], ['new', '/feedback/new', '[data-testid=feedback-new-page]', /nothing/]];
for (const w of [1440, 1024, 390]) for (const [name, url, sel, pat] of surfaces) {
  const { browser, page } = await open(w);
  const st = () => page.evaluate(() => [Math.round(document.querySelector('main')?.scrollHeight ?? 0), Math.round(document.documentElement.scrollHeight)]);
  const pageH = async () => page.evaluate((s) => { const e = document.querySelector(s) ?? document.querySelector('[aria-busy=true]'); return e ? +e.getBoundingClientRect().height.toFixed(1) : null; }, sel);
  let release; const gate = new Promise(r => (release = r));
  await page.route('**/v1/feedback**', async (route) => { if (pat.test(route.request().url()) && route.request().method() === 'GET') { await gate; } await route.continue(); });
  const nav = page.goto(BASE + url).catch(() => {});
  await page.waitForTimeout(1800);
  const loading = { page: await pageH(), doc: (await st())[1], busy: await page.locator('[aria-busy=true]').count(), skeleton: await page.locator('[class*=skeleton], [class*=Skeleton]').count() };
  release(); await nav; await page.waitForTimeout(1200); await ready(page);
  const loaded = { page: await pageH(), doc: (await st())[1] };
  console.log(JSON.stringify({ w, name, loading, loaded, dDoc: loaded.doc - loading.doc, dPage: loading.page && loaded.page ? +(loaded.page - loading.page).toFixed(1) : null }));
  await browser.close();
}
