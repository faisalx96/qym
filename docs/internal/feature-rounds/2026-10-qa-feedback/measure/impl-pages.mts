/** The five composed surfaces as real pages: shots/after-page-<surface>-<1440|390>.png (compare with mock-page-*).
 *  QYM_A_VITE=http://127.0.0.1:5983 node impl-pages.mts   (seed: seed-members.py + seed-qa-a.mts on the platform) */
import { launch, newPage, datasetUrl, shotsDir, VITE, SLUG } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
// [surface, width, height]
const JOBS: [string, number, number][] = [
  ['access', 1440, 1154], ['access', 390, 2443],
  ['settings', 1440, 900], ['settings', 390, 1150],
  ['filter-popover', 1440, 900], ['filter-popover', 390, 1995],
  ['filter-chips', 1440, 900], ['filter-chips', 390, 2059],
  ['catalog', 1440, 900], ['catalog', 390, 1035],
];
for (const [surface, w, h] of JOBS) {
  const { ctx, page } = await newPage(b, w, h);
  if (surface === 'access') await page.goto(datasetUrl('legal-clauses', 'access'));
  else if (surface === 'settings') await page.goto(datasetUrl('support-faq', 'settings'));
  else if (surface === 'filter-popover') await page.goto(datasetUrl('support-faq', 'items'));
  else if (surface === 'filter-chips') await page.goto(datasetUrl('support-faq', 'items', '&meta=tags:billing&meta=tags:refund&meta_mode=tags:any&meta=domain:finance'));
  else await page.goto(`${VITE}/projects/${SLUG}/datasets`);
  await page.waitForTimeout(1200);
  if (surface === 'filter-popover') {
    await page.click('[data-testid=metadata-filter]');
    await page.waitForSelector('[data-testid=facet-values]');
    await page.click('[data-testid=meta-popover] button[aria-haspopup]');
    await page.getByRole('option', { name: /^tags/ }).click();
    await page.getByTestId('facet-values').getByRole('option', { name: /billing/ }).click();
    await page.getByTestId('facet-values').getByRole('option', { name: /refund/ }).click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(shotsDir, `after-page-${surface}-${w}.png`) });
  await ctx.close();
}
await b.close();
console.log('ok');
