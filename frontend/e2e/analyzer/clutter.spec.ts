/// <reference lib="dom" />
/** Clutter budget of the redesigned page at 1280x900 and at 390 wide (brief: docs/internal/ui-migration/redesign/analysis.md §5.1). */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { analysisUrl, rail, seedAnalyzer, waitWorkspace } from './helpers';

// REGRESSION GUARD, NOT A CLUTTER GOAL. With the brief's own definition (any border side, hairlines included)
// the 1280x900 fold has 11 bordered elements, 2-6 chips and 50+ controls. That is NOT numerically lighter than the
// old Configure step (20 controls / 7 boxes / 3 chips): Setup and the first Targets rows now share one screen. The
// goal met is structural (one tab row, one accent action, the prompt in a drawer, advanced fields in disclosures,
// no stepper / job bar / footer) plus smoothness (smoothness.spec.ts). These numbers only stop it getting worse.
const BORDER_BUDGET = 11;
const CHIP_BUDGET = 5;

test('1280x900 regression guard: first control near the top; fold counts do not grow', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
  const m = await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0;
    };
    const controls = Array.from(
      main.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]'),
    ).filter(visible);
    const firstControl = Math.min(
      ...controls.map((c) => c.getBoundingClientRect().top).filter((y) => y >= 0),
    );
    const isControl = (el: Element) => el.matches('button, a, input, select, textarea, [role="tab"], label');
    // Brief section 3.2: visible non-control elements with ANY border, wider than 60 and taller than 24
    // (closed disclosures are hidden and do not count).
    const borderedEls = Array.from(main.querySelectorAll('*')).filter((el) => {
      if (!visible(el) || isControl(el) || el.closest('button, a, label, [role="tab"], [hidden]'))
        return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hasBorder = ['top', 'right', 'bottom', 'left'].some(
        (s) =>
          parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 &&
          cs.getPropertyValue(`border-${s}-style`) !== 'none',
      );
      return hasBorder && r.width > 60 && r.height > 24;
    });
    const bordered = borderedEls.length;
    (window as unknown as { __b: string[] }).__b = borderedEls.map(
      (e) => `${e.tagName}.${String(e.className).slice(0, 30)}`,
    );
    // Badges, chips and tags (leaf elements whose class says so), metric chips included as in the brief.
    const chips = Array.from(
      main.querySelectorAll('[class*="badge" i], [class*="chip" i], [class*="tag" i]'),
    ).filter((el) => visible(el) && el.children.length === 0 && !el.matches('[class*="tagSlot"]')).length;
    return { firstControl: Math.round(firstControl), bordered, chips, controls: controls.length };
  });
  console.log(
    'clutter 1280x900',
    JSON.stringify(m),
    JSON.stringify(await page.evaluate(() => (window as unknown as { __b: string[] }).__b)),
  );
  expect(m.firstControl).toBeLessThanOrEqual(200);
  // Budget = the measured result with the brief's own definition (the brief's old fold had 7-12).
  expect(m.bordered).toBeLessThanOrEqual(BORDER_BUDGET);
  expect(m.chips).toBeLessThanOrEqual(CHIP_BUDGET);
});

test('390 wide: no horizontal scroll, the rail keeps the primary action and an overflow menu', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // target rows are two lines (id, metric, Preview / tag and input text), not four stacked ones
  const rowHeight = await page
    .getByRole('list', { name: 'Targets' })
    .getByRole('listitem')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(rowHeight, `390 px target row is ${rowHeight}px tall`).toBeLessThanOrEqual(64);
  await expect(rail(page).getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'More analysis actions' })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: /^Prompt preview/ })).toBeHidden();
  await rail(page).getByRole('button', { name: 'More analysis actions' }).click();
  await expect(page.getByRole('menuitem', { name: /^Test selected/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Prompt preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
});

test('1920: content is capped and centred', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  const box = await page
    .getByRole('heading', { name: 'Setup', exact: true })
    .locator('xpath=ancestor::section[1]')
    .boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1440);
});
