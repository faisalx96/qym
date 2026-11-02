/**
 * D1, what the reader sees: how far the frozen item bar (number, verdict, INPUT preview: `[data-item-bar]`, moved by useStickyShift
 * with a JS translate) is presented from the sticky line while an expanded item scrolls under it, compared with a native CSS-sticky
 * control element placed on the same line. Both are painted in the COMPOSITED frames (CDP Page.screencast: bar magenta, control cyan)
 * and decoded per presented frame, so a main thread that is busy while the compositor keeps scrolling shows as an offset.
 *   WIDTH=1440 CPU=1|4 JANK=0|50 (ms of main-thread block every PERIOD ms) PERIOD=120 node d1-bar-jank.mts
 * Fixture: the seeded `jsonKeys` run, item j-01 opened with every output key expanded (a detail about 1,900 px tall), page scroller
 * (`#shell-content`) driven by 120 wheel events of 40 px over 2 s.
 *   D1-3b (round 7 implementation): BLOCK=400 PRESTUCK=1 node d1-bar-jank.mts. A synchronous main-thread block of BLOCK ms is started with page.evaluate
 *   (not awaited), then one compositor scroll gesture (Input.synthesizeScrollGesture) runs while the screencast and a trace record. The bar starts stuck
 *   (PRESTUCK=1: the item begins 100 px above the line). A plain, non-sticky yellow marker in the scroller tells which presented frames moved the page.
 *   Result: for every presented frame in which the page moved, |bar y - control y| (the control is the compositor's sticky truth); how many of those frames
 *   fall inside the block window (did headless scroll on the compositor while the main thread was blocked?), and the `ScrollTree::ScrollBy` compositor events
 *   that the trace holds inside the window.
 * Result: per presented frame offset of the bar and of the control from their reference (the control's y is the compositor's sticky line),
 * frames with |offset| > 1 px, worst offset, presented fps; plus the DOM view (rAF) for comparison.
 */
import { BASE, r7, save, median, pct, launch, newPage, newPageTouch, STORAGE_INIT } from '../lib7.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const CPU = Number(process.env.CPU ?? 1);
const JANK = Number(process.env.JANK ?? 0);
const PERIOD = Number(process.env.PERIOD ?? 120);
const REPS = Number(process.env.REPS ?? 1);
/** SYNTH=1: one continuous synthesized scroll gesture (a trackpad flick; the compositor resolves the scroll target once and then scrolls on its own thread) instead of 120 separate wheel notches. */
const SYNTH = process.env.SYNTH === '1';
/** BLOCK=<ms>: D1-3b, see above. PRESTUCK=1: the item starts above the line so the bar is stuck for the whole gesture. */
const BLOCK = Number(process.env.BLOCK ?? 0);
const PRESTUCK = process.env.PRESTUCK === '1' || BLOCK > 0;
/** TOUCH=1: a touch drag (Input.dispatchTouchEvent): the compositor starts one scroll gesture and keeps scrolling while the main thread is busy, as a trackpad or a phone does. */
const TOUCH = process.env.TOUCH === '1';

const css = `[data-item-bar]{background:#ff00ff !important;border-color:#ff00ff !important}[data-item-bar] *{visibility:hidden !important}`;
const browser = await launch();
const reps: Array<Record<string, unknown>> = [];
for (let rep = 0; rep < REPS; rep++) {
  const { ctx, page, cdp } = await (TOUCH || BLOCK > 0 ? newPageTouch : newPage)(browser, {
    width: WIDTH, height: 900,
    init: [STORAGE_INIT, `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);});`],
  });
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
  const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
  await card.waitFor();
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await page.waitForTimeout(800);
  const setup = await page.evaluate((pre) => {
    const sc = document.getElementById('shell-content')!;
    const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
    const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
    const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
    const f = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
    const line = Math.max(n, f);
    const sec = document.getElementById('run-items')!;
    const ctl = document.createElement('div');
    ctl.id = 'r7-ctl';
    ctl.style.cssText = `position:sticky;top:${line - sc.getBoundingClientRect().top}px;height:12px;width:40px;margin-top:-0px;background:#00ffff;z-index:60;pointer-events:none`;
    sec.insertBefore(ctl, sec.firstChild);
    const bar = document.querySelector('[data-item-bar]') as HTMLElement;
    const article = bar.closest('article') as HTMLElement;
    const ar = article.getBoundingClientRect();
    // scroll so the item starts 150 px under the line (PRESTUCK: 100 px above it, the bar is stuck from the first frame)
    sc.scrollTop += ar.top - line - (pre ? -100 : 150);
    if (pre) {
      // a plain marker (not sticky) tells which presented frames moved the page
      const mk = document.createElement('div');
      mk.id = 'r7-mark';
      mk.style.cssText = `position:absolute;left:${sc.getBoundingClientRect().width - 120}px;top:${sc.scrollTop + 500}px;width:60px;height:12px;background:#ffff00;z-index:60;pointer-events:none`;
      sc.style.position = 'relative';
      sc.appendChild(mk);
    }
    const mkr = document.getElementById('r7-mark');
    return { line, itemH: Math.round(ar.height), barX: Math.round(ar.left + 220), ctlX: Math.round(ctl.getBoundingClientRect().left + 5), markX: mkr ? Math.round(mkr.getBoundingClientRect().left + 30) : 0, scrollMax: sc.scrollHeight - sc.clientHeight };
  }, PRESTUCK);
  await page.waitForTimeout(500);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (JANK > 0) await page.evaluate(([j, p]) => { setInterval(() => { const t = performance.now(); while (performance.now() - t < j) { /* block */ } }, p); }, [JANK, PERIOD] as const);
  // DOM sampler (rAF): bar top against the line while the bar is stuck
  await page.evaluate((line) => {
    const P = ((window as any).__s = { frames: [] as Array<{ t: number; bar: number; ctl: number; st: number }>, stop: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bar = document.querySelector('[data-item-bar]') as HTMLElement; const ctl = document.getElementById('r7-ctl')!; const sc = document.getElementById('shell-content')!;
    const tick = (t: number) => { if (P.stop) return; P.frames.push({ t, bar: bar.getBoundingClientRect().top - line, ctl: ctl.getBoundingClientRect().top - line, st: sc.scrollTop }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, setup.line);
  const shots: Array<{ ts: number; data: string }> = [];
  cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    shots.push({ ts: e.metadata.timestamp, data: e.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  });
  await page.mouse.move(Math.min(WIDTH / 2, 700), 500);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH, maxHeight: 900, everyNthFrame: 1 });
  let blockWindow: [number, number] | null = null;
  const traceEv: Array<{ name?: string; ts?: number; dur?: number; ph?: string; tid?: number; args?: Record<string, unknown> }> = [];
  if (BLOCK > 0) {
    cdp.on('Tracing.dataCollected', (e: { value: typeof traceEv }) => traceEv.push(...e.value));
    const tdone = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['cc', 'input', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-cc.debug'] }, transferMode: 'ReportEvents' });
    // r7r: the page is scrolled by something that does not need the main thread. MODE=smooth: a programmatic smooth scroll (started SMOOTHLEAD ms before the block);
    // MODE=drag: the page scroller's scrollbar thumb is pressed, the block starts, then the thumb is dragged (cc::ScrollbarController handles it on the compositor thread).
    const MODE = process.env.MODE ?? 'drag';
    let drag: (() => Promise<void>) | null = null;
    if (MODE === 'smooth') {
      await page.evaluate((dist) => { const sc = document.getElementById('shell-content')!; sc.style.scrollBehavior = 'smooth'; sc.scrollTo({ top: sc.scrollTop + dist, behavior: 'smooth' }); }, Number(process.env.DIST ?? 1500));
      await page.waitForTimeout(Number(process.env.SMOOTHLEAD ?? 120));
    } else {
      const geo = await page.evaluate(() => { const sc = document.getElementById('shell-content')!; const r = sc.getBoundingClientRect(); return { right: r.right, top: r.top, h: sc.clientHeight, sh: sc.scrollHeight, st: sc.scrollTop, bar: sc.offsetWidth - sc.clientWidth }; });
      const thumbH = Math.max(30, (geo.h / geo.sh) * geo.h);
      const x = geo.right - Math.max(3, geo.bar / 2);
      const y0 = geo.top + (geo.st / geo.sh) * geo.h + thumbH / 2;
      await page.mouse.move(x, y0);
      await page.mouse.down();
      drag = async () => { for (let i = 1; i <= 24; i++) { await page.mouse.move(x, y0 + i * 6); await page.waitForTimeout(16); } await page.mouse.up(); };
      (globalThis as any).__r7rGeo = geo; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const blocked = page.evaluate((ms) => { const s = Date.now(); const t = performance.now(); while (performance.now() - t < ms) { /* block */ } return [s, Date.now()] as [number, number]; }, BLOCK);
    if (drag) await drag();
    blockWindow = await blocked;
    await page.waitForTimeout(300);
    await cdp.send('Tracing.end');
    await tdone;
  } else if (TOUCH) {
    // 8 touch drags of 15 moves x 40 px (600 px each): every drag is one scroll gesture the compositor can run ahead of the main thread
    const x0 = Math.min(WIDTH / 2, 700);
    for (let g = 0; g < 8; g++) {
      let y = 800;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let i = 0; i < 15; i++) { y -= 40; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y }] }); await page.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  } else if (SYNTH) {
    await cdp.send('Input.synthesizeScrollGesture', { x: Math.min(WIDTH / 2, 700), y: 500, yDistance: -4800, speed: 2400, gestureSourceType: 'mouse', preventFling: true });
  } else {
    for (let i = 0; i < 120; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(16); }
  }
  await page.waitForTimeout(250);
  await cdp.send('Page.stopScreencast');
  const dom = await page.evaluate(() => { (window as any).__s.stop = true; return (window as any).__s.frames; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  // decode: top edge of the magenta bar at barX and of the cyan control at ctlX in every presented frame
  const dec = await ctx.newPage();
  await dec.setContent('<canvas id=c></canvas>');
  const series: Array<{ t: number; bar: number | null; ctl: number | null; mark?: number | null }> = await dec.evaluate(
    async ({ frames, bx, cx, mx }) => {
      const out: Array<{ t: number; bar: number | null; ctl: number | null; mark?: number | null }> = [];
      const c = document.getElementById('c') as HTMLCanvasElement;
      for (const f of frames) {
        const img = new Image();
        await new Promise<void>((res) => ((img.onload = () => res()), (img.src = 'data:image/jpeg;base64,' + f.data)));
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const find = (x: number, test: (r: number, g: number, b: number) => boolean) => {
          const d = g.getImageData(x, 0, 1, img.height).data;
          for (let y = 0; y < img.height; y++) if (test(d[y * 4]!, d[y * 4 + 1]!, d[y * 4 + 2]!)) return y;
          return null;
        };
        out.push({ t: f.ts, bar: find(bx, (r, gg, b) => r > 200 && gg < 70 && b > 200), ctl: find(cx, (r, gg, b) => r < 70 && gg > 200 && b > 200), mark: mx ? find(mx, (r, gg, b) => r > 200 && gg > 200 && b < 90) : undefined });
      }
      return out;
    },
    { frames: shots, bx: setup.barX, cx: setup.ctlX, mx: setup.markX },
  );
  const withBar = series.filter((s) => s.bar != null && s.ctl != null);
  // frames after the bar first reaches the control line (stuck) until it leaves it
  const first = withBar.findIndex((s) => Math.abs((s.bar as number) - (s.ctl as number)) <= 1);
  const stuckFrames = first < 0 ? [] : withBar.slice(first);
  const offs = stuckFrames.map((s) => (s.bar as number) - (s.ctl as number));
  const domStuck = (dom as Array<{ bar: number; ctl: number }>).filter((f) => Math.abs(f.bar - f.ctl) <= 1 || f.bar < f.ctl + 400).filter((f) => f.bar < f.ctl + 400 && f.bar > -50);
  const dts = series.slice(1).map((s, i) => (s.t - series[i]!.t) * 1000);
  let block: Record<string, unknown> | undefined;
  if (BLOCK > 0 && blockWindow) {
    const [bs, be] = blockWindow;
    // frames in which the page moved: the plain marker changed y against the previous presented frame
    const judged: Array<{ ts: number; off: number; inBlock: boolean }> = [];
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1]!, b = series[i]!;
      if (b.mark == null || a.mark == null || b.bar == null || b.ctl == null || a.mark === b.mark) continue;
      judged.push({ ts: b.t, off: b.bar - b.ctl, inBlock: b.t * 1000 >= bs && b.t * 1000 <= be });
    }
    // the block in the trace's own clock: the longest main-thread task of about BLOCK ms
    const long = traceEv.filter((e) => e.ph === 'X' && (e.dur ?? 0) >= BLOCK * 900).sort((x, y) => (y.dur ?? 0) - (x.dur ?? 0))[0];
    const w0 = long?.ts ?? 0, w1 = long ? long.ts! + long.dur! : 0;
    const scrollBy = traceEv.filter((e) => e.name && /ScrollBy/.test(e.name) && e.ts != null);
    const inWin = scrollBy.filter((e) => e.ts! >= w0 && e.ts! <= w1 && e.tid !== long?.tid);
    block = {
      blockMs: BLOCK, blockWindowMs: Math.round(be - bs),
      // screencast timestamps relative to the block's start (ms): the frames presented before, during and after it, and when the page first moved
      framesBeforeBlock: series.filter((x) => x.t * 1000 < bs).length, framesInBlock: series.filter((x) => x.t * 1000 >= bs && x.t * 1000 <= be).length, framesAfterBlock: series.filter((x) => x.t * 1000 > be).length,
      firstPageMoveMsAfterBlockStart: judged.length ? Math.round(judged[0]!.ts * 1000 - bs) : null,
      framesPageMoved: judged.length, framesPageMovedDuringBlock: judged.filter((j) => j.inBlock).length,
      barOffsetOver1px: judged.filter((j) => Math.abs(j.off) > 1).length, maxBarOffsetPx: Math.max(0, ...judged.map((j) => Math.abs(j.off))),
      maxBarOffsetDuringBlockPx: Math.max(0, ...judged.filter((j) => j.inBlock).map((j) => Math.abs(j.off))),
      traceScrollByEvents: scrollBy.length, traceScrollByNames: Array.from(new Set(scrollBy.map((e) => e.name))).slice(0, 4), traceScrollByOffMainThreadDuringBlock: inWin.length, traceBlockFound: Boolean(long),
      offsets: judged.map((j) => Math.round(j.off)),
    };
  }
  reps.push({
    rep, setup, block, presentedFrames: series.length, framesWithBothMarkers: withBar.length, stuckFramesJudged: stuckFrames.length,
    barOffsetPx: { median: Number(median(offs.map(Math.abs)).toFixed(2)), p95: Number(pct(offs.map(Math.abs), 95).toFixed(2)), max: Number(Math.max(0, ...offs.map(Math.abs)).toFixed(2)) },
    framesBarOffsetOver1px: offs.filter((o) => Math.abs(o) > 1).length,
    framesBarOffsetOver8px: offs.filter((o) => Math.abs(o) > 8).length,
    presentedFps: Number((1000 / median(dts)).toFixed(1)), longestPresentGapMs: Math.round(Math.max(0, ...dts)),
    domFramesJudged: domStuck.length, domMaxBarOffsetPx: Number(Math.max(0, ...domStuck.map((f) => Math.abs(f.bar - f.ctl))).toFixed(2)),
    sample: offs.slice(0, 60).map((o) => Math.round(o)),
  });
  await ctx.close();
}
await browser.close();
save(`r7r-d1-smooth-${WIDTH}-cpu${CPU}-jank${JANK}${BLOCK ? '-block' + BLOCK : TOUCH ? '-touch' : SYNTH ? '-synth' : '-wheel'}`, { width: WIDTH, cpu: CPU, jankMs: JANK, periodMs: PERIOD, reps });
