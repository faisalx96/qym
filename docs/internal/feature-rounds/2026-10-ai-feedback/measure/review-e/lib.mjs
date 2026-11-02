import { createRequire } from 'node:module';
const require = createRequire('/home/meshari-aldossari/Documents/qym/qym-wt-ai-feedback/frontend/package.json');
export const { chromium } = require('playwright-core');
export const BASE = process.env.BASE ?? 'http://127.0.0.1:6016';
export async function open(width, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: opts.height ?? 900 }, colorScheme: 'dark', extraHTTPHeaders: opts.headers ?? {}, reducedMotion: opts.reducedMotion });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}
export async function ready(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250); }
export const rect = (page, sel, i = 0) => page.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1), sw: e.scrollWidth, cw: e.clientWidth }; }, [sel, i]);
export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
