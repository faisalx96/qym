import { open, ready, BASE } from './lib.mjs';
const { browser, page } = await open(1024);
await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-table-frame]'); await page.waitForTimeout(1200); await ready(page);
await page.locator('[data-testid=feedback-table-frame]').screenshot({ path: process.cwd() + '/dl/l1024-after-table.png' });
await browser.close();
