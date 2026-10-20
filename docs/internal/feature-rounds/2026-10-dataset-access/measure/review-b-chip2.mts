import { chromium, open, SEED, APP, out, save } from './review-lib.mts';
const b = await chromium.launch();
const ds = (page: any) => page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
const { page } = await open(b, 1440);
await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where&env=${SEED.envs.staging}`);
await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
await ds(page).click();
const f = (sel: string) => page.evaluate(() => {
  const e = [...document.querySelectorAll('[data-testid=dataset-chip]')].map((c) => { const cs = getComputedStyle(c); return { w: (c as HTMLElement).offsetWidth, ff: cs.fontFamily, fv: cs.fontVariationSettings, fs: cs.fontSize, fw: cs.fontWeight, fst: cs.fontStretch, ls: cs.letterSpacing, ws: cs.wordSpacing, tr: cs.textRendering, kern: cs.fontKerning, ctx: (c.closest('[role=option]') ? 'option' : 'trigger') }; });
  return e;
}); 
out.a = await f('');
await page.getByRole('option', { name: /secret-set/ }).click();
out.b = await f('');
save('chip2'); await b.close();
