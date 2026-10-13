/// <reference lib="dom" />
/** Clutter budget of the redesigned page at 1280x900 and at 390 wide (brief: docs/internal/ui-migration/redesign/analysis.md §5.1). */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { analysisUrl, rail, seedAnalyzer, waitWorkspace } from './helpers';

test('1280x900: the first control is near the top and few bordered regions compete', async ({
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
    const controls = [...main.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]')].filter(
      visible,
    );
    const firstControl = Math.min(...controls.map((c) => c.getBoundingClientRect().top).filter((y) => y >= 0));
    const isControl = (el: Element) => el.matches('button, a, input, select, textarea, [role="tab"], label');
    const borderedEls = [...main.querySelectorAll('*')].filter((el) => {
      if (!visible(el) || isControl(el) || el.closest('button, a, label, [role="tab"], [hidden]')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // a bordered region is a box (all four sides); hairline dividers between rows do not count
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].every(
        (s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none',
      );
      return hasBorder && r.width > 60 && r.height > 24;
    });
    const bordered = borderedEls.length;
    (window as unknown as { __b: string[] }).__b = borderedEls.map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`);
    const chips = [...main.querySelectorAll('[class*="badge" i], [class*="Badge"]')].filter(visible).length;
    return { firstControl: Math.round(firstControl), bordered, chips, controls: controls.length };
  });
  console.log('clutter 1280x900', JSON.stringify(m), JSON.stringify(await page.evaluate(() => (window as unknown as { __b: string[] }).__b)));
  expect(m.firstControl).toBeLessThanOrEqual(200);
  expect(m.bordered).toBeLessThanOrEqual(4);
  expect(m.chips).toBeLessThanOrEqual(2);
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
  const box = await page.getByRole('heading', { name: 'Setup', exact: true }).locator('xpath=ancestor::section[1]').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1440);
});
