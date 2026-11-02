/// <reference lib="dom" />
/**
 * Perf-spec helpers (perf round 6). Counts (React commits, forced layouts, requests, bytes) assert exactly because
 * they do not depend on machine speed; times use the CI margins of docs/internal/ui-migration/perf6/perf.md, and the
 * strict local targets when QYM_PERF_STRICT=1. Every measure is the median of three passes inside one page.
 */
import type { CDPSession, Page } from '@playwright/test';

export const STRICT = process.env.QYM_PERF_STRICT === '1';
/** CI margin by default, the local target under QYM_PERF_STRICT=1. */
export const limit = (ci: number, strict: number): number => (STRICT ? strict : ci);

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Counts React commits through the DevTools hook (must be installed before the app loads: `page.addInitScript`). */
export const COMMIT_HOOK = `
window.__commits = 0;
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true, renderers: new Map(), inject() { return 1; },
  onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
};`;

export const commits = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __commits: number }).__commits);

/** Frame times of an rAF loop while `act` runs: dropped frames (> 25 ms) and the worst frame. */
export async function frames(
  page: Page,
  act: () => Promise<void>,
): Promise<{ dropped: number; worst: number }> {
  await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __stop: boolean };
    w.__f = [];
    w.__stop = false;
    let last = 0;
    const tick = (t: number) => {
      if (w.__stop) return;
      if (last) w.__f.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  const f = await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __stop: boolean };
    w.__stop = true;
    return w.__f;
  });
  return { dropped: f.filter((d) => d > 25).length, worst: Math.max(0, ...f) };
}

interface TraceEvent {
  ph: string;
  name: string;
  ts: number;
  tid: number;
  dur: number;
  args?: {
    data?: { type?: string };
    beginData?: { stackTrace?: Array<{ url?: string }> };
    elementCount?: number;
  };
}

export interface TraceCounts {
  /** Layout events inside a scroll event dispatch. */
  layoutsInScroll: number;
  /** Layout events whose JS stack starts in the app's own scripts (not the harness). */
  appForcedLayouts: number;
  scrollDispatches: number;
  scrollMsMedian: number;
  /** Style recalculations (UpdateLayoutTree) in the traced window, the elements they styled in total and in the largest one. */
  styleRecalcs: number;
  elementsStyled: number;
  maxElementsOneRecalc: number;
}

/** A Chromium timeline trace around `act`, summarised the way docs/internal/ui-migration/perf6/measure/lib.mts does. */
export async function traced(cdp: CDPSession, act: () => Promise<void>): Promise<TraceCounts> {
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (e: { value: unknown[] }) => events.push(...(e.value as TraceEvent[])));
  const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
      ],
    },
  });
  await act();
  await cdp.send('Tracing.end');
  await done;
  const x = events.filter((e) => e.ph === 'X' && e.dur != null);
  const scrolls = x.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'scroll');
  const layouts = x.filter((e) => e.name === 'Layout');
  const recalcs = x.filter((e) => e.name === 'UpdateLayoutTree');
  const inScroll = (e: TraceEvent) =>
    scrolls.some((s) => s.tid === e.tid && e.ts >= s.ts && e.ts <= s.ts + s.dur);
  const fromApp = (l: TraceEvent) => /\/(assets|src)\//.test(l.args?.beginData?.stackTrace?.[0]?.url ?? '');
  return {
    layoutsInScroll: layouts.filter(inScroll).length,
    appForcedLayouts: layouts.filter(fromApp).length,
    scrollDispatches: scrolls.length,
    scrollMsMedian: median(scrolls.map((s) => s.dur / 1000)),
    styleRecalcs: recalcs.length,
    elementsStyled: recalcs.reduce((n, e) => n + (e.args?.elementCount ?? 0), 0),
    maxElementsOneRecalc: Math.max(0, ...recalcs.map((e) => e.args?.elementCount ?? 0)),
  };
}

export async function throttleCpu(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** Fast 3G, the DevTools preset: 1.6 Mbit/s down (x0.9), 750 kbit/s up, 562.5 ms latency. */
export async function fast3g(cdp: CDPSession): Promise<void> {
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 562.5,
    downloadThroughput: (1.6e6 / 8) * 0.9,
    uploadThroughput: (750e3 / 8) * 0.9,
  });
}

export async function noThrottle(cdp: CDPSession): Promise<void> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

/** The API requests of a page (path + query, encoded size) from the moment this is called. */
export function logRequests(page: Page): Array<{ url: string; start: number; bytes: number }> {
  const log: Array<{ url: string; start: number; bytes: number }> = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    let bytes = 0;
    try {
      bytes = (await r.body()).length;
    } catch {
      /* aborted */
    }
    log.push({ url: u.pathname + u.search, start: Date.now(), bytes });
  });
  return log;
}
