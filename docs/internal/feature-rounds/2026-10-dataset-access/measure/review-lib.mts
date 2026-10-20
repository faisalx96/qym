/** Shared helpers of the WP-B review measurements (Playwright from frontend/node_modules, platform on :8986 with proxy_headers). */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../..');
const req = createRequire(path.join(repo, 'frontend', 'package.json'));
export const { chromium } = req('playwright-core') as any;
export const APP = process.env.APP ?? 'http://127.0.0.1:8986';
export const shotsDir = path.join(here, '..', 'shots');
export const WIDTHS = [1440, 1024, 390] as const;
export const SEED = JSON.parse(readFileSync(process.env.SEED_B!, 'utf8'));
export const SEED2 = JSON.parse(readFileSync(process.env.SEED_B2!, 'utf8'));
export const out: Record<string, any> = {};
export function save(name: string): void {
  mkdirSync(path.join(here, 'review-out'), { recursive: true });
  writeFileSync(path.join(here, 'review-out', `${name}.json`), JSON.stringify(out, null, 2));
}
export async function open(browser: any, width: number, who = 'dev@local', height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: 1, extraHTTPHeaders: { 'X-User-Email': who } });
  const page = await ctx.newPage();
  return { ctx, page };
}
export async function shot(page: any, name: string, selector?: string) {
  mkdirSync(shotsDir, { recursive: true });
  const file = path.join(shotsDir, `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
}
/** Box + font of the first element matching a CSS selector. */
export async function box(page: any, selector: string) {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: cs.fontSize + '/' + cs.fontWeight, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), color: cs.color, pl: cs.paddingInlineStart };
  }, selector);
}
export async function boxL(loc: any) {
  return loc.first().evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: cs.fontSize + '/' + cs.fontWeight, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), color: cs.color, pl: cs.paddingInlineStart, text: (el.textContent ?? '').trim().slice(0, 160) };
  });
}
export const overflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
export const exp = (slug: string, tail = '') => `${APP}/projects/${slug}/experiments${tail}`;
