/** WP-B re-review of the fix pass: F1, F2, B4-34, B5-65. */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL } from './review-lib.mts';
const b = await chromium.launch();
const ds = (page: any) => page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
const list = await (await fetch(`${APP}/v1/projects/${SEED.project_id}/experiments`, { headers: { 'X-User-Email': 'dev@local' } })).json();
const id = (n: string) => list.experiments.find((e: any) => e.name === n).id;
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  // F2: chip in the open list
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.staging}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await ds(page).click();
  R.listChip = await page.getByRole('option', { name: /secret-set/ }).locator('[data-testid="dataset-chip"]').evaluate((e: HTMLElement) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
  await page.getByRole('option', { name: /secret-set/ }).click();
  R.triggerChip = await ds(page).locator('[data-testid="dataset-chip"]').evaluate((e: HTMLElement) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
  // F1
  await page.getByRole('textbox', { name: 'Experiment name' }).fill('c');
  await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).check({ force: true });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Set ceiling' }).click();
  await page.waitForTimeout(1500);
  R.focus = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return { tag: a?.tagName, id: a?.id, name: a?.getAttribute('name'), label: (a as any)?.labels?.[0]?.textContent ?? a?.getAttribute('aria-label'), expanded: a?.closest('details')?.open ?? null, url: location.search }; });
  R.fieldVisible = await page.locator(':focus').evaluate((e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  // B4-34
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/${id('staging vs prod')}`);
  await page.getByTestId('token-notice').waitFor();
  await page.waitForTimeout(500);
  R.notice = await page.getByTestId('token-notice').locator('xpath=ancestor::*[@role="note"][1]').evaluate((e: HTMLElement) => ({ h: Math.round(e.getBoundingClientRect().height * 10) / 10, w: e.getBoundingClientRect().width }));
  // B5-65
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/queue`);
  await page.getByTestId('queue-latency-note').first().waitFor();
  R.notes = await page.getByTestId('queue-latency-note').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent, h: Math.round(e.getBoundingClientRect().height * 10) / 10, cardW: Math.round(e.closest('section,li,div[class*=card]')?.getBoundingClientRect().width ?? 0) })));
  await ctx.close();
}
save('rereview');
await b.close();
