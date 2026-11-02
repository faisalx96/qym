/** WP-B review: review pane (B5-35..B5-42) and chip recipes (B4-22). */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL, shot } from './review-lib.mts';
const b = await chromium.launch();
const ds = (page: any) => page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.staging}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await page.getByRole('textbox', { name: 'Experiment name' }).fill('review pane');
  await ds(page).click(); await page.getByRole('option', { name: /golden/ }).click();
  const review = page.getByRole('complementary', { name: 'Review' });
  await page.waitForTimeout(3500);
  const rows = async () => review.getByLabel('Summary').evaluate((el: HTMLElement) => [...el.children].map((c) => ({ t: (c.textContent ?? '').trim().slice(0, 40), h: Math.round(c.getBoundingClientRect().height * 10) / 10 })));
  R.rowsOff = await rows();
  R.paneOff = await boxL(review);
  await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).check({ force: true });
  await page.waitForTimeout(3500);
  R.rowsOn = await rows();
  R.paneCeiling = await boxL(review);
  const note = (t: string) => review.getByRole('note').filter({ hasText: t });
  R.ceiling = await boxL(note('Post-run ceiling not set'));
  R.ceilingText = await note('Post-run ceiling not set').innerText();
  R.badge = await review.innerText().then((t: string) => t.split('\n').slice(0, 3));
  R.launchBtn = await page.getByRole('button', { name: /^Launch/ }).first().evaluate((e: any) => ({ dis: e.disabled, t: e.textContent }));
  R.problemsList = await review.getByRole('list', { name: 'Problems to fix' }).count();
  await shot(page, `review-pane-ceiling-${w}`, 'aside[aria-label="Review"]');
  // both warnings: add production (no token declared) with the private dataset
  await page.getByRole('checkbox', { name: /^production/ }).check({ force: true });
  await ds(page).click(); await page.getByRole('option', { name: /secret-set/ }).click();
  await page.waitForTimeout(3500);
  R.paneBoth = await boxL(review);
  R.tokenWarn = await boxL(note('Dataset read token will not be sent'));
  R.tokenWarnText = await note('Dataset read token will not be sent').innerText();
  R.order = await review.getByRole('note').evaluateAll((els: any[]) => els.map((e) => e.textContent.slice(0, 30) + '@' + Math.round(e.getBoundingClientRect().y)));
  R.badgeBoth = (await review.innerText()).split('\n').slice(0, 2);
  R.launchBoth = await page.getByRole('button', { name: /^Launch/ }).first().evaluate((e: any) => e.disabled);
  R.ceilingBoth = await boxL(note('Post-run ceiling not set'));
  await shot(page, `review-pane-both-${w}`, 'aside[aria-label="Review"]');
  // set ceiling button
  await note('Post-run ceiling not set').getByRole('button', { name: 'Set ceiling' }).click();
  await page.waitForTimeout(600);
  R.afterSetCeiling = { url: page.url().split('?').slice(1).join('?'), active: await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a ? a.tagName + ' ' + (a.getAttribute('aria-label') || a.id || '') : ''; }) };
  // chip recipes: trigger vs option (B4-22)
  await ctx.close();
}
{
  const { ctx, page } = await open(b, 1440);
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await ds(page).click(); await page.getByRole('option', { name: /secret-set/ }).click();
  const css = (loc: any) => loc.evaluate((e: HTMLElement) => { const c = getComputedStyle(e); return { w: e.getBoundingClientRect().width, ls: c.letterSpacing, pad: c.padding, tt: c.textTransform, fs: c.fontSize, fw: c.fontWeight, ff: c.fontFamily.slice(0, 12), cls: e.className, parent: e.parentElement?.className }; });
  out.triggerChip = await css(ds(page).locator('[data-testid="dataset-chip"]'));
  await ds(page).click();
  out.optionChip = await css(page.getByRole('option', { name: /secret-set/ }).locator('[data-testid="dataset-chip"]'));
  await ctx.close();
}
save('launch3');
await b.close();
