/**
 * Review (round 7), Q1-2 / D3-1 / D3-3 / D3-4 / D3-7 measured independently of the designer's probe (which tests glyphs against cue boxes and is trivially 0 once the cues are gone):
 * for every text node inside the table's scroller, in every state, `document.elementFromPoint` at the centre of each of its client rects (visible part only). The stacked element must be the
 * text's own ancestor / descendant. Otherwise it is classed `pinnedCell` (an opaque frozen cell legitimately hides content that scrolled under it) or `overlay` (anything else: a violation).
 * Also: elements with a gradient background or `opacity < 1` that are not a text's own element and cover a text point; every `[data-edge]` element in the card (nested tables included);
 * `elementsFromPoint` at the pinned boundary x for 5 y samples inside an open item (D3-3), and 1 px outside the card at 20 y samples (D3-7).
 *   TABLE=runs|items WIDTH=1440 node r7r-cover.mts
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT, shotsDir } from '../lib7.mts';
import path from 'node:path';

const TABLE = (process.env.TABLE ?? 'runs') as 'runs' | 'items';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOT = process.env.SHOT ?? '';
const PROBE = `
const visibleGradient = (e) => { const bi = getComputedStyle(e).backgroundImage; return /gradient/.test(bi) && !/^(linear-gradient\\(rgba\\(0, 0, 0, 0\\), rgba\\(0, 0, 0, 0\\)\\)(, )?)+(none)?$/.test(bi.replace(/, none$/, '')); };
window.__cover = (cardSel) => {
  const card = document.querySelector(cardSel);
  const sc = card.querySelector('[data-dt-scroller]');
  const scr = sc.getBoundingClientRect();
  const vis = { l: Math.max(scr.left, 0), r: Math.min(scr.right, innerWidth), t: Math.max(scr.top, 0), b: Math.min(scr.bottom, innerHeight) };
  const walker = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
  let tested = 0, hidden = 0, outsideCard = 0, stickyHeader = 0; const bad = []; const pinned = {}; const overlayKinds = {};
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const owner = el.closest('td,th,dd,dt') || el; const orc = owner.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      for (const f of [0.15, 0.5, 0.85]) {
        const x = r.left + r.width * f, y = r.top + r.height / 2;
        if (x < vis.l + 1 || x > vis.r - 1 || y < vis.t + 1 || y > vis.b - 1) continue;
        if (x < orc.left || x > orc.right || y < orc.top || y > orc.bottom) continue; // text clipped by its own cell is not covered by anything
        tested++;
        const top = document.elementFromPoint(x, y);
        if (!top || top.contains(el) || el.contains(top)) continue;
        if (!card.contains(top)) { outsideCard++; continue; } // the page's own sticky chrome (top bar, run nav, filters), not a table line
        if (top.closest('thead, [data-item-bar]')) { stickyHeader++; continue; } // the sticky table header / item bar legitimately cover what scrolled under them
        const pin = top.closest('[data-pin]');
        if (pin) { hidden++; const k = (pin.tagName + ':' + (pin.getAttribute('data-pin') || '')); pinned[k] = (pinned[k] || 0) + 1; continue; }
        const key = top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0];
        overlayKinds[key] = (overlayKinds[key] || 0) + 1;
        if (bad.length < 12) bad.push({ text: n.textContent.trim().slice(0, 30), x: Math.round(x), y: Math.round(y), over: key, bg: getComputedStyle(top).backgroundImage.slice(0, 60), op: getComputedStyle(top).opacity });
      }
    }
  }
  const edges = card.querySelectorAll('[data-edge]').length;
  const gradients = Array.from(card.querySelectorAll('*')).filter((e) => visibleGradient(e) && !e.closest('[class*=scoreBar],[class*=bar],[class*=sparkline],[class*=track],[class*=fill]')).length;
  const pseudoFades = ['::before', '::after'].map((p) => { const h = card.querySelector('[data-cues]'); return h ? getComputedStyle(h, p).content : 'none'; });
  return { tested, coveredByPinnedCell: hidden, coveredByPageChrome: outsideCard, coveredByStickyHeaderOrBar: stickyHeader, coveredByOverlay: Object.values(overlayKinds).reduce((a, b) => a + b, 0), overlayKinds, pinned, bad, dataEdgeElements: edges, gradientElements: gradients, pseudoFades };
};
window.__stack = (cardSel) => {
  const card = document.querySelector(cardSel);
  const sc = card.querySelector('[data-dt-scroller]');
  const cr = card.getBoundingClientRect();
  const res = { insideDetail: [], outsideCard: { left: 0, right: 0, bottom: 0, samples: 0 } };
  const edgeCell = card.querySelector('td[data-pin-edge=start], th[data-pin-edge=start]');
  const bx = edgeCell ? edgeCell.getBoundingClientRect().right - 1 : null;
  const det = card.querySelector('tr[data-detail-row]');
  if (det && bx != null) {
    const dr = det.getBoundingClientRect();
    const ys = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.max(0, Math.min(innerHeight - 1, dr.top + dr.height * f)));
    for (const y of ys) {
      if (y < 0 || y > innerHeight) continue;
      for (const x of [bx, bx + 1]) {
        const st = document.elementsFromPoint(x, y).filter((e) => card.contains(e));
        const edges = st.filter((e) => e.matches('[data-pin-edge], [data-edge]') && !det.contains(e)).length;
        const grads = st.filter((e) => visibleGradient(e)).length;
        res.insideDetail.push({ x: Math.round(x), y: Math.round(y), pinnedEdgeCells: edges, gradients: grads });
      }
    }
  }
  const ys = Array.from({ length: 20 }, (_, i) => Math.max(cr.top, 0) + 2 + (i / 19) * (Math.min(cr.bottom, innerHeight) - Math.max(cr.top, 0) - 4));
  for (const y of ys) {
    for (const [side, x] of [['left', cr.left - 1.5], ['right', cr.right + 1.5]]) {
      if (x < 0 || x > innerWidth) continue;
      res.outsideCard.samples++;
      const st = document.elementsFromPoint(x, y).filter((e) => card.contains(e));
      if (st.length) res.outsideCard[side]++;
    }
  }
  return res;
};
`;
const browser = await launch();
const { page } = await newPage(browser, { width: WIDTH, height: 1000, init: [STORAGE_INIT, PROBE] });
const out: Record<string, unknown> = {};
const run = async (name: string, sel: string) => { out[name] = { cover: await page.evaluate((s) => (window as any).__cover(s), sel), stack: await page.evaluate((s) => (window as any).__stack(s), sel) }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const setScroll = async (sel: string, left: number | 'end') => page.evaluate(([s, l]) => { const sc = document.querySelector(`${s} [data-dt-scroller]`) as HTMLElement; sc.scrollLeft = l === 'end' ? sc.scrollWidth : Number(l); }, [sel, left] as const);
if (TABLE === 'runs') {
  const sel = '[data-testid="runs-table"]';
  await page.goto(`${BASE}/projects/${r7.slug}`);
  await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
  await page.waitForTimeout(800);
  await run('rest', sel);
  await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
  await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await run('group-open', sel);
  await setScroll(sel, 600); await page.waitForTimeout(300); await run('group-open-scrolled-600', sel);
  await setScroll(sel, 'end'); await page.waitForTimeout(300); await run('group-open-end', sel);
  // the strip row: its statistics must be stacked on themselves (sideways scroll at 0 again)
  await setScroll(sel, 0); await page.waitForTimeout(300);
  out['strip'] = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="runs-table"] tr[data-strip-row]') as HTMLElement;
    const stats = Array.from(strip.querySelectorAll('dd, dt')).map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: (e.textContent || '').trim().slice(0, 14), own: !!top && (top === e || e.contains(top) || top.contains(e)) }; });
    return { stats: stats.length, covered: stats.filter((s) => !s.own).length };
  });
  if (SHOT) await page.screenshot({ path: path.join(shotsDir, `${SHOT}-runs-strip-${WIDTH}.png`), clip: { x: 200, y: 560, width: 1210, height: 80 } });
} else {
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.big1200}`);
  await page.getByTestId('items-count').waitFor();
  await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
  await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
  await page.waitForTimeout(800);
  const sel = '#run-items [data-testid=data-table]';
  await run('rest', sel);
  await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
  await page.waitForTimeout(1200);
  await run('detail-open', sel);
  await setScroll(sel, 260); await page.waitForTimeout(300); await run('detail-open-scrolled-260', sel);
  await setScroll(sel, 'end'); await page.waitForTimeout(300); await run('detail-open-end', sel);
  await setScroll(sel, 260); await page.evaluate(() => { document.getElementById('shell-content')!.scrollTop += 300; }); await page.waitForTimeout(400); await run('detail-open-scrolled-260-page-300', sel);
}
await browser.close();
save(`r7r-cover-${TABLE}-${WIDTH}`, out);
