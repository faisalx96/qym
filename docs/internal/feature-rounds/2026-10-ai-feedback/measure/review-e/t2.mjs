import { open, ready, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
for (const ref of ['FB-0009', 'FB-0004', 'FB-0008']) {
  await page.goto(BASE + '/feedback/' + ref); await page.waitForSelector('[data-testid=feedback-request-page]'); await page.waitForTimeout(800);
  console.log(ref, await page.evaluate(() => [...document.querySelectorAll('[data-testid=feedback-request-page] [class*=callout], [data-testid=feedback-request-page] [class*=Callout]')].map(e => [e.getAttribute('role'), e.className.toString().slice(0, 30), e.innerText.replace(/\n+/g, ' / ')])));
  console.log((await page.locator('[data-testid=feedback-request-page]').innerText()).split('\n').slice(0, 14).join(' | '));
}
await browser.close();
