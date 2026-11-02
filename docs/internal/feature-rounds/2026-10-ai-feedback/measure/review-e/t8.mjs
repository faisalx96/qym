import { open, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const { browser, page } = await open(1440);
for (const u of ['/feedback', '/feedback?sort=complexity:desc', '/feedback/new', '/feedback/' + ids.ui2, '/feedback/FB-0010', '/feedback/FB-0010?tab=conversation', '/admin/feedback']) {
  await page.goto(BASE + u); await page.waitForTimeout(1200);
  const r = await page.evaluate(() => { const t = document.body.innerText; const a = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap(e => [e.getAttribute('aria-label'), e.title, e.placeholder]).filter(Boolean); return [(t.match(/\bsize\b/gi) || []).length, a.filter(x => /\bsize\b/i.test(x))]; });
  console.log(u, JSON.stringify(r));
}
await browser.close();
