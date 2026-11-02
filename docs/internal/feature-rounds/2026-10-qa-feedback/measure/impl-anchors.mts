/** Lists the anchors of a page that have two or more texts or a box and underline on hover (QG1-11). */
import { launch, newPage, VITE } from './lib-qa.mts';
const b = await launch();
const { page } = await newPage(b, 1440, 900);
for (const p of process.argv.slice(2)) {
  await page.goto(VITE + p);
  await page.waitForTimeout(1200);
  const n = await page.locator('a').count();
  for (let i = 0; i < n; i++) {
    const a = page.locator('a').nth(i);
    const info = await a.evaluate((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const texts = Array.from(e.querySelectorAll('*')).filter((x) => x.children.length === 0 && (x.textContent ?? '').trim()).length; return { vis: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, texts, boxed: cs.borderTopWidth !== '0px' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)'), cls: e.className, href: e.getAttribute('href'), html: e.outerHTML.slice(0, 160) }; });
    if (!info.vis || !(info.texts >= 2 || info.boxed)) continue;
    await a.hover(); await page.waitForTimeout(150);
    const d = await a.evaluate((e) => [e, ...Array.from(e.querySelectorAll('*'))].map((x) => getComputedStyle(x).textDecorationLine).filter((x) => x !== 'none'));
    console.log(p, i, d.length ? 'UNDERLINE' : 'ok', info.texts, info.boxed, info.cls, info.href);
  }
}
await b.close();
