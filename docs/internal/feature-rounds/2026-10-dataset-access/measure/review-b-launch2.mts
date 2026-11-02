/** WP-B review: open dataset list (B4-22) and the blocking review item (B5-37, B5-38). */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL, shot } from './review-lib.mts';
const b = await chromium.launch();
for (const w of [1440, 390] as const) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  const dsBtn = page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
  await dsBtn.click();
  await page.waitForTimeout(400);
  const opt = page.getByRole('option', { name: /secret-set/ });
  R.optionBox = await boxL(opt);
  R.optionChip = await boxL(opt.locator('[data-testid="dataset-chip"]'));
  R.optionChipScroll = await opt.locator('[data-testid="dataset-chip"]').evaluate((e: HTMLElement) => ({ sw: e.scrollWidth, cw: e.clientWidth, ws: getComputedStyle(e).whiteSpace }));
  R.optionNameBox = await boxL(opt.locator('span').first());
  await page.screenshot({ path: `${(await import('./review-lib.mts')).shotsDir}/review-dataset-list-${w}.png`, clip: { x: 0, y: 0, width: w, height: 800 } });
  await page.keyboard.press('Escape');
  await ctx.close();
}
{
  const { ctx, page } = await open(b, 1440, 'alice@x.test');
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.production}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await page.getByRole('textbox', { name: 'Experiment name' }).fill('blocked by gate');
  await page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first().click();
  await page.getByRole('option', { name: /golden/ }).click();
  const cb = page.getByRole('checkbox', { name: 'Latency-sensitive run' });
  const R: Record<string, any> = (out.gate = {});
  R.disabledWhenOnlyProd = await cb.isDisabled();
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.production}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  // both envs: staging is member-level, production managers-only
  await page.getByRole('checkbox', { name: /^staging/ }).check({ force: true });
  await page.getByRole('textbox', { name: 'Experiment name' }).fill('blocked by gate');
  await page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first().click();
  await page.getByRole('option', { name: /golden/ }).click();
  await cb.check({ force: true });
  await page.waitForTimeout(3500);
  const review = page.locator('main');
  R.pane = (await review.innerText()).split('\n').filter((l: string) => /problem|Ready|Latency|Summary|Checking|Launch/i.test(l));
  const launchBtns = await page.getByRole('button', { name: /^Launch$/ }).evaluateAll((els: any[]) => els.map((e) => ({ dis: e.disabled || e.getAttribute('aria-disabled'), t: e.textContent })));
  R.launchBtns = launchBtns;
  R.item = await boxL(page.getByRole('button', { name: /Latency-sensitive.*need a project manager/ }));
  await shot(page, 'review-launch-blocking-1440');
  await page.getByRole('button', { name: /Latency-sensitive.*need a project manager/ }).click();
  await page.waitForTimeout(300);
  R.active = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a ? a.tagName + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.closest('[data-testid]')?.getAttribute('data-testid') ?? '') : null; });
  await cb.uncheck({ force: true });
  await page.waitForTimeout(3500);
  R.afterClear = (await review.innerText()).includes('need a project manager');
  R.launchAfterClear = await page.getByRole('button', { name: /^Launch$/ }).evaluateAll((els: any[]) => els.map((e) => e.disabled));
  await ctx.close();
}
save('launch2');
await b.close();
