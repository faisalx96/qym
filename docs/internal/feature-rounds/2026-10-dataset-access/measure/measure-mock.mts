/** Measures the WP-A gallery mocks at 1440 / 1024 / 390: box (w x h) of every data-testid the spec names, plus computed
 *  font roles and overflow checks. Output: measure/baseline/mock.json. Usage: node measure-mock.mts */
import { launch, newPage, save, VITE, WIDTHS } from './lib-a.mts';

const TESTIDS = ['da-catalog', 'da-card-head', 'da-card-name', 'da-card-badges', 'restricted-badge', 'access-section', 'access-mode', 'access-mode-project', 'access-people', 'access-grants-table', 'access-add', 'access-save-bar', 'access-summary', 'access-empty-note', 'da-viewer-hero', 'view-only-badge', 'da-403', 'restricted-dataset-banner', 'run-item-redacted', 'items-state', 'metadata-filter', 'items-search', 'filter-chips', 'all-matching', 'batch-published-entry', 'meta-popover', 'facet-values', 'da-pane', 'disabled-banner', 'item-state-action', 'enable-item', 'pane-foot', 'da-modal', 'batch-numbers', 'batch-ids', 'reason-counter', 'batch-typed', 'meta-line', 'version-row', 'download-menu', 'publish-disabled-note', 'rev-disabled', 'compare-summary', 'state-diff', 'item-actions'];
const browser = await launch();
const out: Record<string, unknown> = {};
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(browser, w, 900);
  await page.goto(`${VITE}/__ui#dataset-access`);
  await page.waitForSelector('[data-case^="da-"]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  out[String(w)] = await page.evaluate(`((ids) => {
    const r = {};
    const frame = document.querySelector('[data-case^="da-catalog"] > div > div');
    r._frameWidth = frame ? Math.round(frame.getBoundingClientRect().width) : null;
    for (const id of ids) {
      const els = [...document.querySelectorAll('[data-testid="' + id + '"]')];
      r[id] = els.slice(0, 6).map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), overflowX: e.scrollWidth > e.clientWidth + 1, ellipsis: cs.textOverflow === 'ellipsis', font: cs.fontSize + '/' + cs.fontWeight }; });
    }
    const q = (s) => [...document.querySelectorAll(s)].map((e) => { const b = e.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
    r.toolbars = q('[data-case^="da-toolbar"] [data-dt-toolbar]');
    r.segmented = q('[data-case^="da-toolbar"] [data-testid="items-state"] > *').slice(0, 1);
    r.accessCols = q('[data-access-state="restricted"] [role=columnheader]');
    r.tableRowHeights = q('[data-access-state="restricted"] tbody tr');
    r.itemRow = q('[data-case^="da-toolbar"] tr[data-row-key]').slice(0, 3);
    r.chips = q('[data-case^="da-toolbar"] [data-testid="meta-chip"]').slice(0, 1);
    r.pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return r;
  })(${JSON.stringify(TESTIDS)})`);
  await ctx.close();
}
save('mock', out);
await browser.close();
