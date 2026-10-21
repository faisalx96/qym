/**
 * Current state of the experiment launch surfaces (home view, Customize step 1 "Where it runs", Models step, review pane)
 * at 1440, 1024 and 390 px, with both environments ticked. Output baseline/current-launch-<w>.json and shots/current-*.
 *   PERF_BASE=http://127.0.0.1:8982 VITE_BASE=http://127.0.0.1:5982 node current-launch.mts
 */
import { chromium, APP, WIDTHS, open, shot, save, seed } from './lib.mts';
const s = seed();
const browser = await chromium.launch();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boxes = (page: any, sel: string, max = 8) =>
  page.evaluate(([q, n]: [string, number]) => Array.from(document.querySelectorAll(q)).slice(0, n).map((e) => {
    const el = e as HTMLElement; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), text: (el.textContent ?? '').trim().slice(0, 50) };
  }), [sel, max]);
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width);
  const out: Record<string, unknown> = { width };
  // home view
  await page.goto(`${APP}/projects/${s.slug}/experiments/new`);
  await page.waitForSelector('[data-testid="launch-home"]');
  for (const n of ['staging', 'production']) await page.locator('fieldset label', { hasText: new RegExp('^' + n + '$') }).click();
  await page.waitForTimeout(2500);
  out.homeCards = await boxes(page, '[data-testid="launch-home"] > div > section, [data-testid="launch-home"] > section, [data-testid="launch-home"] > div');
  out.homeEnvCard = await boxes(page, '[data-testid="launch-home"] fieldset');
  out.homeVersions = await boxes(page, 'section[aria-label="Current versions"], [data-env-version], [data-env-version] dl, [data-env-version] dl > div, [data-env-version] dl dd span');
  out.homeVersionsHead = await boxes(page, 'section[aria-label="Current versions"] button, section[aria-label="Current versions"] span');
  out.homeLatencyControl = await boxes(page, '[data-testid="launch-home"] [data-testid="launch-latency"]');
  out.homeBar = await boxes(page, '[data-testid="launch-home"] > div:last-child, [data-testid="launch-home"] > div:last-child *', 12);
  await shot(page, `current-launch-home-${width}`, undefined, true);
  // step 1
  await page.goto(`${APP}/projects/${s.slug}/experiments/new?step=where`);
  await page.waitForSelector('[data-testid="launch-entry"]');
  for (const n of ['staging', 'production']) await page.locator('fieldset label', { hasText: new RegExp('^' + n + '$') }).click();
  await page.waitForTimeout(2500);
  out.step1Cards = await boxes(page, '[data-testid="launch-entry"] > section, [data-testid="launch-entry"] > div, [data-testid="launch-entry"] > div > section');
  out.step1Env = await boxes(page, '[data-testid="launch-entry"] fieldset, [data-testid="launch-entry"] fieldset li', 6);
  out.step1Runs = await boxes(page, 'section[aria-label="Name and priority"], section[aria-label="Name and priority"] input, section[aria-label="Name and priority"] textarea, [data-testid="launch-latency"], [data-testid="launch-latency"] p');
  out.step1Versions = await boxes(page, 'section[aria-label="Current versions"]');
  out.review = await boxes(page, 'aside[aria-label="Review"], aside[aria-label="Review"] dl > div', 12);
  await shot(page, `current-launch-step1-${width}`, undefined, true);
  // models step
  await page.goto(`${APP}/projects/${s.slug}/experiments/new?step=models`);
  await page.waitForTimeout(2500);
  out.modelsHasVersions = await page.evaluate(() => document.querySelectorAll('section[aria-label="Current versions"], [data-env-version]').length);
  save(`current-launch-${width}`, out);
  await ctx.close();
}
await browser.close();
console.log('ok');
