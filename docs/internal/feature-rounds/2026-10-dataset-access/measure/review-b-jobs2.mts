/** WP-B review: screenshots of the job history card and the blocked row clip (B4-37, B5-53). */
import { chromium, open, SEED, APP, out, save, shot, exp } from './review-lib.mts';
const ids: Record<string, string> = {};
const list = await (await fetch(`${APP}/v1/projects/${SEED.project_id}/experiments`, { headers: { 'X-User-Email': 'dev@local' } })).json();
for (const e of list.experiments) ids[e.name] = e.id;
const b = await chromium.launch();
for (const w of [1440, 390] as const) {
  const { ctx, page } = await open(b, w, 'dev@local', 1100);
  for (const [key, name] of [['lat', 'lat sweep'], ['blocked', 'blocked tok']] as const) {
    await page.goto(exp(SEED.slug, `/${ids[name]}`));
    await page.getByRole('region', { name: 'Credentials' }).waitFor();
    await page.waitForTimeout(800);
    const h = page.getByRole('heading', { name: /Job history/ });
    await h.scrollIntoViewIfNeeded();
    const y = await h.evaluate((e: HTMLElement) => e.getBoundingClientRect().y);
    await page.screenshot({ path: `${(await import('./review-lib.mts')).shotsDir}/review-jobs-card-${key}-${w}.png`, clip: { x: 0, y: Math.max(0, y - 20), width: w, height: Math.min(1000, 1100 - Math.max(0, y - 20)) } });
    if (w === 1440) out[`clip_${key}`] = await page.getByTestId('admission-line').evaluateAll((els: any[]) => els.map((e) => { const p = e.closest('[class*=secondary],div') as HTMLElement; let el: HTMLElement | null = e; const chain: any[] = []; for (let i = 0; i < 4 && el; i++, el = el.parentElement) { const cs = getComputedStyle(el); chain.push({ tag: el.tagName, w: Math.round(el.getBoundingClientRect().width), ov: cs.overflow, to: cs.textOverflow, ws: cs.whiteSpace }); } return { t: e.textContent.slice(0, 40), chain }; }));
  }
  await ctx.close();
}
save('jobs2');
await b.close();
