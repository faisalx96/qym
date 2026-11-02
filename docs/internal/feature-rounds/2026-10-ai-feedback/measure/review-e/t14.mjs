import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440, { headers: { 'X-User-Email': 'dev@local' } });
await page.goto('http://127.0.0.1:6019/admin/feedback'); await page.waitForTimeout(2000);
console.log((await page.locator('[data-testid=connection]').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
console.log('save disabled:', await page.getByRole('button', { name: 'Save connection' }).isDisabled(), '| callouts:', await page.evaluate(() => [...document.querySelectorAll('[class*=callout]')].map(e => e.innerText.replace(/\n/g, ' / ').slice(0, 160))));
await browser.close();
