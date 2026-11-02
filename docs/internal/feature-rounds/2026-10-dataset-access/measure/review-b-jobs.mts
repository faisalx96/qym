/** WP-B review: jobs table of the detail page (B5-50..B5-56, B4-37). */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL, overflow, shot, exp } from './review-lib.mts';
const ids: Record<string, string> = {};
const list = await (await fetch(`${APP}/v1/projects/${SEED.project_id}/experiments`, { headers: { 'X-User-Email': 'dev@local' } })).json();
for (const e of list.experiments) ids[e.name] = e.id;
const b = await chromium.launch();
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  for (const [key, name] of [['lat', 'lat sweep'], ['plain', 'timeout sweep'], ['blocked', 'blocked tok']] as const) {
    await page.goto(exp(SEED.slug, `/${ids[name]}`));
    await page.getByRole('region', { name: 'Credentials' }).waitFor();
    await page.waitForTimeout(900);
    const C: Record<string, any> = (R[key] = {});
    const grid = page.getByRole('grid').or(page.getByRole('table')).first();
    C.headers = await page.getByRole('columnheader').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10 })));
    C.rows = await page.getByRole('row').evaluateAll((els: any[]) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
    C.lines = await page.getByTestId('admission-line').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent, title: e.getAttribute('title'), cls: e.className.slice(0, 20), color: getComputedStyle(e).color, font: getComputedStyle(e).fontSize, clip: e.scrollWidth > e.clientWidth, w: Math.round(e.getBoundingClientRect().width) })));
    C.requeue = await page.getByTestId('requeue-tag').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent, aria: e.getAttribute('aria-label'), w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10, fam: getComputedStyle(e).fontFamily.slice(0, 14) })));
    C.statusCells = await page.getByRole('row').evaluateAll((els: any[]) => els.map((r) => { const c = [...r.querySelectorAll('[role=cell],td')].map((x: any) => x.textContent.trim().slice(0, 90)); return c.slice(0, 5).join(' | '); }));
    C.overflow = await overflow(page);
    await shot(page, `review-jobs-${key}-${w}`, 'main');
  }
  await ctx.close();
}
save('jobs');
await b.close();
