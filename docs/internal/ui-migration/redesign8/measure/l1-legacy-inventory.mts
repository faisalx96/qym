/** Legacy page (port 8980): geometry + computed styles of every component at 1440 / 1024 / 390, plus cropped shots at 1440 and 390. Output: baseline/legacy-<w>.json, shots/legacy-<name>.png */
import { launch, newPage, legacyUrl, sleep, shots } from './lib8.mts';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
export const SEL: Record<string, string> = {
  'title-block': '.compare-header-bar',
  'run-card': '.compare-run-card',
  'run-card-grid': '.compare-summary',
  'run-stat-strip': '.compare-run-summary-strip',
  'run-meta-grid': '.compare-run-meta-grid',
  'run-remove': '.compare-run-remove',
  'averages-head': '.metrics-comparison .compare-section-head',
  'baseline-select': '.metrics-baseline-control',
  'averages-table': '.metrics-table-scroll',
  'averages-colhead': '.metric-run-heading',
  'averages-metric-cell': '.metric-name',
  'averages-baseline-cell': '.metric-value-cell',
  'averages-value': '.metric-val',
  'averages-delta': '.metric-delta-line',
  'averages-counts': '.metric-delta-counts',
  'overview-head': '.comparison-overview-heading',
  'pass-slider': '.threshold-control',
  'metric-tabs': '.metric-tabs',
  'stats-grid': '.stats-row',
  'stat-box': '.stat-box',
  'winner-bar': '.win-loss-bar',
  'winner-legend': '.win-loss-legend',
  'distribution-bar': '.distribution-bar',
  'category-chip-bar': '.category-chip-bar',
  'category-card': '.breakdown-card',
  'category-run-line': '.cmp-run-lines > *',
  'category-track': '.cmp-run-track',
  'error-group': '.task-error-group',
  'error-card': '.error-card',
  'items-toolbar': '.qym-item-toolbar',
  'items-search': '.qym-search',
  'items-filters-btn': '#btn-item-filters',
  'items-count': '.qym-item-count',
  'items-display-btn': '#btn-item-display',
  'items-csv-btn': '#export-filtered-btn',
  'item-row': '.item-comparison-row',
  'item-chevron': '.item-chevron',
  'item-index': '.item-index',
  'item-title': '.item-title',
  'item-score-chips': '.item-agg-pills',
  'item-score-chip': '.item-agg-pill',
  'item-error-row': '.item-comparison-row.item-execution-error',
  'pagination': '.pagination',
};
function probe(sel: string) {
  const e = document.querySelector(sel) as HTMLElement | null;
  if (!e) return null;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return { n: document.querySelectorAll(sel).length, x: Math.round(r.x), y: Math.round(r.y + (document.querySelector('main.compare-container')?.scrollTop ?? 0)), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
    font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${/mono|menlo|courier/i.test(cs.fontFamily) ? 'mono' : 'sans'}`, color: cs.color, bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopColor} L${cs.borderLeftWidth} ${cs.borderLeftColor}`, pad: cs.padding, radius: cs.borderRadius, gap: cs.gap, display: cs.display, text: (e.innerText || '').slice(0, 60).replace(/\n/g, ' | ') };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await launch();
  for (const w of [1440, 1024, 390]) {
    const p = await newPage(b, w);
    await p.goto(legacyUrl(['base', 'a', 'b', 'c']));
    await sleep(4000);
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(SEL)) {
      out[k] = await p.evaluate(`(${probe.toString()})(${JSON.stringify(s)})`);
      if (w !== 1024 && out[k]) {
        try { const el = p.locator(s).first(); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(shots, `legacy-${k}${w === 390 ? '-390' : ''}.png`) }); } catch (e) { /* hidden */ }
      }
    }
    writeFileSync(path.join(here, 'baseline', `legacy-${w}.json`), JSON.stringify(out, null, 1));
    console.log(w, 'done');
  }
  await b.close();
}
