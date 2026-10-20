import { BASE, r7, launch, newPage, STORAGE_INIT } from '../lib7.mts';
const browser = await launch();
const { page } = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT] });
await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.big1200}`);
await page.getByTestId('items-count').waitFor();
await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const card = document.querySelector('#run-items [data-testid=data-table]')!;
  const els = Array.from(card.querySelectorAll('*')).filter((e) => /gradient/.test(getComputedStyle(e).backgroundImage) && !/^(linear-gradient\(rgba\(0, 0, 0, 0\), rgba\(0, 0, 0, 0\)\)(, )?)+(none)?$/.test(getComputedStyle(e).backgroundImage.replace(/, none$/, '')));
  const kinds: Record<string, number> = {};
  for (const e of els) { const k = e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' parent=' + String(e.parentElement?.className).split(' ')[0] + ' | ' + getComputedStyle(e).backgroundImage.slice(0, 70); kinds[k] = (kinds[k] || 0) + 1; }
  return kinds;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
