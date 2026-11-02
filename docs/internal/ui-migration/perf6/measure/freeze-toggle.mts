/**
 * Part A, the "transition" itself: what happens on the main thread when
 *   (1) the first horizontal scroll flips the table into its "scrolled" state (shadow on the frozen edge),
 *   (2) a column is frozen from the Columns menu, (3) it is unfrozen.
 * Per step: React commits, long animation frames (with the script that caused them), layout counts, time from the input to
 * the first frame whose frozen cells sit at their final x, and whether any CSS transition/animation ran on pinned cells.
 *   WIDTH=1440 CPU=1|4 REPS=3 node freeze-toggle.mts
 */
import { BASE, seed, save, median, launch, newPage, metricsOf } from './lib.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const CPU = Number(process.env.CPU ?? 1);
const REPS = Number(process.env.REPS ?? 3);
const pinsInit = `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-${seed.metrics[0]}':'start'},order:null,density:null,collapsed:[]}));localStorage.setItem('qym:runs:page-size','50');`;

const browser = await launch();
const out: Array<Record<string, unknown>> = [];
for (let rep = 0; rep < REPS; rep++) {
  const { page, cdp } = await newPage(browser, { width: WIDTH, init: [pinsInit] });
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(`${BASE}/projects/${seed.slug}`);
  await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    // count CSS transitions / animations that start on any table cell
    (window as any).__anim = 0; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const ev of ['transitionstart', 'animationstart']) document.addEventListener(ev, () => ((window as any).__anim += 1), true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  const step = async (name: string, act: () => Promise<void>, settled: string) => {
    await page.evaluate(() => { const P = (window as any).__perf; P.mark = { c: P.commits, l: P.loaf.length, a: (window as any).__anim, t: performance.now() }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const m0 = await metricsOf(cdp);
    await act();
    // wait until `settled` (a JS predicate on frozen cell positions) holds, report ms from the act
    const ms = await page.evaluate(async (pred) => {
      const t0 = (window as any).__perf.mark.t; // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = new Function('return (' + pred + ')()') as () => boolean;
      return await new Promise<number>((res) => { const tick = () => (f() ? res(performance.now() - t0) : requestAnimationFrame(tick)); tick(); });
    }, settled);
    await page.waitForTimeout(500);
    const m1 = await metricsOf(cdp);
    const r = await page.evaluate(() => { const P = (window as any).__perf; return { commits: P.commits - P.mark.c, loaf: P.loaf.slice(P.mark.l), anim: (window as any).__anim - P.mark.a }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    out.push({
      rep, step: name, msToSettled: Math.round(ms), commits: r.commits, cssTransitionsStarted: r.anim,
      layouts: m1.LayoutCount! - m0.LayoutCount!, layoutMs: Number(((m1.LayoutDuration! - m0.LayoutDuration!) * 1000).toFixed(1)),
      scriptMs: Number(((m1.ScriptDuration! - m0.ScriptDuration!) * 1000).toFixed(1)),
      longestFrameMs: Math.round(Math.max(0, ...r.loaf.map((l: { dur: number }) => l.dur))),
      loaf: r.loaf.map((l: { dur: number; scripts: Array<{ fn: string; url: string; d: number }> }) => ({ dur: Math.round(l.dur), top: l.scripts.sort((a, b) => b.d - a.d)[0] })),
    });
  };
  const stuck = (col: string) => `() => { const td = document.querySelector('[data-testid="runs-table"] tbody td[data-col="${col}"]'); return !!td && getComputedStyle(td).position === 'sticky' && getComputedStyle(td).left !== 'auto'; }`;
  const box = (await page.locator('[data-testid="runs-table"] tbody').boundingBox())!;
  await page.mouse.move(box.x + 500, box.y + 40);
  await step('first scroll flips the scrolled state', async () => { await page.mouse.wheel(80, 0); }, `() => document.querySelector('[data-testid="runs-table"] [data-dt-scroller]').scrollLeft > 20`);
  await page.getByRole('button', { name: /^Columns/ }).click();
  const col = seed.metrics[2]!;
  await step('freeze a metric column (Columns menu)', async () => { await page.getByRole('dialog', { name: 'Columns' }).getByRole('button', { name: `Freeze ${col}` }).click(); }, stuck(`metric-${col}`));
  await step('unfreeze it', async () => { await page.getByRole('dialog', { name: 'Columns' }).getByRole('button', { name: `Freeze ${col}` }).click(); }, `() => { const td = document.querySelector('[data-testid="runs-table"] tbody td[data-col="metric-${col}"]'); return !!td && getComputedStyle(td).position !== 'sticky'; }`);
  await page.close();
}
await browser.close();
const steps = [...new Set(out.map((o) => o.step as string))];
save(`freeze-toggle-${WIDTH}-cpu${CPU}`, {
  width: WIDTH, cpu: CPU,
  median: steps.map((s) => {
    const rs = out.filter((o) => o.step === s);
    const m = (k: string) => median(rs.map((r) => r[k] as number));
    return { step: s, msToSettled: m('msToSettled'), commits: m('commits'), layouts: m('layouts'), scriptMs: m('scriptMs'), longestFrameMs: m('longestFrameMs'), cssTransitionsStarted: m('cssTransitionsStarted') };
  }),
  runs: out,
});
