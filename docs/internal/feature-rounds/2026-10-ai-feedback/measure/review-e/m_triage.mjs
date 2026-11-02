import { open, ready, rect, overflow, BASE } from './lib.mjs';
const ref = 'FB-0010';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  await page.goto(BASE + '/feedback/' + ref); await page.waitForSelector('[data-testid=triage]'); await page.waitForTimeout(900); await ready(page);
  const o = { w };
  o.triage = await rect(page, '[data-testid=triage]');
  o.head = await page.evaluate(() => document.querySelector('[data-testid=triage]').innerText.split('\n').slice(0, 2));
  o.controls = await page.evaluate(() => [...document.querySelectorAll('[data-testid=triage] button, [data-testid=triage] textarea, [data-testid=triage] input')].map(e => [(e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent).trim().slice(0, 22), e.tagName.toLowerCase(), +e.getBoundingClientRect().width.toFixed(1), +e.getBoundingClientRect().height.toFixed(1)]));
  // changes
  await page.locator('[data-testid=triage]').getByRole('button', { name: /^High|^Medium/ }).first().click().catch(() => {});
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/triage-${w}.png`, fullPage: true });
  await browser.close();
}
