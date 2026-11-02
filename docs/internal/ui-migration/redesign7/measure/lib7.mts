/**
 * Shared helpers of the round-7 measurement scripts (reuses the perf6 lib: browser launch, in-page instrumentation,
 * trace summaries, `save`). Run any script from the repo root with Node 24:
 *   PERF_BASE=http://127.0.0.1:8971 R7_SEED=<seed-r7 output json> PERF_SEED=<the same file> PERF_OUT=<dir> node docs/internal/ui-migration/redesign7/measure/<script>.mts
 * (PERF_SEED is read at import by the perf6 lib this file re-exports; R7_SEED is what the round-7 scripts use.)
 * The seed json is the output of ../seed-r7.mts (`node seed-r7.mts <platform url> r7-seed seed.json`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export * from '../../perf6/measure/lib.mts';
import { chromium, INIT } from '../../perf6/measure/lib.mts';
import { BASE as PERF_BASE } from '../../perf6/measure/lib.mts';

export const BASE = PERF_BASE;
/** A page like `newPage` but with `hasTouch` only (desktop layout, touch gestures) and the default scrollbars kept (no --hide-scrollbars). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function newPageTouch(browser: any, opts: { width: number; height?: number; init?: string[] }) {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height ?? 900 }, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  for (const s of opts.init ?? []) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
/** `PW_CHANNEL=chromium` runs the full browser in new headless mode (threaded compositor scrolling as a user has it); default is the headless shell. */
export async function launch() {
  const channel = process.env.PW_CHANNEL || undefined;
  return chromium.launch({ ...(channel ? { channel } : {}), ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-dev-shm-usage', '--enable-precise-memory-info'] });
}
/** Screenshots of round 7 (the perf6 lib's own `shotsDir` points at perf6/shots). */
export const shotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
export interface R7Seed {
  slug: string;
  passes1200: string;
  big1200: string;
  jsonKeys: string;
  repeat300: string[];
  repeat3: string[];
  classic: string[];
  keys: Record<string, string>;
}
/** The seed output; the gallery scripts need no seed, so a missing file gives an empty object instead of an error. */
export const r7 = (() => {
  try {
    return JSON.parse(readFileSync(process.env.R7_SEED ?? process.env.PERF_SEED ?? 'seed-r7.json', 'utf8')) as R7Seed;
  } catch {
    return {} as R7Seed;
  }
})();

/** DevTools "Fast 3G": 1.6 Mbit/s down (x0.9), 750 kbit/s up, 562.5 ms latency. */
export const FAST3G = { offline: false, latency: 562.5, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 };

/** localStorage defaults every script sets before the app loads: 50 runs per page, 500 items per page. */
export const STORAGE_INIT = `localStorage.setItem('qym:runs:page-size','50');localStorage.setItem('qym:run-page-size','500');`;
