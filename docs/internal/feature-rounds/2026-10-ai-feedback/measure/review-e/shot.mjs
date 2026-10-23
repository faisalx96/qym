import { open, ready, BASE } from './lib.mjs';
const [,, url, w, out, clip] = process.argv;
const { browser, page } = await open(+w);
await page.goto(BASE + url); await page.waitForTimeout(1200); await ready(page);
await page.screenshot({ path: out, fullPage: !clip });
await browser.close();
