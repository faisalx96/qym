/** QG1 after-state: hover each block link and a plain link; text-decoration of the anchor and its texts; shots after-qa-hover-*.
 *  QYM_A_VITE=http://127.0.0.1:5983 node impl-hover.mts */
import { launch, newPage, save, shotsDir, VITE, SLUG } from './lib-qa.mts';
import path from 'node:path';
const targets = [
  { name: 'project-card', url: '/', sel: 'a[data-project-card]' },
  { name: 'dataset-card', url: `/projects/${SLUG}/datasets`, sel: 'a[data-dataset-card="support-faq"]' },
  { name: 'docs-pager', url: '/docs/get-started/first-run', sel: 'nav[aria-label="Previous and next page"] a >> nth=-1' },
  { name: 'plain-docs-link', url: '/docs/get-started/first-run', sel: 'article p a >> nth=0' },
];
const b = await launch();
const out: Record<string, unknown> = {};
for (const w of [1440, 390]) {
  const { ctx, page } = await newPage(b, w);
  for (const t of targets) {
    await page.goto(VITE + t.url);
    const loc = page.locator(t.sel).first();
    await loc.waitFor({ timeout: 15000 }).catch(() => {});
    if (!(await loc.count())) { out[`${t.name}-${w}`] = 'not rendered'; continue; }
    await loc.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await loc.hover();
    await page.waitForTimeout(400);
    const hover = await loc.evaluate((a) => {
      const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), deco: cs.textDecorationLine, inside: [...new Set([...a.querySelectorAll('*')].map((e) => getComputedStyle(e).textDecorationLine))], border: cs.borderTopColor, bg: cs.backgroundColor, shadow: cs.boxShadow === 'none' ? 'none' : 'yes', transform: cs.transform };
    });
    out[`${t.name}-${w}`] = hover;
    if (w === 1440) {
      const box = await loc.boundingBox();
      if (box) await page.screenshot({ path: path.join(shotsDir, `after-qa-hover-${t.name}-${w}.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(box.width + 16, 1000), height: box.height + 16 } });
    }
  }
  await ctx.close();
}
save('impl-hover', out);
console.log(JSON.stringify(out, null, 1));
await b.close();
