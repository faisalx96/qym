/**
 * Shared helpers of the round-8 measurement scripts (compare page, legacy vs React).
 * Run from frontend/ with Node 24:  npx tsx ../docs/internal/ui-migration/redesign8/measure/<script>.mts
 * Env: LEG_BASE (default http://127.0.0.1:8980), REACT_BASE (default http://127.0.0.1:5981), R8_OUT (shots dir).
 * seed-ids.json holds the run ids that `frontend/scripts/seed-compare.ts <url> cmp-r8` printed for each platform.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any; type Browser = any;

const here = path.dirname(fileURLToPath(import.meta.url));
export const LEG = process.env.LEG_BASE ?? 'http://127.0.0.1:8980';
export const REACT = process.env.REACT_BASE ?? 'http://127.0.0.1:5981';
const req = createRequire(path.join(here, '../../../../../frontend/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { chromium } = req('playwright-core') as any;
export const ids = JSON.parse(readFileSync(path.join(here, 'seed-ids.json'), 'utf8')) as Record<'react' | 'legacy', Record<string, string>>;
export const shots = process.env.R8_OUT ?? path.join(here, '..', 'shots');

export const legacyUrl = (names: string[]) => `${LEG}/compare?${names.map((n) => `runs=${ids.legacy[n]}`).join('&')}`;
export const reactUrl = (names: string[], extra = '') => `${REACT}/compare?${names.map((n) => `runs=${ids.react[n]}`).join('&')}${extra}`;

export async function launch(): Promise<Browser> {
  return chromium.launch({ args: ['--disable-dev-shm-usage'] });
}
export async function newPage(browser: Browser, width: number, height = 900, scheme: 'dark' | 'light' = 'dark'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
  return ctx.newPage();
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Crop screenshot of the first element matching `sel` (full element box). */
export async function shotEl(page: Page, sel: string, name: string): Promise<void> {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: path.join(shots, name) });
}

/** Full-page shot of the legacy page: its scroller is `main.compare-container`, so the viewport is grown to the content height. */
export async function legacyFull(page: Page, file: string): Promise<number> {
  const h: number = await page.evaluate(() => (document.querySelector('main.compare-container') as HTMLElement).scrollHeight + 60);
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(h, 16000) });
  await sleep(500);
  await page.screenshot({ path: path.join(shots, file) });
  return h;
}

/** Full-page shot of the React page: the shell scroller is `#shell-content`; it is scrolled once (lazy sections) and the viewport grown to its content height. */
export async function reactFull(page: Page, file: string): Promise<number> {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { const m = document.getElementById('shell-content')!; m.scrollTop = m.scrollHeight; });
    await sleep(900);
  }
  await page.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; });
  const h: number = await page.evaluate(() => document.getElementById('shell-content')!.scrollHeight + 60);
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(h, 16000) });
  await sleep(1500);
  await page.screenshot({ path: path.join(shots, file) });
  return h;
}
