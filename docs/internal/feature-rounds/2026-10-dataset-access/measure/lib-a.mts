/** Shared helpers of the WP-A design measure scripts. Run from the repo root with Node 24:
 *  QYM_A_BASE=http://127.0.0.1:8981 (platform) QYM_A_VITE=http://127.0.0.1:5981 (Vite, gallery) node <script>.mts */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { chromium } = req('playwright-core') as any;
export const VITE = process.env.QYM_A_VITE ?? 'http://127.0.0.1:5981';
export const SLUG = process.env.QYM_A_SLUG ?? 'access-demo';
export const shotsDir = path.join(here, '..', 'shots');
export const outDir = path.join(here, 'baseline');
export const WIDTHS = [1440, 1024, 390] as const;

export async function launch() {
  return chromium.launch({ args: ['--disable-dev-shm-usage'] });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function newPage(browser: any, width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  return { ctx, page };
}
export function save(name: string, data: unknown): void {
  mkdirSync(outDir, { recursive: true });
  const text = JSON.stringify(data, null, 2);
  writeFileSync(path.join(outDir, `${name}.json`), text);
  console.log(name, text.length > 3000 ? text.slice(0, 3000) + '…' : text);
}
/** Box of the first element matching the selector, rounded to 0.1 px (null when absent). */
export const BOX = `(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), font: cs.fontSize + '/' + cs.fontWeight + ' ' + cs.fontFamily.split(',')[0] }; }`;
