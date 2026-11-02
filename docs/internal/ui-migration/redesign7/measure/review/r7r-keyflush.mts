/** Review fix pass (O2): wrapped key lines flush left, word breaks, fact label shots. Per [data-part=key] with 2+ lines: spread of the line rects' left edges (px) and where the breaks fall. */
import { BASE, r7, launch, newPage, STORAGE_INIT, shotsDir } from '../lib7.mts';
import path from 'node:path';
const browser = await launch();
const out: Record<string, unknown>[] = [];
for (const width of [1440, 390]) for (const item of ['j-01', 'j-03']) {
  const { page } = await newPage(browser, { width, height: 1000, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=${item}`);
  const card = page.locator(`[data-testid=item-card][data-item-id="${item}"]`);
  await card.waitFor();
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await card.locator('[data-cell^="schema_judge::"]').first().click();
  await card.getByTestId('metric-detail').waitFor();
  await page.waitForTimeout(600);
  const r = await page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    return Array.from(root.querySelectorAll<HTMLElement>('[data-part=key]')).map((k) => {
      const rg = document.createRange(); rg.selectNodeContents(k);
      const rects = Array.from(rg.getClientRects()).filter((x) => x.width > 0);
      const lines = new Map<number, { l: number; r: number }>();
      for (const x of rects) { const y = Math.round(x.top); const c = lines.get(y); lines.set(y, c ? { l: Math.min(c.l, x.left), r: Math.max(c.r, x.right) } : { l: x.left, r: x.right }); }
      const ls = [...lines.values()];
      const kr = k.getBoundingClientRect();
      return { key: (k.textContent || '').slice(0, 60), len: (k.textContent || '').length, lines: ls.length, leftSpread: ls.length ? Math.round((Math.max(...ls.map((x) => x.l)) - Math.min(...ls.map((x) => x.l))) * 10) / 10 : 0, leftOfBox: ls.length ? Math.round((Math.min(...ls.map((x) => x.l)) - kr.left) * 10) / 10 : 0, tag: k.tagName, inFacts: !!k.closest('dt'), html: k.innerHTML.slice(0, 0) };
    });
  }, `[data-testid=item-card][data-item-id="${item}"]`);
  out.push({ width, item, multi: r.filter((x) => x.lines > 1) });
  if (item === 'j-01') await card.getByTestId('metric-detail').screenshot({ path: path.join(shotsDir, `review2-d2-panel-en-${width}.png`) });
  if (item === 'j-03' && width === 390) await card.locator('[data-kind=output]').screenshot({ path: path.join(shotsDir, `review2-d2-output-ar-${width}.png`) });
  await page.close();
}
await browser.close();
for (const c of out) { console.log(c.width, c.item); for (const m of c.multi as Array<Record<string, unknown>>) console.log('  ', m.inFacts ? 'fact' : 'key ', m.lines, 'lines spread', m.leftSpread, 'leftOfBox', m.leftOfBox, m.key); }
