/**
 * Part A criterion A7: frozen cells are pixel-aligned with their header cell at every scrollLeft. Sets scrollLeft at 10 evenly
 * spaced positions (0 .. max) and reports max |td.left - th.left| and max |td.left - target| over the frozen columns.
 *   WIDTH=1440 node align.mts
 */
import { BASE, seed, save, launch, newPage } from './lib.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const pinsInit = `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-${seed.metrics[0]}':'start','metric-${seed.metrics[1]}':'start'},order:null,density:null,collapsed:[]}));localStorage.setItem('qym:runs:page-size','50');`;
const browser = await launch();
const { page } = await newPage(browser, { width: WIDTH, init: [pinsInit] });
await page.goto(`${BASE}/projects/${seed.slug}`);
await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
await page.waitForTimeout(600);
const res = await page.evaluate(async () => {
  const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement;
  const max = sc.scrollWidth - sc.clientWidth;
  const out: Array<{ at: number; headMis: number; targetMis: number; cols: number }> = [];
  for (let i = 0; i < 10; i++) {
    sc.scrollLeft = Math.round((max * i) / 9);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sr = sc.getBoundingClientRect();
    let headMis = 0, targetMis = 0, cols = 0;
    for (const row of Array.from(document.querySelectorAll('[data-testid="runs-table"] tbody tr[data-run-id]')).slice(0, 6)) {
      for (const td of Array.from(row.querySelectorAll('td[data-pin="start"], td[data-pin]'))) {
        const c = (td as HTMLElement).dataset.col!;
        const th = document.querySelector(`[data-testid="runs-table"] thead th[data-col="${c}"]`)!;
        const cs = getComputedStyle(td);
        if (cs.position !== 'sticky') continue;
        cols++;
        const r = td.getBoundingClientRect();
        headMis = Math.max(headMis, Math.abs(r.left - th.getBoundingClientRect().left), Math.abs(r.width - th.getBoundingClientRect().width));
        let w = 0;
        for (let e = td.previousElementSibling; e; e = e.previousElementSibling) w += e.getBoundingClientRect().width;
        const expected = Math.max(sr.left + w - sc.scrollLeft, sr.left + parseFloat(cs.left));
        if ((td as HTMLElement).dataset.pin === 'start') targetMis = Math.max(targetMis, Math.abs(r.left - expected));
      }
    }
    out.push({ at: sc.scrollLeft, headMis: Number(headMis.toFixed(2)), targetMis: Number(targetMis.toFixed(2)), cols });
  }
  return out;
});
await browser.close();
save(`align-${WIDTH}`, { width: WIDTH, positions: res, maxHeaderMisalignPx: Math.max(...res.map((r) => r.headMis)), maxTargetMisalignPx: Math.max(...res.map((r) => r.targetMis)) });
