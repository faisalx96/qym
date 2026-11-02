import { open, ready, rect, overflow, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
let { browser, page } = await open(1440);
const P = () => page.locator('[data-testid=proposal]');
// QE-56 tab title with proposal; QE-65 supersede; QE-73
await page.goto(BASE + '/feedback/' + ids.ui1); await page.waitForSelector('[data-testid=proposal]'); await page.waitForTimeout(800);
console.log('QE-56 title with proposal:', await page.title());
await P().getByLabel(/^Title/).fill('My edited title'); 
const ta = page.getByLabel('Your reply'); await ta.fill('One more detail: it must include the charts'); await ta.press('Enter');
await page.waitForTimeout(250); console.log('QE-65 superseded now:', (await P().innerText().catch(() => 'no card')).replace(/\n+/g, ' | ').slice(0, 160), '| height', (await rect(page, '[data-testid=proposal]'))?.h);
await page.waitForSelector('[data-testid=proposal] input', { timeout: 20000 }); await page.waitForTimeout(1500);
console.log('QE-73 title after new proposal:', await P().getByLabel(/^Title/).inputValue(), '| notice:', await page.locator('[data-testid=updated-by-assistant]').allInnerTexts());
// QE-68 stale
await page.route('**/confirm', r => r.fulfill({ status: 409, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detail: 'The conversation moved on. Ask the assistant to propose again.', code: 'proposal_stale' }) }));
await page.getByRole('button', { name: /^Submit/ }).click(); await page.waitForTimeout(700);
console.log('QE-68:', (await P().innerText()).match(/The conversation moved on[^\n]*/)?.[0], '| edits kept:', await P().getByLabel(/^Title/).inputValue());
await page.unroute('**/confirm');
await page.route('**/confirm', r => r.fulfill({ status: 422, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detail: 'Give it a shorter title', code: 'validation', field: 'title' }) }));
await page.getByRole('button', { name: /^Submit/ }).click(); await page.waitForTimeout(700); console.log('QE-69 422 field msg:', (await P().innerText()).match(/Give it a shorter title/)?.[0]);
await page.unroute('**/confirm');
await page.route('**/confirm', r => r.abort());
await page.getByRole('button', { name: /^Submit/ }).click(); await page.waitForTimeout(1200); console.log('QE-69 network:', await page.locator('[role=status], [role=alert]').allInnerTexts().then(a => a.filter(x => /submit|kept/i.test(x))), '| submit enabled again:', !(await page.getByRole('button', { name: /^Submit/ }).isDisabled()));
await page.unroute('**/confirm');
// QE-74 forced
await page.goto(BASE + '/feedback/' + ids.forced); await page.waitForSelector('[data-testid=proposal]'); await page.waitForTimeout(800);
console.log('QE-74/129:', await page.evaluate(() => [...document.querySelectorAll('[class*=callout]')].map(e => e.innerText.replace(/\n+/g, ' / ')).filter(t => /messages used|did not learn/i.test(t))));
// QE-134 / QE-89 / 404
await page.goto(BASE + '/feedback/00000000-0000-0000-0000-000000000000'); await page.waitForTimeout(1500); console.log('QE-134/89 missing draft:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200), '| retry btn', await page.getByRole('button', { name: 'Retry' }).count());
await page.goto(BASE + '/feedback/FB-9999'); await page.waitForTimeout(1500); console.log('missing FB-9999:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
// QE-94 target link, QE-95 long title at 390
await page.goto(BASE + '/feedback/' + ids.productRef); await page.waitForSelector('[data-testid=feedback-request-page]'); await page.waitForTimeout(800);
console.log('QE-94 target link:', await page.evaluate(() => { const a = document.querySelector('[data-testid=target-link]'); return a && [a.tagName, a.getAttribute('href'), a.textContent]; }), '| meta:', (await page.locator('[data-testid=feedback-request-page] header').innerText()).replace(/\n+/g, ' | ').slice(-130));
await browser.close();
({ browser, page } = await open(390));
await page.goto(BASE + '/feedback/' + ids.productRef); await page.waitForSelector('[data-testid=feedback-request-page]'); await page.waitForTimeout(800);
console.log('QE-95 @390 title scrollWidth<=clientWidth:', await page.evaluate(() => { const h = document.querySelector('[data-testid=feedback-request-page] h1'); return [h.textContent.length, h.scrollWidth, h.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth]; }));
await browser.close();
// QE-137: connection removed mid-draft
await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'DELETE' });
({ browser, page } = await open(1440));
await page.goto(BASE + '/feedback/' + ids.asking); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(700);
console.log('QE-137 draft readable:', await page.locator('[data-testid=chat-log] ol > li').count() > 0);
await page.getByLabel('Your reply').fill('send while removed'); await page.getByLabel('Your reply').press('Enter'); await page.waitForTimeout(1500);
console.log('QE-137 send:', (await page.locator('[data-testid=chat]').innerText()).replace(/\n+/g, ' | ').slice(-260));
await browser.close();
await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ llm_base_url: 'http://127.0.0.1:10010/v1', llm_model: 'feedback:ask_then_propose', llm_api_key: process.env.REVIEW_KEY, draft_retention_days: 30, max_user_messages: 30 }) });
