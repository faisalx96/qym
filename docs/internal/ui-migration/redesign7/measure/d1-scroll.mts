/**
 * D1 baseline: the cost of scrolling down through the items, with the frozen input bar and with frozen columns.
 *   TARGET=detail|table WIDTH=1440 CPU=1|4 MODE=wheel|drag PINS=0|2 REPS=3 node d1-scroll.mts
 * TARGET=detail  the seeded `jsonKeys` run, item j-01 expanded with every output key open (the item bar `[data-item-bar]` is stuck on the
 *                sticky line for about 1,900 px of scroll), 2 s of scrolling the page scroller `#shell-content`.
 * TARGET=table   the seeded `big1200` run (1,200 items, 500 per page, windowed rows), no item expanded. PINS=2 freezes Status and Input
 *                next to the default pinned `#` (the Columns menu layout is written to localStorage `run.items.v2`), PINS=0 keeps `#` only.
 * MODE=wheel     120 wheel notches of 40 px every 16 ms (Playwright mouse.wheel).  MODE=drag  the scrollbar thumb dragged top to bottom of
 *                the range in 2 s (mouse down on the thumb, 120 moves): the compositor scrolls, the main thread only sees scroll events.
 * Per run: rAF frame times (dropped frames > 25 ms), long tasks (> 50 ms), React commits (devtools hook), CDP Performance deltas
 * (style recalcs, layouts, script, task time), a timeline trace (UpdateLayoutTree count / elements styled / ms, Layout, Paint events and
 * the area they paint, Layerize, PrePaint), and per frame: the stuck item bar's y against the sticky line, the pinned cell's y against its row's
 * first unpinned cell (frames > 1 px), and the number of compositor layers of pinned cells (CDP LayerTree).
 */
import { BASE, r7, save, median, pct, launch, newPage, STORAGE_INIT, metricsOf } from './lib7.mts';

const TARGET = (process.env.TARGET ?? 'detail') as 'detail' | 'table';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const CPU = Number(process.env.CPU ?? 1);
const MODE = (process.env.MODE ?? 'wheel') as 'wheel' | 'drag';
const PINS = Number(process.env.PINS ?? 0);
const REPS = Number(process.env.REPS ?? 3);
/** NOTRACE=1: no timeline trace (the trace itself costs frames at 4x): frame times, long tasks and commits only. */
const NOTRACE = process.env.NOTRACE === '1';
/** EXPERIMENT=<name>: measurement-only CSS injected after load, to size what a candidate fix could buy (never part of the product). */
const EXPERIMENT = process.env.EXPERIMENT ?? '';
const EXPERIMENTS: Record<string, string> = {
  'start-pins-static': `td[data-pin='start'],th[data-pin='start']{position:static !important}`,
  'all-pins-static': `td[data-pin],th[data-pin]{position:static !important}`,
  'no-edge-cues': `[class*="edge"][data-edge]{display:none !important}[data-cues]::before,[data-cues]::after{display:none !important}`,
  'no-edge-cues+start-pins-static': `[class*="edge"][data-edge]{display:none !important}[data-cues]::before,[data-cues]::after{display:none !important}td[data-pin='start'],th[data-pin='start']{position:static !important}`,
  'contain-rows': `tbody tr[data-item-id]{contain:layout paint style}`,
  'no-head-shift': `table[data-shift] thead{transform:none !important;will-change:auto !important}`,
  'no-sticky-header': `table thead,table[data-shift] thead,table[data-sticky] thead{position:static !important;transform:none !important}`,
};
/** Init-script experiments (before the app loads): redirect the item card's --head-shift write from the <article> (inherited by every descendant) to the bar itself. */
const INIT_EXPERIMENTS: Record<string, string> = {
  'bar-shift-target': `(()=>{const o=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(n,v,p){if(n==='--head-shift'){const a=document.querySelector('[data-testid=item-card]');if(a&&this===a.style){const b=a.querySelector('[data-item-bar]');if(b){return o.call(b.style,n,v,p);}}}return o.call(this,n,v,p);};})();`,
};

const layout = JSON.stringify({ widths: {}, hidden: null, pins: PINS ? { status: 'start', input: 'start' } : {}, order: null, density: null, collapsed: [] });
const pinsInit = `localStorage.setItem('qym:data-table:v2:run.items.v2', ${JSON.stringify(layout)});`;

const SAMPLER = `
window.__start = (target) => {
  const P = window.__perf; P.frames = []; P.stop = false; P.commits0 = P.commits;
  const sc = document.getElementById('shell-content');
  const nav = document.querySelector('[data-run-nav]'); const filters = document.querySelector('[data-run-filters]');
  const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
  const fl = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
  const line = Math.max(n, fl);
  let last = 0;
  const tick = (t) => {
    if (P.stop) return;
    const f = { t, dt: last ? t - last : 0, st: sc.scrollTop }; last = t;
    if (target === 'detail') {
      const bar = document.querySelector('[data-item-bar]');
      if (bar) f.bar = bar.getBoundingClientRect().top - line;
    } else {
      const rows = Array.from(document.querySelectorAll('tbody tr[data-item-id]')).slice(2, 8);
      let worst = 0; let cells = 0;
      for (const r of rows) {
        const un = r.querySelector('td:not([data-pin])'); if (!un) continue;
        for (const td of r.querySelectorAll('td[data-pin]')) { cells++; worst = Math.max(worst, Math.abs(td.getBoundingClientRect().top - un.getBoundingClientRect().top)); }
      }
      f.pinY = worst; f.pinCells = cells;
    }
    P.frames.push(f);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
window.__stop = () => { window.__perf.stop = true; return { frames: window.__perf.frames, commits: window.__perf.commits - window.__perf.commits0 }; };
`;

const browser = await launch();
const runs: Array<Record<string, unknown>> = [];
for (let rep = 0; rep < REPS; rep++) {
  const { page, cdp } = await newPage(browser, { width: WIDTH, height: 900, init: [STORAGE_INIT, pinsInit, SAMPLER, ...(INIT_EXPERIMENTS[EXPERIMENT] ? [INIT_EXPERIMENTS[EXPERIMENT]!] : [])] });
  await cdp.send('Performance.enable');
  if (TARGET === 'detail') {
    await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
    const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
    await card.waitFor();
    await card.getByRole('button', { name: 'Expand all output keys' }).click();
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const sc = document.getElementById('shell-content')!;
      const bar = document.querySelector('[data-item-bar]') as HTMLElement;
      const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
      const line = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
      sc.scrollTop += bar.getBoundingClientRect().top - line - 100; // the item starts 100 px under the line
    });
  } else {
    await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.big1200}`);
    await page.getByTestId('items-count').waitFor();
    await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
    await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
  }
  if (EXPERIMENT && EXPERIMENTS[EXPERIMENT]) await page.addStyleTag({ content: EXPERIMENTS[EXPERIMENT]! });
  await page.waitForTimeout(700);
  const probe = await page.evaluate((t) => {
    const sc = document.getElementById('shell-content')!;
    const sticky = Array.from(document.querySelectorAll(t === 'detail' ? '[data-testid=item-card] *, [role=treegrid][aria-label=Items] *' : '[role=treegrid][aria-label=Items] *')).filter((e) => getComputedStyle(e).position === 'sticky').length;
    const pinned = document.querySelectorAll('[role=treegrid][aria-label=Items] [data-pin]').length;
    return { range: sc.scrollHeight - sc.clientHeight, scrollTop: sc.scrollTop, stickyElements: sticky, pinnedCellsInDom: pinned, rowsMounted: document.querySelectorAll('tbody tr[data-item-id]').length, detailElements: document.querySelector('[data-testid=item-card]')?.querySelectorAll('*').length ?? 0 };
  }, TARGET);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // compositor layers
  await cdp.send('LayerTree.enable');
  let layers: Array<{ layerId: string; drawsContent?: boolean; width: number; height: number; backendNodeId?: number }> = [];
  cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: typeof layers }) => { if (e.layers) layers = e.layers; });
  await page.mouse.move(Math.min(WIDTH / 2, 700), 500);
  await page.waitForTimeout(300);
  const m0 = await metricsOf(cdp);
  await page.evaluate((t) => (window as any).__start(t), TARGET); // eslint-disable-line @typescript-eslint/no-explicit-any
  // trace
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = [];
  cdp.on('Tracing.dataCollected', (e: { value: unknown[] }) => events.push(...e.value));
  const tdone = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  if (!NOTRACE) await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] } });
  const t0 = Date.now();
  if (MODE === 'wheel') {
    for (let i = 0; i < 120; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(16); }
  } else {
    // drag the page scroller's scrollbar thumb: native scrollbar at the right edge of #shell-content
    const geo = await page.evaluate(() => { const sc = document.getElementById('shell-content')!; const r = sc.getBoundingClientRect(); return { right: r.right, top: r.top, h: sc.clientHeight, sh: sc.scrollHeight, bar: sc.offsetWidth - sc.clientWidth }; });
    const thumbH = Math.max(30, (geo.h / geo.sh) * geo.h);
    const x = geo.right - Math.max(3, geo.bar / 2);
    const y0 = geo.top + 4 + thumbH / 2;
    const travel = Math.min(geo.h - thumbH - 8, 520);
    await page.mouse.move(x, y0);
    await page.mouse.down();
    for (let i = 1; i <= 120; i++) { await page.mouse.move(x, y0 + (travel * i) / 120); await page.waitForTimeout(16); }
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  if (!NOTRACE) { await cdp.send('Tracing.end'); await tdone; }
  const elapsed = Date.now() - t0;
  const m1 = await metricsOf(cdp);
  const res = await page.evaluate(() => (window as any).__stop()); // eslint-disable-line @typescript-eslint/no-explicit-any
  const lt = await page.evaluate(() => (window as any).__perf.longtasks.length); // eslint-disable-line @typescript-eslint/no-explicit-any
  const frames = res.frames as Array<Record<string, number>>;
  const moving = frames.filter((f) => f.st !== frames[0]!.st);
  const dts = moving.map((f) => f.dt).filter((d) => d > 0);
  // trace summary
  const x = events.filter((e) => e.ph === 'X' && e.dur != null);
  const sum = (name: string) => x.filter((e) => e.name === name).reduce((n, e) => n + e.dur / 1000, 0);
  const count = (name: string) => x.filter((e) => e.name === name).length;
  const ult = x.filter((e) => e.name === 'UpdateLayoutTree');
  const paints = x.filter((e) => e.name === 'Paint');
  const area = (e: any) => { const c = e.args?.data?.clip; return c && c.length >= 8 ? Math.abs((c[2] - c[0]) * (c[5] - c[1])) : 0; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const stuckBar = moving.filter((f) => f.bar !== undefined && f.bar < 40 && f.bar > -40);
  const barErr = stuckBar.map((f) => Math.abs(f.bar!));
  const pinErr = moving.filter((f) => f.pinY !== undefined).map((f) => f.pinY!);
  runs.push({
    rep, probe, frames: moving.length, elapsedMs: elapsed,
    droppedFrames: dts.filter((d) => d > 25).length, worstFrameMs: Math.max(0, ...dts), fpsMedian: Number((1000 / median(dts)).toFixed(1)),
    longTasksOver50ms: lt, reactCommits: res.commits,
    barFramesJudged: stuckBar.length, barMaxErrPx: Number(Math.max(0, ...barErr).toFixed(2)), barFramesOver1px: barErr.filter((v) => v > 1).length,
    pinnedFramesJudged: pinErr.length, pinnedMaxYErrPx: Number(Math.max(0, ...pinErr).toFixed(2)), pinnedFramesOver1px: pinErr.filter((v) => v > 1).length,
    cdp: { recalcStyle: m1.RecalcStyleCount! - m0.RecalcStyleCount!, recalcStyleMs: Number(((m1.RecalcStyleDuration! - m0.RecalcStyleDuration!) * 1000).toFixed(1)), layouts: m1.LayoutCount! - m0.LayoutCount!, layoutMs: Number(((m1.LayoutDuration! - m0.LayoutDuration!) * 1000).toFixed(1)), scriptMs: Number(((m1.ScriptDuration! - m0.ScriptDuration!) * 1000).toFixed(1)), taskMs: Number(((m1.TaskDuration! - m0.TaskDuration!) * 1000).toFixed(1)) },
    trace: {
      updateLayoutTree: { n: ult.length, ms: Number(sum('UpdateLayoutTree').toFixed(1)), elementsStyled: ult.reduce((n, e) => n + (e.args?.elementCount ?? 0), 0), maxElementsOneRecalc: Math.max(0, ...ult.map((e) => e.args?.elementCount ?? 0)) },
      layout: { n: count('Layout'), ms: Number(sum('Layout').toFixed(1)) },
      paint: { n: paints.length, ms: Number(sum('Paint').toFixed(1)), areaMpx: Number((paints.reduce((n, e) => n + area(e), 0) / 1e6).toFixed(2)) },
      layerize: Number(sum('Layerize').toFixed(1)), prePaint: Number(sum('PrePaint').toFixed(1)), commit: Number(sum('Commit').toFixed(1)),
      scrollDispatch: { n: x.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'scroll').length, medianMs: Number(median(x.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'scroll').map((e) => e.dur / 1000)).toFixed(2)) },
    },
    layers: { total: layers.length, drawing: layers.filter((l) => l.drawsContent).length },
  });
  await page.close();
}
await browser.close();
const pick = (k: string) => median(runs.map((r) => r[k] as number));
save(`d1-scroll-${TARGET}-w${WIDTH}-cpu${CPU}-${MODE}${TARGET === 'table' ? '-pins' + PINS : ''}${NOTRACE ? '-notrace' : ''}${EXPERIMENT ? '-x-' + EXPERIMENT : ''}`, {
  target: TARGET, width: WIDTH, cpu: CPU, mode: MODE, pins: PINS,
  median: Object.fromEntries(['droppedFrames', 'worstFrameMs', 'longTasksOver50ms', 'reactCommits', 'barMaxErrPx', 'barFramesOver1px', 'pinnedMaxYErrPx', 'pinnedFramesOver1px'].map((k) => [k, pick(k)])),
  runs,
});
