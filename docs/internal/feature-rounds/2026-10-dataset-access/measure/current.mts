/**
 * Current state of every WP-B surface at 1440, 1024 and 390 px: boxes, row heights, font roles, plus the
 * screenshots shots/current-<surface>-<width>.png. Output: baseline/current-<width>.json.
 *   PERF_BASE=http://127.0.0.1:8982 VITE_BASE=http://127.0.0.1:5982 node current.mts
 */
import { chromium, APP, WIDTHS, open, shot, save, seed } from './lib-b.mts';

const s = seed();
const browser = await chromium.launch();
/** Boxes of every element matching `sel` (up to `max`), with computed font size/weight/family. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boxes = (page: any, sel: string, max = 8) =>
  page.evaluate(([q, n]: [string, number]) => {
    return Array.from(document.querySelectorAll(q)).slice(0, n).map((e) => {
      const el = e as HTMLElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), text: (el.textContent ?? '').trim().slice(0, 40) };
    });
  }, [sel, max]);

for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width);
  const out: Record<string, unknown> = { width };

  // 1. Launch step 1 "Where it runs": Run settings card, review pane
  await page.goto(`${APP}/projects/${s.slug}/experiments/new?step=where`);
  await page.waitForSelector('[data-testid="launch-entry"]');
  await page.getByText('staging', { exact: true }).first().click();
  await page.getByRole('button', { name: /Dataset/ }).first().click().catch(() => {});
  await page.getByRole('option', { name: 'golden' }).click().catch(() => {});
  await page.waitForTimeout(1500);
  out.launchCard = await boxes(page, '[data-testid="launch-entry"] section[aria-label="Name and priority"]');
  out.launchFields = await boxes(page, '[data-testid="launch-entry"] section[aria-label="Name and priority"] input, [data-testid="launch-entry"] section[aria-label="Name and priority"] button, [data-testid="launch-entry"] section[aria-label="Name and priority"] textarea, [data-testid="launch-entry"] section[aria-label="Name and priority"] label');
  out.reviewPane = await boxes(page, 'aside[aria-label="Review"]');
  out.reviewSummaryRows = await boxes(page, 'dl[aria-label="Summary"] > div', 10);
  await shot(page, `current-launch-run-settings-${width}`, '[data-testid="launch-entry"] section[aria-label="Name and priority"]');
  await shot(page, `current-launch-step1-${width}`, undefined, true);

  // 2. Experiment detail: header, job history
  await page.goto(`${APP}/projects/${s.slug}/experiments/${s.experiments.sweep}`);
  await page.waitForSelector('[data-exp-detail]');
  await page.waitForTimeout(1500);
  out.detailHeader = await boxes(page, '[data-page-header], [data-page-header] h1, [data-page-header] [class*="meta"]');
  out.detailActions = await boxes(page, '[data-exp-detail] > div[class*="headerActions"] button');
  out.detailJobsCard = await boxes(page, '[data-exp-jobs]');
  out.detailJobsHeaders = await boxes(page, '[data-exp-jobs] [role="columnheader"]', 10);
  out.detailJobsRows = await boxes(page, '[data-exp-jobs] [role="row"]', 6);
  out.detailJobsStatusCells = await boxes(page, '[data-exp-jobs] [role="gridcell"]:nth-child(4)', 4);
  await shot(page, `current-detail-header-${width}`, '[data-page-header]');
  await shot(page, `current-detail-jobs-${width}`, '[data-exp-jobs]');

  // 3. Experiments list
  await page.goto(`${APP}/projects/${s.slug}/experiments`);
  await page.waitForSelector('[data-experiments-list]');
  await page.waitForTimeout(1500);
  out.listFilters = await boxes(page, '[data-experiments-list] [role="group"][aria-label="Filter experiments"], [data-experiments-list] [role="group"][aria-label="Filter experiments"] label');
  out.listRows = await boxes(page, '[data-experiments-list] [role="row"]', 6);
  out.listNameCells = await boxes(page, '[data-experiments-list] [role="gridcell"]:first-child', 4);
  await shot(page, `current-list-${width}`, '[data-experiments-list]');

  // 4. Queue
  await page.goto(`${APP}/projects/${s.slug}/experiments/queue`);
  await page.waitForSelector('[data-queue-page]');
  await page.waitForTimeout(1500);
  out.queueRows = await boxes(page, '[data-queue-page] [role="row"]', 6);
  out.queueEnvCards = await boxes(page, '[data-queue-page] ul[aria-label="Environments"] > li', 4);
  out.queueNameCells = await boxes(page, '[data-queue-page] [role="gridcell"]:nth-child(3)', 4);
  await shot(page, `current-queue-${width}`, '[data-queue-page]');

  // 5. Environment edit form: Policies
  await page.goto(`${APP}/projects/${s.slug}/environments/${s.envs.staging}`);
  await page.waitForSelector('[data-section="env-policies"]');
  await page.waitForTimeout(800);
  out.envPolicies = await boxes(page, '[data-section="env-policies"], [data-section="env-policies"] label, [data-section="env-policies"] button, [data-section="env-policies"] p');
  await page.locator('[data-section="env-policies"]').scrollIntoViewIfNeeded();
  await shot(page, `current-env-policies-${width}`, '[data-section="env-policies"]');

  // 6. Project settings: API keys, dataset read tokens
  await page.goto(`${APP}/projects/${s.slug}/settings?tab=apikeys`);
  await page.waitForSelector('[data-read-tokens]');
  await page.waitForTimeout(800);
  out.tokensCard = await boxes(page, '[data-read-tokens], [data-read-tokens] [role="columnheader"]', 8);
  await shot(page, `current-settings-tokens-${width}`, '[data-read-tokens]');

  save(`current-${width}`, out);
  await ctx.close();
}
await browser.close();
console.log('ok');
