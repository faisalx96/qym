import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
let { browser, page } = await open(1440);
const calls = []; page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(Date.now() + ' ' + r.method() + ' ' + u.pathname); });
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
// QE-15 trigger widths, QE-21 Enter/click opens, QE-23 no polling
console.log('QE-15 triggers:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=filter-row] button')].map(b => [b.textContent.trim().slice(0, 12), +b.getBoundingClientRect().width.toFixed(1), +b.getBoundingClientRect().height.toFixed(1)]).slice(0, 8)));
console.log('QE-6 new button:', await page.evaluate(() => { const b = [...document.querySelectorAll('a,button')].find(e => /New feedback/.test(e.textContent) && e.closest('header')); const r = b.getBoundingClientRect(); return [b.tagName, +r.width.toFixed(1), +r.height.toFixed(1), +r.right.toFixed(1), getComputedStyle(b).backgroundColor, document.querySelector('header').getBoundingClientRect().right]; }));
const n0 = calls.length; await page.waitForTimeout(12000); console.log('QE-23 requests during 12 s idle:', calls.length - n0);
await page.locator('[aria-label="Feedback requests"] [role=row] a').first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(800); console.log('QE-21 Enter ->', page.url().replace(BASE, ''));
await page.goBack(); await page.waitForTimeout(800); await page.locator('[aria-label="Feedback requests"] [role=row]').nth(2).click({ position: { x: 300, y: 10 } }); await page.waitForTimeout(800); console.log('QE-21 row click ->', page.url().replace(BASE, ''));
await page.goto(BASE + '/feedback?q=zzzzz'); await page.waitForTimeout(800); console.log('QE-127 filtered empty:', (await page.locator('[data-testid=feedback-list-page]').innerText()).match(/No requests match[^\n]*/)?.[0], '| clear link:', await page.getByRole('button', { name: /Clear filters/ }).or(page.getByRole('link', { name: /Clear filters/ })).count());
// QE-39/40 message heights & tool line on a draft with a tool step
await page.goto(BASE + '/feedback/' + ids.ui2); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(800);
console.log('QE-39/40 items:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] ol > li')].map(l => [l.getAttribute('data-role') || l.className.toString().slice(0, 24), +l.getBoundingClientRect().height.toFixed(1), l.innerText.replace(/\n+/g, ' / ').slice(0, 90)])));
// QE-38 not scrolling while scrolled up: use long draft
await page.goto(BASE + '/feedback/' + ids.long); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(800);
// (arabic script is config'd? send needs model) -> switch connection by API
await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ llm_base_url: 'http://127.0.0.1:10010/v1', llm_model: 'feedback:arabic', llm_api_key: '__KEEP__', draft_retention_days: 30, max_user_messages: 30 }) });
await page.evaluate(() => { document.querySelector('[data-testid=chat-log]').scrollTop = 300; }); await page.waitForTimeout(200);
const ta = page.getByLabel('Your reply'); await ta.fill('while scrolled up'); await ta.press('Enter'); await page.waitForTimeout(2500);
console.log('QE-38 scrolled-up stays:', await page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); return [Math.round(l.scrollTop), Math.round(l.scrollHeight - l.scrollTop - l.clientHeight)]; }));
await page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); l.scrollTop = l.scrollHeight; }); await page.waitForTimeout(300);
await ta.fill('at the bottom'); await ta.press('Enter'); await page.waitForTimeout(2500);
console.log('QE-38 at-bottom follows (dist to end):', await page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); return Math.round(l.scrollHeight - l.scrollTop - l.clientHeight); }));
await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ llm_base_url: 'http://127.0.0.1:10010/v1', llm_model: 'feedback:ask_then_propose', llm_api_key: '__KEEP__', draft_retention_days: 30, max_user_messages: 30 }) });
// QE-49 leave mid-turn then come back
const ar = await fetch('http://127.0.0.1:9010/v1/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'platform', message: 'leave mid turn test' }) }).then(r => r.json());
await page.goto(BASE + '/feedback/' + ar.id); await page.waitForTimeout(500); await page.goto(BASE + '/feedback'); await page.waitForTimeout(3500); await page.goto(BASE + '/feedback/' + ar.id); await page.waitForTimeout(1500);
console.log('QE-49 after leaving mid-turn:', (await page.locator('[data-testid=chat-log]').innerText()).replace(/\n+/g, ' | ').slice(-150));
// QE-139: aria-busy on streaming message
const br = await fetch('http://127.0.0.1:9010/v1/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'platform', message: 'busy test' }) }).then(r => r.json());
const p2 = page; await p2.goto(BASE + '/feedback/' + br.id); const seen = new Set();
for (let i = 0; i < 40; i++) { const v = await p2.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] ol > li')].map(l => l.getAttribute('aria-busy')).join(',') + '|' + document.querySelector('[data-testid=chat-status]')?.textContent); seen.add(v); await p2.waitForTimeout(80); }
console.log('QE-139 states seen:', [...seen]);
await browser.close();
