import { open, ready, rect, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
await page.locator('[data-testid=filter-row]').getByRole('button', { name: /Status/ }).click(); await page.waitForTimeout(300);
await page.getByRole('dialog').getByText('Accepted', { exact: true }).click(); await page.waitForTimeout(600); console.log('url:', page.url().replace(BASE, ''), 'rows', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
await page.keyboard.press('Escape');
await page.getByRole('radio', { name: 'Mine' }).click().catch(async () => page.getByText('Mine', { exact: true }).click()); await page.waitForTimeout(600); console.log('url mine:', page.url().replace(BASE, ''));
await page.goto(BASE + '/feedback?sort=priority:desc'); await page.waitForTimeout(800); console.log('priority:desc order:', await page.locator('[aria-label="Feedback requests"] [role=row]').evaluateAll(rs => rs.slice(1, 6).map(r => r.innerText.replace(/\n+/g, ' ').slice(0, 60))));
// discard 1-message draft -> no dialog
await page.goto(BASE + '/feedback'); await page.waitForTimeout(800);
const items = page.locator('[data-testid=drafts-strip] li'); const n = await items.count();
for (let i = 0; i < n; i++) { const t = await items.nth(i).innerText(); if (/1 message\b/.test(t)) { await items.nth(i).getByRole('button', { name: /^Discard/ }).click(); await page.waitForTimeout(700); console.log('1-message discard: dialog?', await page.getByRole('alertdialog').or(page.getByRole('dialog')).count(), 'strip now', await page.locator('[data-testid=drafts-strip] li').count()); break; } }
const it2 = page.locator('[data-testid=drafts-strip] li').first(); const t2 = await it2.innerText(); await it2.getByRole('button', { name: /^Discard/ }).click(); await page.waitForTimeout(500);
const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')); console.log('2-message discard dialog:', (await dlg.innerText()).replace(/\n+/g, ' / '), '| focused:', await page.evaluate(() => document.activeElement?.textContent));
await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); console.log('focus stays in dialog:', await page.evaluate(() => !!document.activeElement?.closest('[role=alertdialog],[role=dialog]')));
await page.keyboard.press('Escape'); await page.waitForTimeout(300); console.log('Escape closes, focus returns to:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent));
await browser.close();
