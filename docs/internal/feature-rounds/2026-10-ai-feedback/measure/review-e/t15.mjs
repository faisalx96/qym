import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.focus); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(600);
await page.route(/\/messages$/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([['message', { id: 99999, seq: 999, role: 'user', created_at: new Date().toISOString() }], ['error', { code: 'agent_unavailable', message: 'The stored key cannot be decrypted. Save the connection again.', retryable: false }]]) }));
await page.getByLabel('Your reply').fill('x'); await page.getByLabel('Your reply').press('Enter'); await page.waitForTimeout(800);
console.log(await page.locator('[data-testid=agent-unavailable]').allInnerTexts());
await browser.close();
// member loaded vs loading for the request page
const H = { 'X-User-Email': 'sara@example.test' };
for (const w of [1440, 1024, 390]) {
  const { browser: b, page: p } = await open(w, { headers: H });
  let release; const gate = new Promise(r => (release = r));
  await p.route(/\/v1\/feedback\/FB-0010$/, async (route) => { await gate; await route.continue(); });
  const nav = p.goto('http://127.0.0.1:6017/feedback/FB-0010').catch(() => {}); await p.waitForTimeout(1800);
  const h = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e && +e.getBoundingClientRect().height.toFixed(1); }, sel);
  const L = await h('[data-testid=request-loading]'); release(); await nav; await p.waitForTimeout(1500);
  const D = await h('[data-testid=feedback-request-page]'); console.log('member request', w, 'loading', L, 'loaded', D, 'delta', +(D - L).toFixed(1));
  await b.close();
}
