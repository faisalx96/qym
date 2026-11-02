/** Shared helpers of the WP-C design measurements. Node 24, Playwright from frontend/node_modules.
 *  PERF_BASE=http://127.0.0.1:8994 VITE_BASE=http://127.0.0.1:5994 node <script>.mts */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
export const { chromium } = req('playwright-core') as any;
export const VITE = process.env.VITE_BASE ?? 'http://127.0.0.1:5994';
export const shotsDir = path.join(here, '..', 'shots');
export const outDir = path.join(here, 'out');
export const seed = (): { slug: string; runs: Record<string, string> } => JSON.parse(readFileSync(path.join(here, 'seed-c.json'), 'utf8'));
export function save(name: string, data: unknown): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data, null, 2));
}
export async function launch() { return chromium.launch(); }
export async function newPage(b: any, width: number, height = 900) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: 1 });
  return { ctx, page: await ctx.newPage() };
}
/** x,y,w,h and font of the first element matching the selector. */
export async function box(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: cs.fontSize + '/' + cs.fontWeight, family: cs.fontFamily.split(',')[0].replace(/"/g, '') };
  }, selector);
}
