/**
 * D2 baseline: does a JSON key stay fully visible next to its value? Run item (`?item=j-01` English, `j-03` Arabic) of the seeded
 * `jsonKeys` run at 1440 / 1024 / 390 and measure, for every key / value pair of
 *   - the Output key tree (`[data-keytree]`: chevron, key, preview or type, bulk buttons, copy) collapsed and fully expanded,
 *   - the Expected value (StructuredValue sections: key, summary or scalar, copy),
 *   - the metric detail panel (`[data-testid=metric-detail]`: facts dt / dd, eyebrow / prose, nested key tree),
 * the key's text box against the value's, the copy / bulk buttons and its own box:
 *   keyClipPx    text wider than the key's box (clipped by overflow, or painted outside the box)
 *   ellipsis     text-overflow ellipsis actually active (scrollWidth > clientWidth)
 *   overlapPx    horizontal overlap of the key's painted text with the value's painted text on the same line
 *   overlapActPx the same against the copy / Expand all / Collapse all buttons of the row
 *   gapPx        value inline-start edge minus key inline-end edge (LTR; the mirror in RTL), same line only
 *   keyBeyondRowPx  how far the key's text reaches past the row's box (a key that does not fit)
 * Hooks used (class substrings today; the implementation adds data-part="key" | "value" | "type" | "actions" and the script prefers them).
 *   WIDTHS=1440,1024,390 node d2-keys.mts
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT, shotsDir } from './lib7.mts';
import path from 'node:path';
import { MEASURE } from './d2-probe.mts';

const WIDTHS = (process.env.WIDTHS ?? '1440,1024,390').split(',').map(Number);
const SHOTS = process.env.SHOTS ?? ''; // prefix for screenshots ("current-d2"), none by default


const browser = await launch();
const results: Record<string, unknown>[] = [];
for (const width of WIDTHS) {
  for (const item of ['j-01', 'j-03']) {
    const { page } = await newPage(browser, { width, height: 1000, init: [STORAGE_INIT, MEASURE] });
    await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=${item}`);
    const card = page.locator(`[data-testid=item-card][data-item-id="${item}"]`);
    await card.waitFor();
    await page.waitForTimeout(600);
    const m = async (sel: string, kind: string) => page.evaluate(([s, k]) => (window as any).__d2(s, k), [sel, kind]) as Promise<Array<Record<string, unknown>> | null>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const sel = `[data-testid=item-card][data-item-id="${item}"]`;
    const tag = `${item === 'j-01' ? 'en' : 'ar'}-${width}`;
    const rec = (state: string, region: string, rows: Array<Record<string, unknown>> | null) => results.push({ width, item, state, region, rows: rows ?? [] });
    // Expected (sections)
    rec('default', 'expected', await m(`${sel} [data-kind=expected]`, 'sections'));
    // Output key tree: collapsed, then expanded
    rec('collapsed', 'output', await m(`${sel} [data-kind=output] [data-keytree]`, 'tree'));
    if (SHOTS) await card.locator('[data-kind=output]').screenshot({ path: path.join(shotsDir, `${SHOTS}-output-collapsed-${tag}.png`) }).catch(() => {});
    await card.getByRole('button', { name: 'Expand all output keys' }).click();
    await page.waitForTimeout(500);
    rec('expanded', 'output', await m(`${sel} [data-kind=output] [data-keytree]`, 'tree'));
    if (SHOTS) await card.locator('[data-kind=output]').screenshot({ path: path.join(shotsDir, `${SHOTS}-output-expanded-${tag}.png`) }).catch(() => {});
    if (SHOTS) await card.locator('[data-kind=expected]').screenshot({ path: path.join(shotsDir, `${SHOTS}-expected-${tag}.png`) }).catch(() => {});
    // Metric detail panel of schema_judge
    await card.locator('[data-cell^="schema_judge::"]').first().click();
    const panel = card.getByTestId('metric-detail');
    await panel.waitFor();
    await page.waitForTimeout(400);
    rec('panel', 'facts', await m(`${sel} [data-testid=metric-detail]`, 'facts'));
    // the panel's nested key tree
    rec('panel', 'panel-tree', await m(`${sel} [data-testid=metric-detail]`, 'tree'));
    if (SHOTS) await panel.screenshot({ path: path.join(shotsDir, `${SHOTS}-panel-${tag}.png`) }).catch(() => {});
    await page.close();
  }
}
await browser.close();

type Row = { keyLen: number; ellipsis: boolean; keyClipPx: number; overlapPx: number; overlapActPx: number; valueOverActPx: number; keyBoxW: number; gapPx: number | null; keyBeyondRowPx: number; keyLines: number };
const all = (results as Array<{ width: number; item: string; state: string; region: string; rows: Row[] }>);
const summary = all.map((c) => {
  const rows = c.rows;
  return {
    width: c.width, item: c.item, state: c.state, region: c.region, rows: rows.length,
    ellipsis: rows.filter((r) => r.ellipsis).length,
    clipped: rows.filter((r) => r.keyClipPx > 0).length,
    overlapKeyValue: rows.filter((r) => r.overlapPx > 0).length,
    overlapKeyActions: rows.filter((r) => r.overlapActPx > 0).length,
    valueOverActions: rows.filter((r) => r.valueOverActPx > 0).length,
    keyBoxZero: rows.filter((r) => r.keyBoxW === 0).length,
    gapUnder8: rows.filter((r) => r.gapPx !== null && r.gapPx < 8).length,
    keyBeyondRow: rows.filter((r) => r.keyBeyondRowPx > 0).length,
    worstOverlapPx: Math.max(0, ...rows.map((r) => Math.max(r.overlapPx, r.overlapActPx, r.valueOverActPx))),
    worstClipPx: Math.max(0, ...rows.map((r) => r.keyClipPx)),
    keys80Lines: rows.filter((r) => r.keyLen >= 80).map((r) => r.keyLines),
  };
});
save('d2-keys-baseline', { widths: WIDTHS, summary, cases: results });
