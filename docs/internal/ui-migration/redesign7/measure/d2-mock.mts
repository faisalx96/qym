/**
 * D2 / Q1 / D3 on the gallery mocks (`/__ui#round7`, Vite dev server): the numbers the specified recipe gives, measured with the same probes
 * as the shipped UI (d2-probe.mts, edge-cues.mts). The implementation must reproduce them on the real components.
 *   VITE=http://127.0.0.1:5971 WIDTHS=1440,1024,390 node d2-mock.mts
 */
import { launch, newPage, save, shotsDir } from './lib7.mts';
import { MEASURE } from './d2-probe.mts';
import path from 'node:path';

const VITE = process.env.VITE ?? 'http://127.0.0.1:5971';
const WIDTHS = (process.env.WIDTHS ?? '1440,1024,390').split(',').map(Number);
const SHOTS = process.env.SHOTS ?? ''; // e.g. "mock"

const ROOTS: Array<{ id: string; sel: string; kind: 'tree' | 'sections' | 'facts' }> = [
  { id: 'tree-collapsed-en', sel: '[aria-label="Output key tree, collapsed (specified)"]', kind: 'tree' },
  { id: 'tree-open-en', sel: '[aria-label="Output key tree, open (specified)"]', kind: 'tree' },
  { id: 'tree-collapsed-ar', sel: '[aria-label="Arabic key tree, collapsed (specified)"]', kind: 'tree' },
  { id: 'tree-open-ar', sel: '[aria-label="Arabic key tree, open (specified)"]', kind: 'tree' },
  { id: 'sections-expected', sel: '[aria-label="Expected output (specified)"]', kind: 'sections' },
  { id: 'facts-en', sel: '[aria-label="schema_judge details (specified)"]', kind: 'facts' },
];

const browser = await launch();
const out: Array<Record<string, unknown>> = [];
for (const width of WIDTHS) {
  const { page } = await newPage(browser, { width, height: 1000, init: [MEASURE] });
  await page.goto(`${VITE}/__ui#round7`);
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.getElementById('round7')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(800);
  for (const r of ROOTS) {
    const rows = await page.evaluate(([s, k]) => (window as any).__d2(s, k), [r.sel, r.kind]); // eslint-disable-line @typescript-eslint/no-explicit-any
    out.push({ width, root: r.id, rows: rows ?? [] });
  }
  // the second metric panel (Arabic) and the tags
  const extra = await page.evaluate(() => {
    const tags = Array.from(document.querySelectorAll('[aria-label="Tags (specified)"] > *')).map((t) => {
      const k = t.querySelector('[data-part=key]')!.getBoundingClientRect(), v = t.querySelector('[data-part=value]')!.getBoundingClientRect(), tb = t.getBoundingClientRect();
      return { keyLeft: Math.round(k.left), valueLeft: Math.round(v.left), keyBeforeValue: k.left < v.left || k.top < v.top - 2, tagH: Math.round(tb.height), within: tb.right <= (t.parentElement as HTMLElement).getBoundingClientRect().right + 1 };
    });
    const panels = Array.from(document.querySelectorAll('[data-testid=metric-detail]')).map((p) => ({ scrollW: (p as HTMLElement).scrollWidth, clientW: (p as HTMLElement).clientWidth, w: Math.round(p.getBoundingClientRect().width) }));
    return { tags, panels, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  const arPanel = await page.evaluate(() => {
    const ps = document.querySelectorAll('[data-testid=metric-detail]');
    ps[1]!.setAttribute('data-r7-ar', '');
    return (window as any).__d2('[data-r7-ar]', 'facts'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  out.push({ width, root: 'facts-ar', rows: arPanel ?? [] }, { width, root: 'extra', extra });
  if (SHOTS) for (const id of ['r7-keys-long', 'r7-keys-rtl', 'r7-metric-facts', 'r7-edge-runs', 'r7-edge-items'])
    await page.locator(`#round7 [data-case^="${id}"]`).screenshot({ path: path.join(shotsDir, `${SHOTS}-${id}-${width}.png`) }).catch(() => {});
  await page.close();
}
await browser.close();

type Row = { keyLen: number; ellipsis: boolean; keyClipPx: number; overlapPx: number; overlapActPx: number; valueOverActPx: number; keyBoxW: number; gapPx: number | null; keyBeyondRowPx: number; keyLines: number; valueBelowKey: boolean | null; rowH: number };
const summary = (out as Array<{ width: number; root: string; rows: Row[] }>)
  .filter((c) => c.rows && c.root !== 'extra')
  .map((c) => ({
    width: c.width, root: c.root, rows: c.rows.length,
    ellipsis: c.rows.filter((r) => r.ellipsis).length, clipped: c.rows.filter((r) => r.keyClipPx > 0).length,
    keyBoxZero: c.rows.filter((r) => r.keyBoxW === 0).length,
    overlapKeyValue: c.rows.filter((r) => r.overlapPx > 0).length, overlapKeyActions: c.rows.filter((r) => r.overlapActPx > 0).length, valueOverActions: c.rows.filter((r) => r.valueOverActPx > 0).length,
    gapUnder8SameLine: c.rows.filter((r) => r.gapPx !== null && r.gapPx < 8).length,
    keyBeyondRow: c.rows.filter((r) => r.keyBeyondRowPx > 0).length,
    stackedRows: c.rows.filter((r) => r.valueBelowKey === true).length,
    maxKeyLines: Math.max(0, ...c.rows.map((r) => r.keyLines)),
    keyLines: Object.fromEntries([10, 40, 80].map((n) => [n, c.rows.filter((r) => r.keyLen === n).map((r) => r.keyLines)])),
    minRowH: Math.min(...c.rows.map((r) => r.rowH)),
  }));
save('d2-mock-specified', { widths: WIDTHS, summary, cases: out });
