/** QG1: hover a link card and record text-decoration of the anchor and every descendant; screenshots current-hover-* (product) and mock-hover-* (gallery).
 *  usage: node hover-shots.mts current|mock */
import { launch, newPage, save, shotsDir, VITE, SLUG } from './lib-qa.mts';
import path from 'node:path';
const mode = process.argv[2] ?? 'current';
const RUN = 'b8b2eca0-e279-4baf-b915-330804f132c0';
const targets: { name: string; url: string; sel: string }[] =
  mode === 'current'
    ? [
        { name: 'project-card', url: '/', sel: 'a[data-project-card]' },
        { name: 'dataset-card', url: `/projects/${SLUG}/datasets`, sel: 'a[data-dataset-card="support-faq"]' },
        { name: 'docs-pager', url: '/docs/get-started/first-run', sel: 'nav[aria-label="Previous and next page"] a >> nth=-1' },
        { name: 'run-meta-link', url: `/projects/${SLUG}/runs/${RUN}`, sel: 'a[class*=metaLink] >> nth=1' },
        { name: 'inline-link', url: `/projects/${SLUG}/overview`, sel: 'a[class*=runName] >> nth=0' },
      ]
    : [
        { name: 'card', url: '/__ui#qa-datasets', sel: '[data-testid=demo-card-link]' },
        { name: 'pager', url: '/__ui#qa-datasets', sel: '[data-testid=demo-pager-link]' },
        { name: 'meta-link', url: '/__ui#qa-datasets', sel: '[data-testid=demo-meta-link]' },
        { name: 'plain-link', url: '/__ui#qa-datasets', sel: '[data-testid=demo-plain-link]' },
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
    const read = () => loc.evaluate((a) => {
      const cs = getComputedStyle(a);
      const kids = [...a.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()));
      const r = a.getBoundingClientRect();
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), deco: cs.textDecorationLine, kidsDeco: [...new Set(kids.map((k) => getComputedStyle(k).textDecorationLine))], textKids: kids.length, border: cs.borderColor, bg: cs.backgroundColor, shadow: cs.boxShadow === 'none' ? 'none' : 'yes', color: cs.color };
    });
    const rest = await read();
    await loc.hover();
    await page.waitForTimeout(400);
    const hover = await read();
    if (w === 1440) {
      const box = await loc.boundingBox();
      if (box) await page.screenshot({ path: path.join(shotsDir, `${mode}-hover-${t.name}-${w}.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(box.width + 16, 1000), height: box.height + 16 } });
    }
    out[`${t.name}-${w}`] = { rest, hover };
  }
  await ctx.close();
}
save(`hover-${mode}`, out);
console.log(JSON.stringify(out, null, 1));
await b.close();
