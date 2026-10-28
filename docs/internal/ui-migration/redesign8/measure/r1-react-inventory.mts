/** React page (Vite 5981): geometry of the compare sections and test-id'd components at 1440 / 1024 / 390, plus cropped shots. Output baseline/current-<w>.json, shots/current-<name>.png */
import { launch, newPage, reactUrl, sleep, shots } from './lib8.mts';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const SEL: Record<string, string> = {
  'sticky-bar': '[data-compare-sticky]',
  'section-runs': '#compare-runs', 'section-averages': '#compare-averages', 'section-overview': '#compare-overview',
  'section-categories': '#compare-categories', 'section-errors': '#compare-errors', 'section-items': '#compare-items',
  'run-card': '[data-testid="run-card"]', 'run-cards': '[data-testid="run-details"]',
  'averages-table': '#compare-averages [data-testid="data-table"]', 'average-row': '[data-testid="average-row"]', 'average-cell': '[data-testid="average-cell"]',
  'category-card': '[data-testid="category-card"]', 'category-run': '[data-testid="category-run"]',
  'error-card': '[data-testid="error-card"]', 'error-run': '[data-testid="error-run"]',
  'items-toolbar': '[data-compare-toolbar]', 'item-list': '[data-testid="item-list"]', 'item-row': '[data-testid="item-row"]',
  'run-tag': '[data-testid="run-tag"]',
};
const probe = (sel: string) => {
  const e = document.querySelector(sel) as HTMLElement | null; if (!e) return null;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return { n: document.querySelectorAll(sel).length, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
    font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight} ${/mono|menlo/i.test(cs.fontFamily) ? 'mono' : 'sans'}`, pad: cs.padding, radius: cs.borderRadius, gap: cs.gap, display: cs.display, text: (e.innerText || '').slice(0, 60).replace(/\n/g, ' | ') };
};
const b = await launch();
for (const w of [1440, 1024, 390]) {
  const p = await newPage(b, w);
  await p.goto(reactUrl(['base', 'a', 'b', 'c'])); await sleep(5000);
  for (let i = 0; i < 6; i++) { await p.evaluate(() => { const m = document.getElementById('shell-content')!; m.scrollTop = m.scrollHeight; }); await sleep(700); }
  await p.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; }); await sleep(500);
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(SEL)) {
    out[k] = await p.evaluate(`(${probe.toString()})(${JSON.stringify(s)})`);
    if (w !== 1024 && out[k] && k.startsWith('section-')) { try { const el = p.locator(s).first(); await el.scrollIntoViewIfNeeded(); await sleep(300); await el.screenshot({ path: path.join(shots, `current-${k.replace('section-', '')}${w === 390 ? '-390' : ''}.png`) }); } catch { /* */ } }
  }
  writeFileSync(path.join(here, 'baseline', `current-${w}.json`), JSON.stringify(out, null, 1));
}
await b.close();
