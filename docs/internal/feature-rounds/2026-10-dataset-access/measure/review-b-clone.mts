/** WP-B review: clone carries the flag (B5-16) and reload behaviour (B5-31). */
import { chromium, open, SEED, APP, out, save } from './review-lib.mts';
const list = await (await fetch(`${APP}/v1/projects/${SEED.project_id}/experiments`, { headers: { 'X-User-Email': 'dev@local' } })).json();
const id = (n: string) => list.experiments.find((e: any) => e.name === n).id;
const b = await chromium.launch();
const { ctx, page } = await open(b, 1440);
for (const [k, n] of [['latClone', 'lat sweep'], ['plainClone', 'timeout sweep']] as const) {
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&clone=${id(n)}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await page.waitForTimeout(1500);
  out[k] = await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).isChecked();
}
await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&clone=${id('lat sweep')}`);
await page.waitForTimeout(1500);
await page.reload(); await page.waitForTimeout(1500);
out.afterReload = await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).isChecked();
// manual check then reload
await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.staging}`);
await page.getByRole('textbox', { name: 'Experiment name' }).fill('draft');
await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).check({ force: true });
await page.reload(); await page.waitForTimeout(1500);
out.manualAfterReload = await page.getByRole('checkbox', { name: 'Latency-sensitive run' }).isChecked();
out.nameAfterReload = await page.getByRole('textbox', { name: 'Experiment name' }).inputValue();
save('clone');
await b.close();
