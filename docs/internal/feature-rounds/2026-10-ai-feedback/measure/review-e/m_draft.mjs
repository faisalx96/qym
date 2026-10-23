import { open, ready, rect, overflow, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const which = process.argv[2] ?? 'asking';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname); });
  await page.goto(BASE + '/feedback/' + ids[which]); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(900); await ready(page);
  const o = { w, which };
  o.page = await rect(page, '[data-testid=feedback-chat-page]');
  o.header = await page.evaluate(() => { const h = document.querySelector('[data-testid=feedback-chat-page] h1').closest('header'); const r = h.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), h.innerText.replace(/\n+/g, ' | ')]; });
  o.chat = await rect(page, '[data-testid=chat]');
  o.chatRole = await page.evaluate(() => { const c = document.querySelector('[data-testid=chat]'); return [c.getAttribute('role'), c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')]; });
  o.log = await rect(page, '[data-testid=chat-log]');
  o.logAttrs = await page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); return { role: l.getAttribute('role'), live: l.getAttribute('aria-live'), rel: l.getAttribute('aria-relevant'), label: l.getAttribute('aria-label'), tab: l.tabIndex, busy: l.getAttribute('aria-busy') }; });
  o.msgs = await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] > *')].map(e => [e.tagName, e.getAttribute('data-role') || e.className.toString().slice(0, 30), +e.getBoundingClientRect().height.toFixed(1)]));
  o.composer = await page.evaluate(() => { const t = document.querySelector('[data-testid=chat] textarea'); const c = t.closest('form') ?? t.parentElement.parentElement; const r = c.getBoundingClientRect(); const tr = t.getBoundingClientRect(); return { box: [+r.width.toFixed(1), +r.height.toFixed(1)], ta: [+tr.width.toFixed(1), +tr.height.toFixed(1), t.rows], desc: t.getAttribute('aria-describedby'), hint: t.getAttribute('aria-describedby') && document.getElementById(t.getAttribute('aria-describedby').split(' ')[0])?.innerText }; });
  o.checklist = await rect(page, '[data-testid=checklist]');
  o.checklistInfo = await page.evaluate(() => { const c = document.querySelector('[data-testid=checklist]'); const list = c.querySelector('ul,ol'); return { listLabel: list?.getAttribute('aria-label'), role: list?.getAttribute('role'), items: [...c.querySelectorAll('li')].map(li => [+li.getBoundingClientRect().height.toFixed(1), li.innerText.replace(/\n+/g, ' / ').slice(0, 90), li.textContent.replace(/\s+/g, ' ').slice(0, 120)]) , title: c.innerText.split('\n').slice(0, 2) }; });
  o.checklistBeforeChat = await page.evaluate(() => { const c = document.querySelector('[data-testid=checklist]').getBoundingClientRect(), ch = document.querySelector('[data-testid=chat]').getBoundingClientRect(); return c.top < ch.top ? 'above' : (c.left > ch.left ? 'right' : 'below'); });
  o.proposal = await rect(page, '[data-testid=proposal]');
  o.overflow = await overflow(page);
  o.calls = calls; o.doctitle = await page.title();
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/draft-${which}-${w}.png`, fullPage: true });
  await browser.close();
}
