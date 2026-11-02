import { open, ready, rect, overflow, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const which = process.argv[2] ?? 'dup';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  await page.goto(BASE + '/feedback/' + ids[which]); await page.waitForSelector('[data-testid=proposal]'); await page.waitForTimeout(900); await ready(page);
  const o = { w, which };
  o.chat = await rect(page, '[data-testid=chat]'); o.log = await rect(page, '[data-testid=chat-log]');
  o.proposal = await rect(page, '[data-testid=proposal]');
  o.pinfo = await page.evaluate(() => { const p = document.querySelector('[data-testid=proposal]'); const lb = p.getAttribute('aria-labelledby'); const hd = lb && document.getElementById(lb); return { tone: p.className.toString().slice(0, 60), role: p.getAttribute('role'), tag: p.tagName, label: hd?.textContent, headingTabIndex: hd?.tabIndex, badge: p.innerText.split('\n').slice(0, 3) }; });
  o.order = await page.evaluate(() => { const p = document.querySelector('[data-testid=proposal]'); return [...p.querySelectorAll('input, textarea, button, a[href], [role=combobox], [aria-haspopup]')].map(e => (e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent || e.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 36) + '#' + e.tagName.toLowerCase()); });
  o.fields = await page.evaluate(() => { const p = document.querySelector('[data-testid=proposal]'); const f = (sel) => [...p.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]; }); return { inputs: f('input'), textareas: f('textarea'), selects: f('[aria-haspopup=listbox], select, button[class*=select], [role=combobox]'), buttons: [...p.querySelectorAll('button')].map(b => [b.textContent.trim(), +b.getBoundingClientRect().width.toFixed(1), +b.getBoundingClientRect().height.toFixed(1)]) }; });
  o.related = await rect(page, '[data-testid=proposal] [data-testid=related]');
  o.relItems = await page.evaluate(() => [...document.querySelectorAll('[data-testid=proposal] [data-testid=related] li')].map(e => [+e.getBoundingClientRect().height.toFixed(1), e.innerText.replace(/\n+/g, ' / ').slice(0, 160)]));
  o.callouts = await page.evaluate(() => [...document.querySelectorAll('[data-testid=proposal] [role=status], [data-testid=proposal] [role=alert]')].map(e => [e.getAttribute('role'), e.innerText.replace(/\n+/g, ' / ').slice(0, 220)]));
  o.help = await page.evaluate(() => document.querySelector('[data-testid=proposal]').innerText.replace(/\n+/g, ' | ').slice(0, 1800));
  o.corrected = await page.evaluate(() => [...document.querySelectorAll('[data-testid=chat-log] li')].map(l => l.innerText.replace(/\n+/g, ' / ')).filter(t => /does not exist|removed/i.test(t)));
  o.overflow = await overflow(page);
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/prop-${which}-${w}.png`, fullPage: true });
  await browser.close();
}
