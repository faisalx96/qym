/**
 * Current state of the Runs page (project home), the Dashboard run lists and the Experiments list at 1440, 1024 and 390 px.
 * Output baseline/current-lists-<w>.json and shots/current-{runs,dashboard,experiments}-<w>.png.
 */
import { chromium, APP, WIDTHS, open, shot, save, seed } from './lib.mts';
const s = seed();
const browser = await chromium.launch();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boxes = (page: any, sel: string, max = 8) =>
  page.evaluate(([q, n]: [string, number]) => Array.from(document.querySelectorAll(q)).slice(0, n).map((e) => {
    const el = e as HTMLElement; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, sw: el.scrollWidth, cw: el.clientWidth, font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), text: (el.textContent ?? '').trim().slice(0, 60) };
  }), [sel, max]);
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width);
  const out: Record<string, unknown> = { width };
  await page.goto(`${APP}/projects/${s.slug}`);
  await page.waitForSelector('[data-testid="runs-table"] [data-run-id]');
  await page.waitForTimeout(1500);
  out.runsTable = await boxes(page, '[data-testid="runs-table"]');
  out.runsHeaders = await boxes(page, '[data-testid="runs-table"] [role="columnheader"]', 16);
  out.runsRows = await boxes(page, '[data-testid="runs-table"] [data-run-id]', 4);
  out.runCells = await boxes(page, '[data-testid="runs-table"] [data-run-id="' + s.runs[5] + '"] [role="gridcell"], [data-testid="runs-table"] [data-run-id="' + s.runs[5] + '"] [role="gridcell"] > span > *', 40);
  out.officialTags = await boxes(page, '[data-testid="runs-table"] [data-run-id] [class*="Tag"], [data-testid="runs-table"] [data-run-id] [data-tag]', 6);
  out.pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, `current-runs-${width}`, undefined, false);
  // dashboard (overview)
  await page.goto(`${APP}/projects/${s.slug}/overview`);
  await page.waitForTimeout(2500);
  out.overviewRunCells = await boxes(page, '[data-testid="run-tags"], [class*="runLine"], [class*="runCell"]', 8);
  await shot(page, `current-dashboard-${width}`, undefined, false);
  // experiments list
  await page.goto(`${APP}/projects/${s.slug}/experiments`);
  await page.waitForSelector('[data-experiments-list]');
  await page.waitForTimeout(1500);
  out.listRows = await boxes(page, '[data-experiments-list] [role="row"]', 6);
  out.listHeaders = await boxes(page, '[data-experiments-list] [role="columnheader"]', 12);
  out.listTags = await boxes(page, '[data-experiments-list] [data-testid="latency-tag"]', 4);
  out.listNameCells = await boxes(page, '[data-experiments-list] [role="gridcell"]:first-child', 5);
  out.listFilters = await boxes(page, '[data-experiments-list] [role="group"] label, [data-testid="filter-latency"]', 6);
  await shot(page, `current-experiments-${width}`, undefined, false);
  save(`current-lists-${width}`, out);
  await ctx.close();
}
await browser.close();
console.log('ok');
