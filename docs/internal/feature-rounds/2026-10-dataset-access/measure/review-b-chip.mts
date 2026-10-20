/** WP-B review: chip width in the open list vs the trigger (B4-22) and focus after "Set ceiling" (B5-39). */
import { chromium, open, SEED, APP, out, save } from './review-lib.mts';
const b = await chromium.launch();
const ds = (page: any) => page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
const { ctx, page } = await open(b, 1440);
await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.staging}`);
await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
await ds(page).click();
for (const wait of [100, 800, 2000]) {
  await page.waitForTimeout(wait);
  out[`list@${wait}`] = await page.getByRole('option', { name: /secret-set/ }).locator('[data-testid="dataset-chip"]').evaluate((e: HTMLElement) => ({ rect: e.getBoundingClientRect().width, offset: e.offsetWidth, transform: getComputedStyle(e.closest('[role=listbox]') ?? e).transform, anim: (e.closest('[role=listbox]')?.parentElement as HTMLElement | null)?.className }));
}
await page.getByRole('option', { name: /secret-set/ }).click();
await page.waitForTimeout(500);
out.trigger = await ds(page).locator('[data-testid="dataset-chip"]').evaluate((e: HTMLElement) => ({ rect: e.getBoundingClientRect().width, offset: e.offsetWidth }));
// set ceiling focus
await page.getByRole('textbox', { name: 'Experiment name' }).fill('c');
await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).check({ force: true });
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'Set ceiling' }).click();
for (const t of [300, 1000, 2500]) {
  await page.waitForTimeout(t);
  out[`focus@${t}`] = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a ? `${a.tagName} id=${a.id} name=${a.getAttribute('name') ?? ''} aria=${a.getAttribute('aria-label') ?? ''} label=${(a as any).labels?.[0]?.textContent ?? ''}` : ''; });
}
out.url = page.url();
out.ceilingField = await page.getByLabel(/EVAL_VLLM_POST_RUN_MAX_REQUESTS/).count();
save('chip');
await b.close();
