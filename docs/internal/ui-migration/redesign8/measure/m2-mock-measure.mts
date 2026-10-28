/** Geometry of the proposed mock (the numbers the criteria quote). Usage: node m2-mock-measure.mts -> baseline/mock-<w>.json */
import { launch, newPage, REACT, sleep } from './lib8.mts';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const PARTS = ['title-block', 'section-nav', 'section-runs', 'run-grid', 'run-card', 'run-stat-strip', 'run-meta', 'run-remove', 'section-averages', 'averages-table', 'averages-colhead', 'averages-cell', 'averages-value', 'averages-delta', 'averages-counts', 'averages-latency-row', 'section-overview', 'stat-grid', 'stat-box', 'winner-bar', 'winner-legend', 'distribution-bar', 'section-categories', 'category-chip-bar', 'category-card', 'category-run-row', 'category-track', 'section-errors', 'error-group', 'error-card', 'error-run', 'section-items', 'items-toolbar', 'items-filters-btn', 'items-display-btn', 'run-key', 'item-list', 'item-row', 'item-chevron', 'item-index', 'item-title', 'item-score-chips', 'item-score-chip', 'pagination', 'item-detail', 'output-toggles', 'output-grid', 'output-card', 'metric-details'];
const probe = (arg: { parts: string[]; idx: number }) => {
  const root = document.querySelectorAll('[data-testid="r8-shell"]')[arg.idx] as HTMLElement;
  const out: Record<string, unknown> = {};
  for (const p of arg.parts) {
    const all = [...root.querySelectorAll(`[data-part="${p}"]`)] as HTMLElement[];
    if (!all.length) continue;
    const e = all[0]!; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    out[p] = { n: all.length, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: `${cs.fontSize} ${cs.fontWeight} ${/mono|menlo/i.test(cs.fontFamily) ? 'mono' : 'sans'}` };
  }
  const page = root.querySelector('[data-testid="r8-compare-page"]') as HTMLElement | null;
  if (page) {
    const rows = [...root.querySelectorAll('[data-part="item-row"]')] as HTMLElement[];
    const pitch = rows.length > 1 ? Math.round((rows[1]!.getBoundingClientRect().top - rows[0]!.getBoundingClientRect().top) * 10) / 10 : null;
    const chipRects = [...rows[0]!.querySelectorAll('[data-part="item-score-chip"]')].map((c) => c.getBoundingClientRect());
    const ell = [...root.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return cs.textOverflow === 'ellipsis'; }).length;
    const clipped = [...root.querySelectorAll('[data-part="run-name"],[data-part="averages-colhead"],[data-part="category-run-row"]')].filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).length;
    const sticky = [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'sticky').length;
    const cards = [...root.querySelectorAll('[data-part="output-card"]')] as HTMLElement[];
    const tops = (sel: string) => cards.map((c) => Math.round((c.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect().top ?? 0));
    out.derived = {
      pageW: Math.round(page.getBoundingClientRect().width), docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageScrollW: page.scrollWidth, pageClientW: page.clientWidth, itemRowPitch: pitch, chipsInOneRow: new Set(chipRects.map((c) => Math.round(c.top))).size === 1,
      chipsRightEdgeToRowRight: chipRects.length ? Math.round((rows[0]!.getBoundingClientRect().right - chipRects[chipRects.length - 1]!.right) * 10) / 10 : null,
      ellipsisElements: ell, clippedNames: clipped, stickyElements: sticky,
      sectionHeights: Object.fromEntries(['runs', 'averages', 'overview', 'categories', 'errors', 'items'].map((s) => [s, Math.round((root.querySelector(`[data-part="section-${s}"]`) as HTMLElement)?.getBoundingClientRect().height ?? 0)])),
      outputCardTops: tops(':scope'), metricRowTops: tops('[class*="metricRows"]'), reasonTops: tops('[data-part="metric-details"]'),
      outputGridScroll: (root.querySelector('[data-part="output-grid"]') as HTMLElement | null) ? [(root.querySelector('[data-part="output-grid"]') as HTMLElement).scrollWidth, (root.querySelector('[data-part="output-grid"]') as HTMLElement).clientWidth] : null,
      avgScroll: (root.querySelector('[data-part="averages-table"]') as HTMLElement) ? [(root.querySelector('[data-part="averages-table"]') as HTMLElement).scrollWidth, (root.querySelector('[data-part="averages-table"]') as HTMLElement).clientWidth] : null,
    };
  }
  return out;
};
const b = await launch();
for (const w of [1440, 1024, 390]) {
  const p = await newPage(b, w, 900);
  await p.goto(`${REACT}/__ui#round8`); await sleep(3500);
  const res: Record<string, unknown> = {};
  for (const [name, idx] of [['page', 0], ['expanded', 1], ['runs8', 2]] as const) {
    if (w !== 1440 && name === 'runs8') continue;
    res[name] = await p.evaluate(probe, { parts: PARTS, idx });
  }
  writeFileSync(path.join(here, 'baseline', `mock-${w}.json`), JSON.stringify(res, null, 1));
}
await b.close();
