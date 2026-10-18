/**
 * Part A baseline: scroll cost and frozen-column / sticky-header lag.
 *   TABLE=runs|items  WIDTH=1440  TOUCH=0|1  CPU=1|4  REPS=3  node scroll-table.mts
 * runs : horizontal wheel (or touch) scroll over 2 s of the runs list with run + status + 2 metric columns frozen.
 * items: vertical wheel (or touch) scroll over 2 s of the 1,200-item table with the sticky header, two expanded items and the ItemBar.
 * Per frame (requestAnimationFrame) it records the frozen cell's x against its target x, header-vs-cell alignment, the sticky
 * header's y against the sticky line; per run it adds React commits (devtools hook), long tasks, layout/style counters and a
 * Chromium timeline trace (layouts inside scroll event dispatches, layouts carrying a JS stack = forced).
 */
import { BASE, seed, save, median, pct, launch, newPage, traced, metricsOf, svgToPng, linePlot } from './lib.mts';

const TABLE = (process.env.TABLE ?? 'runs') as 'runs' | 'items';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const TOUCH = process.env.TOUCH === '1';
const CPU = Number(process.env.CPU ?? 1);
const REPS = Number(process.env.REPS ?? 3);
const PLOT = process.env.PLOT ?? '';
const LEAN = process.env.LEAN === '1'; // sampler records only frame times (its own reads are the cost)
const NOTRACE = process.env.NOTRACE === '1'; // frame timing without the tracing overhead

const pinsInit = `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-${seed.metrics[0]}':'start','metric-${seed.metrics[1]}':'start'},order:null,density:null,collapsed:[]}));
localStorage.setItem('qym:runs:page-size','50');
localStorage.setItem('qym:run-page-size','500');`;

const SAMPLER = `
window.__startSampler = (mode) => {
  const P = window.__perf; P.frames = []; P.stop = false; P.mode = mode; P.commits0 = P.commits;
  const sc = mode === 'runs' ? document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') : document.getElementById('shell-content');
  const cols = ['run','status','metric-m01','metric-m02'];
  const prev = (td) => { let w = 0; for (let e = td.previousElementSibling; e; e = e.previousElementSibling) w += e.getBoundingClientRect().width; return w; };
  let last = 0;
  const tick = (t) => {
    if (P.stop) return;
    const f = { t, dt: last ? t - last : 0 }; last = t;
    if (window.__lean) { f.sl = sc.scrollLeft; f.st = sc.scrollTop; f.cells = []; P.frames.push(f); requestAnimationFrame(tick); return; }
    if (mode === 'runs') {
      const sr = sc.getBoundingClientRect();
      f.sl = sc.scrollLeft; f.cells = [];
      const row = document.querySelector('[data-testid="runs-table"] tbody tr[data-run-id]');
      for (const c of cols) {
        const td = row && row.querySelector('td[data-col="' + c + '"]');
        const th = document.querySelector('[data-testid="runs-table"] thead th[data-col="' + c + '"]');
        if (!td || !th) continue;
        const cs = getComputedStyle(td);
        if (cs.position !== 'sticky') continue;
        const off = parseFloat(cs.left);
        const r = td.getBoundingClientRect();
        const natural = sr.left + prev(td) - sc.scrollLeft;
        const expected = Math.max(natural, sr.left + off);
        f.cells.push({ c, lag: r.left - expected, head: th.getBoundingClientRect().left - r.left });
      }
    } else {
      const nav = document.querySelector('[data-run-nav]'); const filters = document.querySelector('[data-run-filters]');
      const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
      const fl = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
      const line = Math.max(n, fl);
      const table = document.querySelector('[role=treegrid][aria-label=Items]');
      const th = table && table.querySelector(':scope > thead th');
      f.st = sc.scrollTop;
      if (th) {
        f.stuck = table.hasAttribute('data-stuck'); f.held = table.hasAttribute('data-held');
        f.shift = parseFloat(table.style.getPropertyValue('--head-shift')) || 0;
        f.headLag = th.getBoundingClientRect().top - line;
      }
    }
    P.frames.push(f);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
window.__stopSampler = () => { window.__perf.stop = true; return { frames: window.__perf.frames, commits: window.__perf.commits - window.__perf.commits0 }; };
`;

const browser = await launch();
const runs: unknown[] = [];
for (let rep = 0; rep < REPS; rep++) {
  const { ctx, page, cdp } = await newPage(browser, { width: WIDTH, height: 900, touch: TOUCH, init: [pinsInit] });
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (TABLE === 'runs') {
    await page.goto(`${BASE}/projects/${seed.slug}`);
    await page.locator('[data-testid="runs-table"] tbody tr[data-run-id], [data-testid="runs-table"] li[data-run-id]').first().waitFor();
  } else {
    await page.goto(`${BASE}/projects/${seed.slug}/runs/${seed.big}`);
    await page.getByTestId('items-count').waitFor();
    await page.locator('#run-items').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
    await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
    for (const n of [1, 6]) await page.getByRole('button', { name: `Open item #${n}`, exact: true }).click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.evaluate(SAMPLER);
  if (LEAN) await page.evaluate(() => ((window as any).__lean = true)); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.waitForTimeout(500);
  const probe = await page.evaluate(
    (t) => {
      if (t === 'runs') {
        const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement | null;
        const sticky = Array.from(document.querySelectorAll('[data-testid="runs-table"] tbody tr td')).slice(0, 12).filter((e) => getComputedStyle(e).position === 'sticky').length;
        const all = Array.from(document.querySelectorAll('[data-testid="runs-table"] *')).filter((e) => getComputedStyle(e).position === 'sticky').length;
        return { scrollable: sc ? sc.scrollWidth - sc.clientWidth : -1, stickyCellsInFirstRow: sticky, stickyElements: all, cards: !sc };
      }
      const all = Array.from(document.querySelectorAll('[role=treegrid][aria-label=Items] *')).filter((e) => getComputedStyle(e).position === 'sticky').length;
      return { rowsMounted: document.querySelectorAll('tbody tr[data-item-id]').length, stickyElements: all };
    },
    TABLE,
  );
  const target = TABLE === 'runs' ? '[data-testid="runs-table"] tbody' : '[role=treegrid][aria-label=Items] tbody';
  const box = await page.locator(target).first().boundingBox();
  const cx = box ? box.x + Math.min(box.width / 2, 600) : WIDTH / 2;
  const cy = TABLE === 'runs' ? (box?.y ?? 300) + 40 : 500;
  await page.mouse.move(cx, cy);
  const m0 = await metricsOf(cdp);
  await page.evaluate((m) => (window as any).__startSampler(m), TABLE); // eslint-disable-line @typescript-eslint/no-explicit-any
  const t0 = Date.now();
  const run = async () => {
    if (TOUCH) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: cx, y: cy,
        xDistance: TABLE === 'runs' ? -(Math.max(100, WIDTH / 2.5)) : 0, yDistance: TABLE === 'items' ? -400 : 0,
        speed: 1800, gestureSourceType: 'touch', repeatCount: 14, repeatDelayMs: 40,
      });
    } else {
      for (let i = 0; i < 120; i++) {
        await page.mouse.wheel(TABLE === 'runs' ? 60 : 0, TABLE === 'items' ? 60 : 0);
        await page.waitForTimeout(16);
      }
    }
    await page.waitForTimeout(300);
  };
  const trace = NOTRACE
    ? (await run(), { layouts: -1, layoutsInScrollDispatch: -1, layoutsWithStack: -1, recalcStyle: -1, scrollDispatches: 0, scrollDispatchMs: [] as number[], beginMainFrames: 0, byName: {} })
    : await traced(cdp, run);
  const elapsed = Date.now() - t0;
  const m1 = await metricsOf(cdp);
  const res = await page.evaluate(() => (window as any).__stopSampler()); // eslint-disable-line @typescript-eslint/no-explicit-any
  const lt = await page.evaluate(() => (window as any).__perf.longtasks.length); // eslint-disable-line @typescript-eslint/no-explicit-any
  const frames = res.frames as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const moving = frames.filter((f) => (TABLE === 'runs' ? f.sl : f.st) !== (frames[0]?.[TABLE === 'runs' ? 'sl' : 'st']));
  const dts = moving.map((f) => f.dt).filter((d) => d > 0);
  const lagSeries: Array<[number, number]> = [];
  let maxLag = 0, framesOver1 = 0, maxHeadMis = 0;
  moving.forEach((f, i) => {
    const l = TABLE === 'runs' ? Math.max(0, ...f.cells.map((c: any) => Math.abs(c.lag))) : f.stuck && !f.held ? Math.abs(f.headLag) : 0; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (TABLE === 'runs') maxHeadMis = Math.max(maxHeadMis, ...f.cells.map((c: any) => Math.abs(c.head))); // eslint-disable-line @typescript-eslint/no-explicit-any
    lagSeries.push([i, l]);
    maxLag = Math.max(maxLag, l);
    if (l > 1) framesOver1++;
  });
  const scrollPx = moving.length ? Math.abs((moving.at(-1)![TABLE === 'runs' ? 'sl' : 'st'] ?? 0) - (frames[0]![TABLE === 'runs' ? 'sl' : 'st'] ?? 0)) : 0;
  runs.push({
    rep, probe, stickyElements: (probe as any).stickyElements, stuckFrames: moving.filter((f) => f.stuck).length, heldFrames: moving.filter((f) => f.held).length, scrollPx, elapsedMs: elapsed, frames: moving.length,
    fpsMedian: Number((1000 / median(dts)).toFixed(1)),
    fpsP5: Number((1000 / pct(dts, 95)).toFixed(1)),
    droppedFrames: dts.filter((d) => d > 25).length,
    worstFrameMs: Math.max(0, ...dts),
    maxLagPx: Number(maxLag.toFixed(2)), framesLagOver1px: framesOver1, maxHeaderCellMisalignPx: Number(maxHeadMis.toFixed(2)),
    reactCommitsDuringScroll: res.commits,
    commitsPerScrollSecond: Number((res.commits / (elapsed / 1000)).toFixed(1)),
    longTasksOver50ms: lt,
    layoutCountDelta: m1.LayoutCount! - m0.LayoutCount!, recalcStyleDelta: m1.RecalcStyleCount! - m0.RecalcStyleCount!,
    layoutMsDelta: Number(((m1.LayoutDuration! - m0.LayoutDuration!) * 1000).toFixed(1)),
    scriptMsDelta: Number(((m1.ScriptDuration! - m0.ScriptDuration!) * 1000).toFixed(1)),
    taskMsDelta: Number(((m1.TaskDuration! - m0.TaskDuration!) * 1000).toFixed(1)),
    trace: { ...trace, scrollDispatchMs: { n: trace.scrollDispatchMs.length, median: Number(median(trace.scrollDispatchMs).toFixed(3)), p95: Number(pct(trace.scrollDispatchMs, 95).toFixed(3)), max: Number(Math.max(0, ...trace.scrollDispatchMs).toFixed(3)) } },
    ...(rep === 0 ? { lagSeries } : {}),
  });
  if (rep === 0 && PLOT) {
    await svgToPng(
      browser,
      linePlot({
        title: `${PLOT.replace('before-A-', '')}: frame time per frame, 2 s ${TABLE === 'runs' ? 'horizontal' : 'vertical'} wheel scroll (${WIDTH}px, cpu x${CPU})`,
        w: 760, h: 260,
        series: [
          { name: 'frame time ms', color: '#6aa9ff', pts: moving.map((f, i) => [i, f.dt || 0] as [number, number]) },
          { name: `max position lag ${maxLag.toFixed(1)} px (DOM)`, color: '#e5694b', pts: lagSeries },
        ],
        xLabel: 'frame', yLabel: 'ms', hlines: [{ y: 16.7, label: '60 fps budget 16.7 ms' }, { y: 50, label: 'long task 50 ms' }],
      }),
      `${PLOT}.png`, 760, 260,
    );
  }
  await ctx.close();
}
await browser.close();
const pick = (k: string) => median(runs.map((r) => (r as any)[k])); // eslint-disable-line @typescript-eslint/no-explicit-any
save(`scroll-${TABLE}-${WIDTH}${TOUCH ? '-touch' : ''}-cpu${CPU}${NOTRACE ? '-notrace' : ''}${LEAN ? '-lean' : ''}`, {
  table: TABLE, width: WIDTH, touch: TOUCH, cpu: CPU,
  median: Object.fromEntries(['fpsMedian', 'stickyElements', 'stuckFrames', 'droppedFrames', 'maxLagPx', 'framesLagOver1px', 'maxHeaderCellMisalignPx', 'reactCommitsDuringScroll', 'longTasksOver50ms', 'layoutCountDelta', 'scriptMsDelta', 'taskMsDelta'].map((k) => [k, pick(k)])),
  runs: runs.map((r: any) => ({ ...r, lagSeries: undefined })), // eslint-disable-line @typescript-eslint/no-explicit-any
});
