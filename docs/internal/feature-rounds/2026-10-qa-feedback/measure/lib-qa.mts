/** Shared helpers of the QA-A design measure scripts. Run from the repo root with Node 24:
 *  QYM_A_VITE=http://127.0.0.1:5981 node <script>.mts   (platform on 8981, gallery on Vite 5981) */
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
export const SLUG = 'access-demo';
export const shotsDir = path.join(here, '..', 'shots');
export const outDir = path.join(here, 'out');
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
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(data, null, 2));
}
export function datasetUrl(ds: string, tab: string, extra = ''): string {
  return `${VITE}/projects/${SLUG}/datasets/${ds}?tab=${tab}&v=v1${extra}`;
}
/** Box + type of the first element matching each selector, rounded to 0.1 px (null when absent). Runs in the page. */
export const BOXES = `(sels) => Object.fromEntries(sels.map((s) => { const e = document.querySelector(s); if (!e) return [s, null]; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [s, { x: +r.x.toFixed(1), y: +(r.y + scrollY).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), font: cs.fontSize + '/' + cs.fontWeight }]; }))`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const boxes = (page: any, sels: string[]) => page.evaluate(`(${BOXES})(${JSON.stringify(sels)})`);
