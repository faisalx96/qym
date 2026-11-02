/**
 * Review (round 7): is a compositor-driven item bar (F4: a scroll-driven animation on the page scroller, the JS translate as fallback) feasible later?
 * A measurement-only prototype injected into the production build (never product code): on item j-01 of the seeded `jsonKeys` run (every output key open) the bar gets a Web
 * Animations `ScrollTimeline` on `#shell-content`: translateY(0 -> articleH - barH) over the scroll range [articleTop - lineOffset, + (articleH - barH)], linear, fill both.
 * These are the same cached numbers `useStickyShift` uses (computeShift with no details). The shipped JS writes (`--head-shift`) stay on, the animation overrides `transform`.
 * Per rAF frame the bar's top against a CSS-sticky control on the same line, over 120 wheel notches of 40 px; plus the trace's `Animation` events for the bar
 * (`compositeFailed` is 0 when the animation runs on the compositor), `getAnimations()` and the timeline class.
 *   VARIANT=shipped|f4 WIDTH=1440 node r7r-d1-f4.mts
 */
import { BASE, r7, save, median, launch, newPage, STORAGE_INIT } from '../lib7.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const browser = await launch();
const out: Record<string, unknown> = {};
for (const variant of ['shipped', 'f4']) {
  const { page, cdp } = await newPage(browser, { width: WIDTH, height: 900, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
  const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
  await card.waitFor();
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await page.waitForTimeout(800);
  const setup = await page.evaluate(({ v }) => {
    const sc = document.getElementById('shell-content')!;
    const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
    const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
    const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
    const f = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
    const line = Math.max(n, f);
    const lineOff = line - sc.getBoundingClientRect().top;
    const bar = document.querySelector('[data-item-bar]') as HTMLElement;
    const article = bar.closest('article') as HTMLElement;
    const ctl = document.createElement('div');
    ctl.id = 'r7-ctl';
    ctl.style.cssText = `position:sticky;top:${lineOff}px;height:12px;width:40px;background:#0ff;z-index:60;pointer-events:none`;
    document.getElementById('run-items')!.insertBefore(ctl, document.getElementById('run-items')!.firstChild);
    // geometry in the scroller's content space, at the current scroll position
    const shift = parseFloat(bar.style.getPropertyValue('--head-shift')) || 0;
    const articleTopC = article.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const articleH = article.getBoundingClientRect().height;
    const barH = bar.getBoundingClientRect().height;
    const start = articleTopC - lineOff;
    const dist = articleH - barH;
    let info: Record<string, unknown> = { hasScrollTimeline: typeof (window as any).ScrollTimeline !== 'undefined', shiftAtSetup: shift, start, dist, end: start + dist }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (v === 'f4') {
      const ST = (window as any).ScrollTimeline; // eslint-disable-line @typescript-eslint/no-explicit-any
      const timeline = new ST({ source: sc, axis: 'block' });
      const anim = (bar as any).animate({ transform: ['translateY(0px)', `translateY(${dist}px)`] }, { timeline, fill: 'both', easing: 'linear', rangeStart: `${start}px`, rangeEnd: `${start + dist}px` }); // eslint-disable-line @typescript-eslint/no-explicit-any
      (window as any).__anim = anim; // eslint-disable-line @typescript-eslint/no-explicit-any
      info = { ...info, timeline: timeline.constructor.name, rangeStart: String(anim.rangeStart), rangeEnd: String(anim.rangeEnd), animations: bar.getAnimations().length, playState: anim.playState };
    }
    sc.scrollTop = start - 150 + 100; // the item starts 100 px above... (the bar's natural top is 100 px under the line, then scrolls into the line)
    return { line, ...info };
  }, { v: variant });
  await page.waitForTimeout(500);
  const traceEv: Array<{ name?: string; ph?: string; args?: { data?: Record<string, unknown> } }> = [];
  cdp.on('Tracing.dataCollected', (e: { value: typeof traceEv }) => traceEv.push(...e.value));
  const tdone = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] } });
  await page.evaluate((line) => {
    const P = ((window as any).__s = { frames: [] as Array<{ bar: number; ctl: number; st: number }>, stop: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bar = document.querySelector('[data-item-bar]') as HTMLElement; const ctl = document.getElementById('r7-ctl')!; const sc = document.getElementById('shell-content')!;
    const tick = () => { if (P.stop) return; P.frames.push({ bar: bar.getBoundingClientRect().top - line, ctl: ctl.getBoundingClientRect().top - line, st: sc.scrollTop }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, setup.line);
  await page.mouse.move(Math.min(WIDTH / 2, 700), 500);
  for (let i = 0; i < 120; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(16); }
  await page.waitForTimeout(250);
  await cdp.send('Tracing.end');
  await tdone;
  const frames = (await page.evaluate(() => { (window as any).__s.stop = true; return (window as any).__s.frames; })) as Array<{ bar: number; ctl: number; st: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const moving = frames.filter((f) => f.st !== frames[0]!.st);
  // frames where the bar is stuck: the control sits on the line (its offset from the line is 0)
  const err = moving.map((f) => Math.abs(f.bar - f.ctl));
  const animEv = traceEv.filter((e) => e.name === 'Animation');
  out[variant] = {
    setup, framesJudged: err.length, medianErrPx: Number(median(err).toFixed(2)), maxErrPx: Number(Math.max(0, ...err).toFixed(2)), framesOver1px: err.filter((e) => e > 1).length,
    animationTraceEvents: animEv.length, animationNames: Array.from(new Set(animEv.map((e) => JSON.stringify({ ph: e.ph, ...e.args?.data })))).slice(0, 14).map((x) => x.slice(0, 300)),
    sample: err.slice(0, 40).map((e) => Number(e.toFixed(1))),
  };
  await page.close();
}
await browser.close();
save(`r7r-d1-f4-${WIDTH}`, out);
