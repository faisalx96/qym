import { open, ready, rect, overflow, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
let { browser, page } = await open(1440);
const fb = []; page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback') || u.pathname.startsWith('/v1/admin/feedback')) fb.push(u.pathname); });
for (const u of ['/', '/projects/support-agent/runs', '/docs']) { await page.goto(BASE + u); await page.waitForTimeout(1500); }
console.log('QE-4/170: feedback calls on /, runs, docs =', fb.length, fb);
await page.goto(BASE + '/'); await page.waitForTimeout(800);
await page.keyboard.press('Control+k'); await page.waitForTimeout(400); await page.keyboard.type('feedback'); await page.waitForTimeout(400);
console.log('QE-4 palette entries:', await page.locator('[role=option]').allInnerTexts().then(a => a.map(s => s.replace(/\n+/g, ' ')).slice(0, 5)));
await page.keyboard.press('Escape');
await page.goto(BASE + '/feedback/' + ids.asking); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(600);
// tab order: log -> composer
await page.locator('[data-testid=chat-log]').focus(); await page.keyboard.press('Tab'); console.log('QE-140 next tab after log:', await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.getAttribute('aria-label')));
console.log('QE-141 checklist list name:', await page.evaluate(() => { const l = document.querySelector('[data-testid=checklist] [aria-label="Information checklist"]'); return [l?.tagName, [...l.querySelectorAll('li')].map(li => li.textContent.replace(/\s+/g, ' ').slice(0, 40)).slice(0, 2)]; }));
console.log('QE-47 checklist animations/transitions:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=checklist] li, [data-testid=checklist] li *')].map(e => getComputedStyle(e)).filter(c => c.animationName !== 'none').length));
console.log('QE-36/37 discard btn variant: ', await page.getByRole('button', { name: 'Discard draft' }).count());
// QE-48 discard
await page.getByRole('button', { name: 'Discard draft' }).click(); const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')); console.log('QE-48 dialog:', (await dlg.innerText()).replace(/\n+/g, ' / '), '| focus', await page.evaluate(() => document.activeElement?.textContent)); await page.keyboard.press('Escape');
await browser.close();
({ browser, page } = await open(390));
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
await page.locator('[data-testid=filters-trigger]').click(); await page.waitForTimeout(500);
console.log('QE-16 drawer:', await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d && [d.getBoundingClientRect().width, d.innerText.replace(/\n+/g, ' | ').slice(0, 150)]; }));
await page.keyboard.press('Escape');
console.log('QE-19 card list:', await page.evaluate(() => { const ul = document.querySelector('ul[aria-label="Feedback requests"]'); const li = ul?.querySelectorAll(':scope > li'); return [ul?.tagName, li?.length, li && [...li].slice(0, 2).map(x => [+x.getBoundingClientRect().height.toFixed(1), x.innerText.replace(/\n+/g, ' / ').slice(0, 120)])]; }));
await browser.close();
