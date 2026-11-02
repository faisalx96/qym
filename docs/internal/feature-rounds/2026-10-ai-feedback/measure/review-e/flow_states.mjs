import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
async function fresh(w = 1440) { return open(w); }
let { browser, page } = await fresh();
// (a) list error
await page.route(/\/v1\/feedback\?/, r => r.abort());
await page.goto(BASE + '/feedback'); await page.waitForTimeout(9000);
console.log('list error:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200), '| rows', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
await page.unroute(/\/v1\/feedback\?/);
await page.getByRole('button', { name: /Retry|Try again/ }).first().click(); await page.waitForTimeout(1200); console.log('after Retry rows:', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
// (b) stale banner: load fine, then fail refetch on focus
await page.route(/\/v1\/feedback\?/, r => r.abort()); await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(2500);
console.log('stale banner:', await page.evaluate(() => [...document.querySelectorAll('[class*=stale], [data-testid*=stale]')].map(e => e.innerText.replace(/\n/g, ' ')).concat([(document.querySelector('main').innerText.match(/(Showing|Couldn.t refresh|out of date|stale)[^\n]*/i) || [''])[0]])), 'rows', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
await browser.close();
// (c) empty list
({ browser, page } = await fresh());
await page.route(/\/v1\/feedback\?/, r => r.fulfill({ json: { items: [], children: {}, total: 0, matching: 0, page: 1, page_size: 50, facets: { projects: [] }, counts: { all: 0, new: 0, duplicate_pairs: 0 }, drafts: [], draft_retention_days: 30, configured: true } }));
await page.goto(BASE + '/feedback'); await page.waitForTimeout(1200); console.log('empty:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
await browser.close();
// (e) resume callout
({ browser, page } = await fresh());
await page.goto(BASE + '/feedback/' + ids.aged); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(800);
const call1 = await page.evaluate(() => [...document.querySelectorAll('[class*=callout]')].map(e => e.innerText.replace(/\n+/g, ' / ')));
console.log('resume callout:', call1); 
await page.getByRole('button', { name: /Dismiss|Close/ }).first().click().catch(() => console.log('no dismiss button')); await page.waitForTimeout(300); console.log('callouts after dismiss:', await page.locator('[class*=callout]').count());
await page.goto(BASE + '/feedback/' + ids.fresh); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(500); console.log('fresh draft callouts:', await page.locator('[class*=callout]').count());
// (g) 429
await page.route('**/messages', r => r.fulfill({ status: 429, headers: { 'Retry-After': '120', 'content-type': 'application/json' }, body: JSON.stringify({ detail: 'Too many messages. Try again in 120 seconds.', code: 'rate_limited', retry_after: 120 }) }));
const ta = page.getByLabel('Your reply'); await ta.fill('This text should stay'); await ta.press('Enter'); await page.waitForTimeout(800);
console.log('429:', await page.locator('[data-testid=chat]').innerText().then(t => t.match(/Too many[^\n]*/)?.[0]), '| text kept:', JSON.stringify(await ta.inputValue()), '| log items', await page.locator('[data-testid=chat-log] ol > li').count());
await page.unroute('**/messages');
// (h) 409
await page.route('**/messages', r => r.fulfill({ status: 409, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detail: 'The assistant is already answering in another window.', code: 'turn_in_progress' }) }));
await ta.fill('second window'); await ta.press('Enter'); await page.waitForTimeout(800); console.log('409:', await page.locator('[data-testid=chat]').innerText().then(t => t.match(/already answering[^\n]*/)?.[0]));
await page.unroute('**/messages');
// (i) interrupted stream
await page.route('**/messages', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([['message', { id: 9999, seq: 99, role: 'user', created_at: new Date().toISOString() }], ['status', { phase: 'thinking' }], ['delta', { text: 'Partial answer that never fini' }]]) }));
await ta.fill('interrupted please'); await ta.press('Enter'); await page.waitForTimeout(1200);
console.log('interrupted:', (await page.locator('[data-testid=chat-log]').innerText()).replace(/\n+/g, ' | ').slice(-230), '| Retry button:', await page.getByRole('button', { name: 'Retry' }).count());
await page.unroute('**/messages');
// (k) error event
await page.route('**/turn', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([['error', { code: 'agent_unavailable', message: 'The stored key cannot be decrypted. Save the connection again.', retryable: false }]]) }));
await page.getByRole('button', { name: 'Retry' }).first().click().catch(() => {}); await page.waitForTimeout(1000);
console.log('error line:', await page.locator('[data-testid=agent-unavailable]').allInnerTexts(), 'role', await page.locator('[data-testid=agent-unavailable]').first().getAttribute('role').catch(() => null));
await browser.close();
