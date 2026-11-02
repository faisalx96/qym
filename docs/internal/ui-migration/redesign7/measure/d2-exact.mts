/**
 * D2-15 (round 7 decision 2): a data key renders exactly as written. On items j-01 and j-03 of the seeded `jsonKeys` run at 1440 and 390, with every
 * output key open and the schema_judge panel open, every `[data-part=key]` of the item card is compared with its source: `innerText` (the rendered text,
 * so a CSS text-transform shows) against `textContent` (the source string). Mismatches must be 0; the eyebrow (`[data-part=eyebrow]`, the one fixed
 * uppercase label) is reported separately.
 *   node d2-exact.mts
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT } from './lib7.mts';

const browser = await launch();
const out: Array<Record<string, unknown>> = [];
for (const width of [1440, 390]) {
  for (const item of ['j-01', 'j-03']) {
    const { page } = await newPage(browser, { width, height: 1000, init: [STORAGE_INIT] });
    await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=${item}`);
    const card = page.locator(`[data-testid=item-card][data-item-id="${item}"]`);
    await card.waitFor();
    await card.getByRole('button', { name: 'Expand all output keys' }).click();
    await card.locator('[data-cell^="schema_judge::"]').first().click();
    await card.getByTestId('metric-detail').waitFor();
    await page.waitForTimeout(600);
    const res = await page.evaluate((sel) => {
      const root = document.querySelector(sel)!;
      const keys = Array.from(root.querySelectorAll<HTMLElement>('[data-part=key]'));
      const mism = keys.filter((k) => k.innerText.trim() !== (k.textContent ?? '').trim()).map((k) => ({ source: k.textContent, rendered: k.innerText }));
      const eyebrows = Array.from(root.querySelectorAll<HTMLElement>('[data-part=eyebrow]')).map((e) => ({ source: e.getAttribute('title'), rendered: e.innerText }));
      return { keys: keys.length, mismatches: mism, upperCaseKeys: keys.filter((k) => getComputedStyle(k).textTransform !== 'none').length, eyebrows };
    }, `[data-testid=item-card][data-item-id="${item}"]`);
    out.push({ width, item, ...res });
    await page.close();
  }
}
await browser.close();
save('d2-exact', { cases: out, mismatchesTotal: out.reduce((n, c) => n + (c.mismatches as unknown[]).length, 0) });
