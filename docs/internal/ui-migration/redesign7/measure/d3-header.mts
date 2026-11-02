/**
 * D3: the sticky header line and the item bar against the table's own box (items table, page-scroller header, useStickyShift).
 *   WIDTH=1440 node d3-header.mts
 * With the header stuck (page scrolled 1,000 px into a 500-row page) and with item #2 open and the page scrolled so the item bar is stuck,
 * it records how far the header cells, their bottom line, the item bar and the pinned edge lines reach beyond the table card's box (left / right),
 * above the sticky line, and over the toolbar / footer. Every value must be 0 (px beyond the box).
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT } from './lib7.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const browser = await launch();
const { page } = await newPage(browser, { width: WIDTH, height: 900, init: [STORAGE_INIT] });
await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.big1200}`);
await page.getByTestId('items-count').waitFor();
await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
await page.waitForTimeout(600);
const measure = () => page.evaluate(() => {
  const R = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
  const card = document.querySelector('#run-items [data-testid=data-table]') as HTMLElement;
  const table = card.querySelector('table')!;
  const sc = document.getElementById('shell-content')!;
  const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
  const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
  const line = Math.max(nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top, filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0);
  const cr = R(card)!, tr = R(table)!, scr = R(card.querySelector('[data-dt-scroller]'))!;
  const ths = Array.from(table.querySelectorAll('thead th')).map((t) => t.getBoundingClientRect());
  const thead = R(table.querySelector('thead'))!;
  const bar = document.querySelector('[data-item-bar]');
  const bb = R(bar);
  const toolbar = Array.from(card.children).find((c) => /toolbar/i.test(c.className));
  const footer = card.querySelector('[class*="footer"]');
  const over = (a: number, b: number) => Math.round(Math.max(0, a - b) * 10) / 10;
  const headCell = table.querySelector('thead th') as HTMLElement;
  return {
    line: Math.round(line), stuck: table.hasAttribute('data-stuck'), held: table.hasAttribute('data-held'), shift: table.style.getPropertyValue('--head-shift'),
    headerTop: Math.round(thead.top), headerAboveLinePx: over(line, thead.top),
    headerLeftBeyondCardPx: over(cr.left, Math.min(...ths.map((t) => t.left))), headerRightBeyondScrollerPx: over(Math.max(...ths.map((t) => t.right)), scr.right + 0.5),
    headerBottomBorder: getComputedStyle(headCell).borderBottom,
    barLeftBeyondCardPx: bb ? over(cr.left, bb.left) : null, barRightBeyondCardPx: bb ? over(bb.right, cr.right + 0.5) : null, barTop: bb ? Math.round(bb.top) : null,
    overToolbarPx: toolbar ? over(Math.min(thead.bottom, toolbar.getBoundingClientRect().bottom), Math.max(thead.top, toolbar.getBoundingClientRect().top)) : 0,
    overFooterPx: footer ? over(Math.min(thead.bottom, footer.getBoundingClientRect().bottom), Math.max(thead.top, footer.getBoundingClientRect().top)) : 0,
    card: { l: Math.round(cr.left), r: Math.round(cr.right) }, scroller: { l: Math.round(scr.left), r: Math.round(scr.right) },
  };
});
const out: Record<string, unknown> = {};
await page.evaluate(() => { const sc = document.getElementById('shell-content')!; sc.scrollTop += 1000; });
await page.waitForTimeout(500);
out['header-stuck'] = await measure();
await page.getByRole('button', { name: 'Open item #2', exact: true }).click().catch(async () => {
  await page.evaluate(() => { const sc = document.getElementById('shell-content')!; sc.scrollTop = 0; });
});
await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Open item #2', exact: true }).click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(900);
await page.evaluate(() => { const sc = document.getElementById('shell-content')!; const bar = document.querySelector('[data-item-bar]') as HTMLElement | null; if (bar) sc.scrollTop += bar.getBoundingClientRect().top + 180; });
await page.waitForTimeout(500);
out['item-bar-stuck'] = await measure();
await browser.close();
save(`d3-header-${WIDTH}`, { width: WIDTH, states: out });
