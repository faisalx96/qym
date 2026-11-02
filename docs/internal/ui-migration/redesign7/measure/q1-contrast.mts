/**
 * Q1-3: the glyphs that used to sit under the actions line keep their unshaded contrast. On the seeded runs page (group open) at 1440 and 1024 it
 * computes the WCAG contrast of the strip statistic labels, the run-row metric values (the percentages that lost 3 px each) and the header labels
 * against their own background (no shade exists any more), and the pinned-edge line colour of every pinned cell.
 *   WIDTH=1440 node q1-contrast.mts
 */
import { BASE, r7, save, launch, newPage, STORAGE_INIT } from './lib7.mts';

const out: Record<string, unknown> = {};
const browser = await launch();
for (const width of [1440, 1024]) {
  const { page } = await newPage(browser, { width, height: 1000, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}`);
  const sel = '[data-testid="runs-table"]';
  await page.locator(`${sel} tbody tr[data-run-id]`).first().waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Expand 10 passes of/ }).first().click();
  await page.locator(`${sel} tr[data-strip-row] dl[aria-busy="false"]`).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  out[`w${width}`] = await page.evaluate(() => {
    const parse = (c: string) => { const n = c.match(/-?[\d.]+/g)!.map(Number); return c.startsWith('color(') ? [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] ?? 1] : [n[0]!, n[1]!, n[2]!, n[3] ?? 1]; };
    const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const ratio = (el: HTMLElement) => {
      const fg = parse(getComputedStyle(el).color);
      let bg = [18, 18, 24, 1];
      for (let n: HTMLElement | null = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3]! > 0.5) { bg = c; break; } }
      const a = lum(fg), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const root = document.querySelector('[data-testid="runs-table"]')!;
    const min = (els: HTMLElement[]) => (els.length ? Math.round(Math.min(...els.map(ratio)) * 10) / 10 : null);
    const leafText = (scope: Element, re: RegExp) => Array.from(scope.querySelectorAll<HTMLElement>('*')).filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent ?? '')));
    const strip = leafText(root.querySelector('tr[data-strip-row]')!, /^(Pass[@^]\d+|Avg@\d+|Consistency|Reliability)$/);
    const values = leafText(root.querySelector('tbody')!, /^\d+(\.\d+)?%$/);
    const heads = Array.from(root.querySelectorAll<HTMLElement>('thead [data-th-label]'));
    const neutral = values.filter((e) => Math.round(ratio(e) * 10) / 10 >= 11);
    const edge = Array.from(root.querySelectorAll<HTMLElement>('[data-pin-edge]')).map((c) => getComputedStyle(c).boxShadow);
    return {
      stripLabels: { n: strip.length, minContrast: min(strip) },
      metricValues: { n: values.length, minContrastAll: min(values), neutralBandValues: neutral.length, minContrastNeutral: min(neutral) },
      headerLabels: { n: heads.length, minContrast: min(heads) },
      pinnedEdgeShadows: Array.from(new Set(edge.map((s) => s.replace(/ rgb\(43, 43, 64\)/, ' [rail]')))).slice(0, 8),
    };
  });
  await page.close();
}
await browser.close();
save('q1-contrast', out);
