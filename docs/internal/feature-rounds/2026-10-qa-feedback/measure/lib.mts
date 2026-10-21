/**
 * Shared helpers of the QA-B (experiments) design measurements. Node 24, Playwright from frontend/node_modules.
 *   PERF_BASE=http://127.0.0.1:8982 VITE_BASE=http://127.0.0.1:5982 SEED_QAB=<seed-b output json> node <script>.mts
 * The platform serves the API on PERF_BASE; pages and the gallery come from Vite (VITE_BASE).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { chromium } = req('playwright-core') as any;

export const API = process.env.PERF_BASE ?? 'http://127.0.0.1:8982';
export const APP = process.env.VITE_BASE ?? 'http://127.0.0.1:5982';
export const shotsDir = path.join(here, '..', 'shots');
export const outDir = path.join(here, 'baseline');
export const WIDTHS = [1440, 1024, 390] as const;

export interface SeedB {
  slug: string;
  project_id: string;
  envs: Record<string, string>;
  experiments: Record<string, string>;
}
export const seed = (): SeedB => JSON.parse(readFileSync(process.env.SEED_QAB ?? path.join(here, 'seed-qab.json'), 'utf8'));

export function save(name: string, data: unknown): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data, null, 2));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function open(browser: any, width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Screenshot of the page (or an element) to shots/<name>.png. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function shot(page: any, name: string, selector?: string, fullPage = false) {
  mkdirSync(shotsDir, { recursive: true });
  const file = path.join(shotsDir, `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  return file;
}

/** Box (x, y, w, h rounded) of the first element matching the selector, with font role of its text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function box(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      font: cs.fontSize + '/' + cs.fontWeight, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), color: cs.color,
    };
  }, selector);
}
