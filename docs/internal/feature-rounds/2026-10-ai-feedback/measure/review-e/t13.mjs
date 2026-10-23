import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback?q=zzzzz&status=new&sort=priority:desc'); await page.waitForTimeout(1200);
console.log('text:', (await page.locator('[aria-label="Feedback requests"]').innerText()).includes('No requests match.'), await page.getByRole('button', { name: 'Clear filters' }).count());
await page.getByRole('button', { name: 'Clear filters' }).click(); await page.waitForTimeout(800);
console.log('url after clear:', page.url().replace(BASE, ''), 'rows', await page.locator('[aria-label="Feedback requests"] [role=row]').count());
await browser.close();
