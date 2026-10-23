import { open, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
page.on('request', r => { if (r.method() === 'PUT') console.log('PUT key field =', JSON.parse(r.postData()).llm_api_key); });
await page.goto(BASE + '/admin/feedback'); await page.waitForSelector('[data-testid=connection]'); await page.waitForTimeout(500);
await page.locator('[data-testid=connection]').getByRole('button', { name: 'Save connection' }).click(); await page.waitForTimeout(800);
await browser.close();
