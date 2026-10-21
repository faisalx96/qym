/** QG1 inventory: every anchor that wraps more than one text (or is taller than 36 px), hovered, with its computed text-decoration
 *  and border / background before and after the hover. usage: node hover-inventory.mts [width] */
import { launch, newPage, save, VITE, SLUG } from './lib-qa.mts';
const width = Number(process.argv[2] ?? 1440);
const ALL = process.argv[3] === 'all';
const P = `${VITE}/projects/${SLUG}`;
const RUNS = ['b8b2eca0-e279-4baf-b915-330804f132c0', '5a94f68f-cbe6-472b-9a66-d0e747455b28'];
const URLS = process.argv[4] === 'runs' ? [`/projects/${SLUG}/runs/${RUNS[0]}`, `/projects/${SLUG}/compare?runs=${RUNS.join(',')}`, '/docs/get-started/first-run'].map((u) => VITE + u) : [
  '/', `/projects/${SLUG}`, `${P}/overview`, `${P}/charts`, `${P}/models`, `${P}/experiments`, `${P}/experiments/queue`,
  `${P}/environments`, `${P}/datasets`, `${P}/datasets/support-faq?tab=runs&v=v1`, `${P}/datasets/support-faq?tab=lineage&v=v1`,
  `${P}/datasets/support-faq?tab=items&v=v1`, `${P}/reviews`, `${P}/analysis`, '/docs', '/admin/runs', '/admin/projects', '/profile', '/trash',
].map((u) => (u.startsWith('http') ? u : VITE + u));
const b = await launch();
const out: Record<string, unknown[]> = {};
const { ctx, page } = await newPage(b, width);
for (const url of URLS) {
  await page.goto(url).catch(() => {});
  await page.waitForTimeout(1500);
  const found = await page.evaluate((ALL) => {
    const seen = new Set<string>();
    const res: { sel: string; text: string; w: number; h: number; href: string; kids: number; idx: number }[] = [];
    [...document.querySelectorAll('a[href]')].forEach((a, idx) => {
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height || a.closest('nav, aside, [class*=skip]')) return;
      const textKids = [...a.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())).length;
      if (!ALL && textKids < 2 && r.height < 37) return;
      const sel = a.tagName.toLowerCase() + '.' + String(a.className).split(' ')[0].replace(/_[a-z0-9]{5,}$/, '');
      const key = sel + new URL((a as HTMLAnchorElement).href).pathname.split('/').slice(0, 4).join('/');
      if (seen.has(key)) return;
      seen.add(key);
      res.push({ sel, text: (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50), w: +r.width.toFixed(0), h: +r.height.toFixed(0), href: (a as HTMLAnchorElement).getAttribute('href') ?? '', kids: textKids, idx });
    });
    return res;
  }, ALL);
  const rows: unknown[] = [];
  for (const f of found) {
    const loc = page.locator('a[href]').nth(f.idx);
    const style = () => loc.evaluate((a) => { const cs = getComputedStyle(a); return { deco: cs.textDecorationLine, border: cs.borderColor.split(' ')[0], bg: cs.backgroundColor, shadow: cs.boxShadow === 'none' ? 'none' : 'shadow' }; });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const rest = await style();
    await loc.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(350);
    const hover = await style();
    rows.push({ ...f, rest, hover });
  }
  out[url.replace(VITE, '')] = rows;
}
save(`hover-inventory-${ALL ? 'all-' : ''}${width}`, out);
for (const [u, rows] of Object.entries(out)) {
  console.log(u);
  for (const r of rows as { sel: string; text: string; w: number; h: number; kids: number; hover: { deco: string; border: string; bg: string; shadow: string }; rest: { border: string; bg: string; shadow: string } }[])
    console.log(`  ${r.sel} ${r.w}x${r.h} kids=${r.kids} deco=${r.hover.deco.split(' ')[0]} border ${r.rest.border}->${r.hover.border} bg ${r.rest.bg}->${r.hover.bg} shadow ${r.rest.shadow}->${r.hover.shadow} "${r.text}"`);
}
await ctx.close(); await b.close();
