/** WP-B review: line boxes of the token warning at 1024 (B5-40). */
import { chromium, open, SEED, APP, out, save } from './review-lib.mts';
const b = await chromium.launch();
const ds = (page: any) => page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
for (const w of [1440, 1024]) {
  const { ctx, page } = await open(b, w);
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.production}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await ds(page).click(); await page.getByRole('option', { name: /secret-set/ }).click();
  await page.waitForTimeout(3500);
  const note = page.getByRole('note').filter({ hasText: 'Dataset read token will not be sent' });
  out[`w${w}`] = await note.evaluate((el: HTMLElement) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const kids = [...el.querySelectorAll('*')].map((k: any) => ({ tag: k.tagName, h: Math.round(k.getBoundingClientRect().height * 10) / 10, w: Math.round(k.getBoundingClientRect().width), cls: String(k.className).slice(0, 18), rects: k.getClientRects().length })); return { h: r.height, w: r.width, pad: cs.padding, gap: cs.gap, display: cs.display, kids }; });
  await ctx.close();
}
save('warn');
await b.close();
