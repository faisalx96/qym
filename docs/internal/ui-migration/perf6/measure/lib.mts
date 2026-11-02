/**
 * Shared helpers for the perf6 measurement scripts. Run any script with Node 24 from the repo root:
 *   PERF_BASE=http://127.0.0.1:8997 PERF_SEED=<seed.json> node docs/internal/ui-migration/perf6/measure/<script>.mts
 * Playwright comes from frontend/node_modules (createRequire), so no install step lives here.
 * Results are printed as JSON and, with PERF_OUT=<dir>, written to <dir>/<name>.json.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { chromium } = req('playwright-core') as any;

export const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:8997';
export const seed = JSON.parse(readFileSync(process.env.PERF_SEED ?? 'seed.json', 'utf8')) as {
  slug: string;
  big: string;
  wide: string;
  runs: string[];
  metrics: string[];
};
export const outDir = process.env.PERF_OUT ?? '';
export const shotsDir = path.join(here, '..', 'shots');

export function save(name: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${name}.json`), text);
  }
  console.log(text);
}

export const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
export const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

/** In-page instrumentation installed before any app code: React commit counter, long tasks, layout shifts, rAF frames. */
export const INIT = `
(() => {
  const P = (window.__perf = { commits: 0, longtasks: [], shifts: [], frames: [], rec: false, muts: 0, commitTimes: [], loaf: [] });
  // React 18 reports every commit to this hook when it exists at load time.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; },
    onCommitFiberRoot() { P.commits++; P.commitTimes.push(performance.now()); }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ start: e.startTime, dur: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.loaf.push({ start: e.startTime, dur: e.duration, block: e.blockingDuration, styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, scripts: e.scripts.map((x) => ({ d: x.duration, fn: x.sourceFunctionName, inv: x.invoker, url: (x.sourceURL || '').split('/').pop() })) }); })
      .observe({ type: 'long-animation-frame', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) P.shifts.push({ t: e.startTime, v: e.value }); })
      .observe({ type: 'layout-shift', buffered: true });
  } catch {}
})();
`;

export async function launch() {
  return chromium.launch({ args: ['--disable-dev-shm-usage', '--enable-precise-memory-info'] });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function newPage(browser: any, opts: { width: number; height?: number; touch?: boolean; init?: string[] }) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height ?? 900 },
    colorScheme: 'dark',
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(INIT);
  for (const s of opts.init ?? []) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}

export interface TraceSummary {
  layouts: number;
  layoutsInScrollDispatch: number;
  layoutsWithStack: number;
  recalcStyle: number;
  scrollDispatchMs: number[];
  scrollDispatches: number;
  beginMainFrames: number;
  /** total ms by timeline event name (Paint, Layerize, PrePaint, UpdateLayoutTree, FunctionCall, EventDispatch, ...) */
  byName: Record<string, number>;
}

/** Record a Chromium timeline trace around `fn` and summarise layouts inside scroll event dispatches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function traced(cdp: any, fn: () => Promise<void>): Promise<TraceSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = [];
  cdp.on('Tracing.dataCollected', (e: { value: unknown[] }) => events.push(...e.value));
  const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack'],
    },
  });
  await fn();
  await cdp.send('Tracing.end');
  await done;
  const x = events.filter((e) => e.ph === 'X' || e.ph === 'B' || e.ph === 'I');
  const scrolls = x.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'scroll' && e.dur != null);
  const layouts = x.filter((e) => e.name === 'Layout' && e.dur != null);
  const inScroll = (e: { ts: number; tid: number }) =>
    scrolls.some((s) => s.tid === e.tid && e.ts >= s.ts && e.ts <= s.ts + s.dur);
  return {
    layouts: layouts.length,
    layoutsInScrollDispatch: layouts.filter(inScroll).length,
    layoutsWithStack: layouts.filter((l) => (l.args?.beginData?.stackTrace?.length ?? 0) > 0).length,
    recalcStyle: x.filter((e) => e.name === 'UpdateLayoutTree').length,
    scrollDispatches: scrolls.length,
    scrollDispatchMs: scrolls.map((s) => s.dur / 1000),
    beginMainFrames: x.filter((e) => e.name === 'BeginMainThreadFrame').length,
    byName: byName(x),
  };
}

export async function metricsOf(cdp: any): Promise<Record<string, number>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
}

/** Render a small SVG as a PNG (under 300 KB) with a throwaway page. */
export async function svgToPng(browser: any, svg: string, file: string, w: number, h: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  mkdirSync(shotsDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:#12151b">${svg}</body>`);
  await p.screenshot({ path: path.join(shotsDir, file) });
  await ctx.close();
}

export function linePlot(opts: {
  title: string;
  w: number;
  h: number;
  series: Array<{ name: string; color: string; pts: Array<[number, number]> }>;
  xLabel: string;
  yLabel: string;
  hlines?: Array<{ y: number; label: string }>;
}): string {
  const { w, h } = opts;
  const m = { l: 56, r: 16, t: 34, b: 38 };
  const all = opts.series.flatMap((s) => s.pts);
  const xmax = Math.max(1, ...all.map((p) => p[0]));
  const ymax = Math.max(1, ...(opts.hlines ?? []).map((l) => l.y), ...all.map((p) => p[1])) * 1.1;
  const X = (x: number) => m.l + (x / xmax) * (w - m.l - m.r);
  const Y = (y: number) => h - m.b - (y / ymax) * (h - m.t - m.b);
  const lines = opts.series
    .map(
      (s) =>
        `<polyline fill="none" stroke="${s.color}" stroke-width="1.6" points="${s.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`,
    )
    .join('');
  const legend = opts.series
    .map((s, i) => `<text x="${w - m.r - 4}" y="${m.t + 12 + i * 14}" fill="${s.color}" font-size="11" text-anchor="end" font-family="monospace">${s.name}</text>`)
    .join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(f * ymax)}" y2="${Y(f * ymax)}" stroke="#2a2f3a"/><text x="${m.l - 6}" y="${Y(f * ymax) + 4}" fill="#9aa3b2" font-size="11" text-anchor="end" font-family="monospace">${(f * ymax).toFixed(1)}</text>`,
    )
    .join('');
  const hl = (opts.hlines ?? [])
    .map(
      (l) =>
        `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(l.y)}" y2="${Y(l.y)}" stroke="#e5a04b" stroke-dasharray="4 3"/><text x="${m.l + 4}" y="${Y(l.y) - 4}" fill="#e5a04b" font-size="11" font-family="monospace">${l.label}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${m.l}" y="16" fill="#e6e9ef" font-size="13" font-family="monospace">${opts.title}</text>${ticks}${hl}${lines}${legend}<text x="${w / 2}" y="${h - 8}" fill="#9aa3b2" font-size="11" text-anchor="middle" font-family="monospace">${opts.xLabel}</text><text x="12" y="${h / 2}" fill="#9aa3b2" font-size="11" transform="rotate(-90 12 ${h / 2})" text-anchor="middle" font-family="monospace">${opts.yLabel}</text></svg>`;
}

function byName(x: Array<{ name: string; dur?: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of x) if (e.dur != null && e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask') out[e.name] = (out[e.name] ?? 0) + e.dur / 1000;
  return Object.fromEntries(
    Object.entries(out)
      .filter(([, v]) => v > 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([k, v]) => [k, Number(v.toFixed(1))]),
  );
}
