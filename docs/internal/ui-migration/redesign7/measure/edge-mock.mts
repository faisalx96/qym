/**
 * Q1 / D3 on the gallery mocks: the edge probe of edge-cues.mts run on the "current" and "specified" frames of r7-edge-runs and r7-edge-items.
 *   VITE=http://127.0.0.1:5971 WIDTHS=1440,1024 node edge-mock.mts
 */
import { launch, newPage, save } from './lib7.mts';
import { PROBE } from './edge-probe.mts';

const VITE = process.env.VITE ?? 'http://127.0.0.1:5971';
const WIDTHS = (process.env.WIDTHS ?? '1440,1024').split(',').map(Number);
const browser = await launch();
const out: Array<Record<string, unknown>> = [];
for (const width of WIDTHS) {
  const { page } = await newPage(browser, { width, height: 1000, init: [PROBE] });
  await page.goto(`${VITE}/__ui#round7`);
  await page.waitForTimeout(3000);
  for (const id of ['runs-current', 'runs-specified', 'items-current', 'items-specified']) {
    const p = await page.evaluate((i) => (window as any).__edge(`[data-r7-case=${i}]`), id); // eslint-disable-line @typescript-eslint/no-explicit-any
    out.push({
      width, case: id, scrollLeft: p?.scrollLeft, pins: p && [p.boxes.pinStart, p.boxes.pinEnd], cueElementsLive: p?.cueElementsLive, lines: p?.lines,
      overlapSummary: p?.overlapSummary, overlaps: p?.overlaps?.slice(0, 5), details: p?.boxes.details.map((d: { h: number; strip: boolean }) => ({ h: Math.round(d.h), strip: d.strip })),
      rowsBox: p && p.boxes.firstHeaderRow && p.boxes.lastBodyRow && { top: Math.round(p.boxes.firstHeaderRow.t), bottom: Math.round(p.boxes.lastBodyRow.b) },
    });
  }
  await page.close();
}
await browser.close();
save('edge-mock', { widths: WIDTHS, cases: out });
