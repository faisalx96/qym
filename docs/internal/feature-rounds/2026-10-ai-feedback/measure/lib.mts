/**
 * Shared helpers of the AI-feedback (WP-E) design measurements. Node 24, Playwright from frontend/node_modules.
 *   PERF_BASE=http://127.0.0.1:9006 VITE_BASE=http://127.0.0.1:6012 node <script>.mts
 * The platform serves the API on PERF_BASE; pages and the gallery come from Vite (VITE_BASE).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { chromium } = req('playwright-core') as any;

export const API = process.env.PERF_BASE ?? 'http://127.0.0.1:9006';
export const APP = process.env.VITE_BASE ?? 'http://127.0.0.1:6012';
export const shotsDir = path.join(here, '..', 'shots');
export const WIDTHS = [1440, 1024, 390] as const;

export function save(dir: 'baseline-e' | 'mock-e', name: string, data: unknown): void {
  const out = path.join(here, dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data, null, 2));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function open(browser: any, width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  return { ctx, page };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function shot(page: any, name: string, selector?: string, fullPage = true) {
  mkdirSync(shotsDir, { recursive: true });
  const file = path.join(shotsDir, `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  return file;
}

/** Boxes (x, y, w, h) and the type of the text of every selector in the map (first match, or all with `[]` suffix). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function boxes(page: any, map: Record<string, string>) {
  return page.evaluate((m: Record<string, string>) => {
    const out: Record<string, unknown> = {};
    const one = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0]!.replace(/"/g, ''), color: cs.color, bg: cs.backgroundColor,
        gap: cs.gap, pad: cs.padding, scrollW: (el as HTMLElement).scrollWidth, clientW: (el as HTMLElement).clientWidth,
      };
    };
    for (const [k, sel] of Object.entries(m)) {
      if (sel.endsWith('[]')) out[k] = Array.from(document.querySelectorAll(sel.slice(0, -2))).map(one);
      else {
        const el = document.querySelector(sel);
        out[k] = el ? one(el) : null;
      }
    }
    return out;
  }, map);
}
