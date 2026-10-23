import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
await page.locator('[data-testid=filter-row]').getByRole('button', { name: /Status/ }).click(); await page.waitForTimeout(400);
console.log(await page.evaluate(() => [...document.querySelectorAll('[role=listbox], [role=menu], [role=dialog], [role=group]')].map(e => [e.getAttribute('role'), e.innerText.slice(0, 80).replace(/\n/g, ' '), [...e.querySelectorAll('[role]')].map(x => x.getAttribute('role')).slice(0, 5)])));
await browser.close();
