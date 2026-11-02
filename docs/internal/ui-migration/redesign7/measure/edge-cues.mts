/**
 * Q1 / D3 baseline: where the pinned-edge cues of the shared DataTable are drawn, against the table's own box and its text.
 *   TABLE=runs|items WIDTH=1440 node edge-cues.mts      (WIDTH 1440 | 1024 | 390; 390 = card mode, nothing is pinned)
 * For every state (rest, expanded group / expanded item, scrolled, scrolled to the end) it records
 *   - the boxes: card, toolbar, footer, bodyHost, scroller, first header row, last body row, mirrored scroll rail, expanded detail rows;
 *   - the cues: both `.edge` elements (rect, opacity, gradient, border), both `.bodyHost[data-cues]` pseudo-element fades
 *     (24 px, opacity .7, rect computed from the pins), and the `data-pin-edge` inset lines (computed shadow of the pinned cells);
 *   - extents: how far each cue reaches above the first header row / below the last body row / over the toolbar and footer / over the
 *     detail rows (the expanded item or the passes strip, which are not laid out in the columns);
 *   - glyph overlap: every text node inside the scroller is tested (Range rects) against each cue box; the px of text under a cue and
 *     the effective contrast of that text under the shade (alpha of the gradient at that x, WCAG ratio against the shaded background).
 * Hooks used today are class substrings (`[class*=edge]`); after the change the same numbers are read from `[data-edge-cue]` (must be 0).
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT, shotsDir } from './lib7.mts';
import path from 'node:path';
import { PROBE } from './edge-probe.mts';

const TABLE = (process.env.TABLE ?? 'runs') as 'runs' | 'items';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOTS = process.env.SHOTS ?? '';


function extents(p: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p) return null;
  const b = p.boxes;
  return p.cues.map((c: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    cue: c.kind, opacity: c.opacity, display: c.display, widthPx: Math.round(c.rect.w * 10) / 10,
    topAboveFirstHeaderPx: b.firstHeaderRow ? Math.round((b.firstHeaderRow.t - c.rect.t) * 10) / 10 : null, // > 0: the cue starts above the first header row
    bottomBelowLastRowPx: b.lastBodyRow ? Math.round((c.rect.b - b.lastBodyRow.b) * 10) / 10 : null, // > 0: the cue continues below the last body row
    heightPx: Math.round(c.rect.h), tableRowsBoxPx: b.firstHeaderRow && b.lastBodyRow ? Math.round(b.lastBodyRow.b - b.firstHeaderRow.t) : null,
    overDetailRows: b.details.filter((d: any) => Math.min(d.b, c.rect.b) - Math.max(d.t, c.rect.t) > 1 && c.opacity > 0.02 && c.display !== 'none').map((d: any) => ({ strip: d.strip, heightPx: Math.round(d.h) })), // eslint-disable-line @typescript-eslint/no-explicit-any
    overToolbar: b.toolbar ? Math.round(Math.max(0, Math.min(b.toolbar.b, c.rect.b) - Math.max(b.toolbar.t, c.rect.t))) : 0,
    overFooter: b.footer ? Math.round(Math.max(0, Math.min(b.footer.b, c.rect.b) - Math.max(b.footer.t, c.rect.t))) : 0,
  }));
}

const browser = await launch();
const { page } = await newPage(browser, { width: WIDTH, height: 1000, init: [STORAGE_INIT, PROBE] });
const states: Record<string, unknown> = {};
const probe = async (sel: string) => page.evaluate((s) => (window as any).__edge(s), sel); // eslint-disable-line @typescript-eslint/no-explicit-any
const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `${SHOTS}-${name}-${WIDTH}.png`), ...(clip ? { clip } : {}) });
};
const setScroll = async (sel: string, left: number | 'end') =>
  page.evaluate(([s, l]) => { const sc = document.querySelector(`${s} [data-dt-scroller]`) as HTMLElement | null; if (sc) sc.scrollLeft = l === 'end' ? sc.scrollWidth : Number(l); }, [sel, left] as const);

if (TABLE === 'runs') {
  const sel = '[data-testid="runs-table"]';
  await page.goto(`${BASE}/projects/${r7.slug}`);
  await page.locator(`${sel} tbody tr[data-run-id], ${sel} li[data-run-id]`).first().waitFor();
  await page.waitForTimeout(800);
  states['rest'] = await probe(sel);
  await shot('runs-rest');
  if (WIDTH >= 640) {
    // a short list: the cues keep their height while the rows end early (empty area below the last row)
    await page.getByPlaceholder('Search runs').fill(r7.repeat3[0].slice(0, 8));
    await page.waitForTimeout(1500);
    states['few-rows'] = await probe(sel);
    await shot('runs-few-rows');
    await page.getByPlaceholder('Search runs').fill('');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
    await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    states['group-open'] = await probe(sel);
    await shot('runs-group-open');
    await setScroll(sel, 600); await page.waitForTimeout(400);
    states['group-open-scrolled'] = await probe(sel);
    await shot('runs-group-open-scrolled');
    await setScroll(sel, 'end'); await page.waitForTimeout(400);
    states['group-open-end'] = await probe(sel);
  } else {
    await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    states['group-open'] = await probe(sel);
    await shot('runs-cards');
  }
} else {
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.big1200}`);
  await page.getByTestId('items-count').waitFor();
  await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
  await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
  await page.waitForTimeout(800);
  const sel = '[role=treegrid][aria-label=Items]';
  const hostSel = 'div:has(> [data-testid=data-table]) ';
  void hostSel;
  const probeItems = async () => page.evaluate(() => { const card = document.querySelector('#run-items [data-testid=data-table]') as HTMLElement; card.setAttribute('data-r7-probe', ''); return (window as any).__edge('[data-r7-probe]'); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  states['rest'] = await probeItems();
  await shot('items-rest');
  if (WIDTH >= 640) {
    await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
    await page.waitForTimeout(1200);
    states['detail-open'] = await probeItems();
    await shot('items-detail-open');
    await page.evaluate(() => { const sc = document.querySelector('[role=treegrid][aria-label=Items]')!.closest('[data-testid=data-table]')!.querySelector('[data-dt-scroller]') as HTMLElement; sc.scrollLeft = 260; });
    await page.waitForTimeout(400);
    states['detail-open-scrolled'] = await probeItems();
    await shot('items-detail-open-scrolled');
    await page.evaluate(() => { const sc = document.querySelector('[role=treegrid][aria-label=Items]')!.closest('[data-testid=data-table]')!.querySelector('[data-dt-scroller]') as HTMLElement; sc.scrollLeft = sc.scrollWidth; });
    await page.waitForTimeout(400);
    states['detail-open-end'] = await probeItems();
  } else {
    await shot('items-cards');
  }
}
await browser.close();
const out: Record<string, unknown> = {};
for (const [k, v] of Object.entries(states)) {
  const p = v as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  out[k] = p && { lines: p.lines, cueElementsLive: p.cueElementsLive, attrs: p.attrs, scrollLeft: p.scrollLeft, scrollW: p.scrollW, clientW: p.clientW, pinStart: p.boxes.pinStart, pinEnd: p.boxes.pinEnd, boxes: p.boxes, extents: extents(p), insetKinds: p.insetKinds, overlapSummary: p.overlapSummary, overlaps: p.overlaps };
}
save(`edge-${TABLE}-${WIDTH}`, { table: TABLE, width: WIDTH, states: out });
