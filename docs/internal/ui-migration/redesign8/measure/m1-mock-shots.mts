/** Screenshots + geometry of the round-8 mocks in the gallery (`/__ui#round8`, Vite 5981). Usage: node m1-mock-shots.mts */
import { launch, newPage, REACT, sleep, shots } from './lib8.mts';
import path from 'node:path';
const b = await launch();
const names: Array<[string, number]> = [['page-compare', 0], ['page-compare-expanded', 1], ['page-compare-8runs', 2], ['page-sweep', 3]];
for (const w of [1440, 390]) {
  const p = await newPage(b, w, 900);
  await p.goto(`${REACT}/__ui#round8`); await sleep(3500);
  for (const [name, idx] of names) {
    if (w === 390 && name !== 'page-compare' && name !== 'page-sweep' && name !== 'page-compare-expanded') continue;
    const shell = p.locator('[data-testid="r8-shell"]').nth(idx);
    await shell.scrollIntoViewIfNeeded(); await sleep(400);
    await shell.screenshot({ path: path.join(shots, `mock-${name.startsWith('page-compare') ? 'page-compare' + name.slice(12) : name}-${w}.png`) });
    const r = await shell.boundingBox(); console.log(w, name, Math.round(r!.width), Math.round(r!.height));
  }
  if (w === 1440) { const s = p.locator('[data-testid="r8-sheets"]'); await s.scrollIntoViewIfNeeded(); await s.screenshot({ path: path.join(shots, 'mock-sheets-1440.png') }); }
}
await b.close();
