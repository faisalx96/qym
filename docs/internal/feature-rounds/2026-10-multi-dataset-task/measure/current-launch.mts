/**
 * Baseline of today's launch surfaces (home view, Customize step 1) at 1440 / 1024 / 390 with both environments ticked and one
 * dataset chosen. Output baseline/current-launch-<w>.json and shots/current-*.png.
 *   PERF_BASE=http://127.0.0.1:8996 VITE_BASE=http://127.0.0.1:5996 node current-launch.mts
 */
import { chromium, APP, WIDTHS, open, shot, save, seed } from './lib.mts';
const s = seed();
const browser = await chromium.launch();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boxes = (page: any, sel: string, max = 10) =>
  page.evaluate(([q, n]: [string, number]) => Array.from(document.querySelectorAll(q)).slice(0, n).map((e) => {
    const el = e as HTMLElement; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: `${cs.fontSize}/${cs.fontWeight}`, text: (el.textContent ?? '').trim().slice(0, 40) };
  }), [sel, max]);
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width);
  const out: Record<string, unknown> = { width };
  const clicks: string[] = [];
  await page.goto(`${APP}/projects/${s.slug}/experiments/new`);
  await page.waitForSelector('[data-testid="launch-home"]');
  await page.waitForTimeout(800);
  out.homeEmpty = await boxes(page, '[data-testid="launch-home"] > div > div, [data-testid="launch-home"] fieldset');
  await shot(page, `current-launch-home-empty-${width}`, undefined, true);
  // the real click path: environment, dataset
  await page.locator('fieldset label', { hasText: /^staging$/ }).click(); clicks.push('tick staging');
  await page.getByRole('button', { name: /Dataset/ }).first().click(); clicks.push('open Dataset');
  await page.getByRole('option', { name: /support-tickets/ }).click(); clicks.push('choose support-tickets');
  await page.locator('fieldset label', { hasText: /^production$/ }).click();
  await page.waitForTimeout(2500);
  out.clicksToReady = clicks;
  out.homeCards = await boxes(page, '[data-testid="launch-home"] > div');
  out.homeEnvBoxes = await boxes(page, '[data-testid="launch-home"] fieldset li', 4);
  out.homeVersionLine = await boxes(page, '[data-testid="launch-home"] [data-env-version]', 4);
  out.homeDatasetCard = await boxes(page, '[data-testid="launch-home"] label, [data-testid="launch-home"] [role="group"] button, [data-testid="launch-home"] button[aria-haspopup]', 12);
  out.homeDatasetStack = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-testid="launch-home"] *')).filter((e) => e.children.length === 0 && /^Dataset version$/.test((e.textContent ?? '').trim()));
    let n: HTMLElement | null = (els[0] as HTMLElement) ?? null;
    while (n && !/cardStack/.test(n.className)) n = n.parentElement;
    const rr = (e: HTMLElement | null | undefined) => e ? { w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10 } : null;
    return { stack: rr(n), card: rr(n?.parentElement) };
  });
  out.homeBar = await boxes(page, '[role="region"][aria-label="Launch"], [role="region"][aria-label="Launch"] button', 6);
  out.homeStatus = await page.locator('[role="status"]').allTextContents();
  await shot(page, `current-launch-home-${width}`, undefined, true);
  await page.goto(`${APP}/projects/${s.slug}/experiments/new?step=where`);
  await page.waitForSelector('[data-testid="launch-entry"]');
  await page.locator('fieldset label', { hasText: /^staging$/ }).click();
  await page.locator('fieldset label', { hasText: /^production$/ }).click();
  await page.getByRole('button', { name: /Dataset/ }).first().click();
  await page.getByRole('option', { name: /support-tickets/ }).click();
  await page.waitForTimeout(2500);
  out.step1Cards = await boxes(page, '[data-testid="launch-entry"] > section, [data-testid="launch-entry"] > div');
  out.step1Env = await boxes(page, '[data-testid="launch-entry"] fieldset, [data-testid="launch-entry"] fieldset li', 4);
  out.step1Dataset = await boxes(page, '[data-testid="launch-entry"] [data-testid="launch-entry"] label', 6);
  out.review = await boxes(page, 'aside[aria-label="Review"], aside[aria-label="Review"] dl > div', 12);
  out.reviewText = await page.locator('aside[aria-label="Review"]').innerText().catch(() => '');
  await shot(page, `current-launch-step1-${width}`, undefined, true);
  save(`current-launch-${width}`, out);
  await ctx.close();
}
await browser.close();
console.log('ok');
