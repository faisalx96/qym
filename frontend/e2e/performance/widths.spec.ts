/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { seedPerformance, startRun, type PerformanceSeed } from './support';

let seed: PerformanceSeed;
let runId: string;
test.beforeAll(async ({ request }) => {
  seed = await seedPerformance(request, uniqueSlug('perf-widths'));
  const run = await startRun(request, seed.projectSlug, {
    target_id: seed.preprod.id,
    dataset_version_id: seed.dataset.versionId,
  });
  runId = run.id;
  await seed.runner.runToLevel20(run.id);
});

async function noPageOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)))
    .toBe(0);
}

test.describe('at 390 wide', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Home has no sideways scroll', async ({ page }) => {
    await gotoApp(page, `/projects/${seed.projectSlug}/performance`);
    await expect(page.getByRole('region', { name: 'Run in progress' })).toBeVisible();
    await noPageOverflow(page);
  });

  test('New run has no sideways scroll on any step', async ({ page }) => {
    await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
    await page
      .getByRole('radiogroup', { name: 'Target' })
      .getByRole('radio', { name: /QA - Preprod/ })
      .click({ force: true });
    await noPageOverflow(page);
    for (const step of ['Test', 'Load', 'Questions', 'Review and start']) {
      await page
        .locator('[data-performance-block="step-bar"]')
        .getByRole('button', { name: `Continue to ${step}` })
        .click();
      await expect(page.getByRole('region', { name: step })).toBeVisible();
      await noPageOverflow(page);
    }
  });

  test('a run page has no sideways scroll on any tab', async ({ page }) => {
    await gotoApp(page, `/projects/${seed.projectSlug}/performance/runs/${runId}`);
    await expect(page.locator('[data-performance-block="content"]')).toHaveAttribute(
      'data-performance-state',
      'running',
    );
    await noPageOverflow(page);
    for (const tab of ['Questions', 'Log', 'Charts', 'Setup']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await noPageOverflow(page);
    }
  });
});

for (const width of [390, 1440]) {
  test(`the target dialog fits at ${width} wide with Advanced open`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
    await page.getByRole('button', { name: 'Add a target' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a target' });
    const advanced = dialog.getByRole('button', { name: 'Advanced' });
    await expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await advanced.click();
    await expect(dialog.getByRole('textbox', { name: 'Sign-in server' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Sign-in server' }).fill('https://sign-in.production.internal');
    await dialog.getByRole('textbox', { name: 'Sign-in cookie name' }).fill('production_refresh_token');
    await dialog.getByRole('textbox', { name: 'Longest run, minutes' }).fill('60');
    // Wait for the disclosure's height transition, and catch clipped fields or help text.
    const content = dialog.locator('[data-part="disclosure-content"]');
    await expect
      .poll(() =>
        content.evaluate((element) =>
          Math.max(0, element.scrollHeight - element.parentElement!.clientHeight),
        ),
      )
      .toBeLessThanOrEqual(1);
    await noPageOverflow(page);
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    expect(await advanced.evaluate((element) => getComputedStyle(element).alignItems)).toBe('center');
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`target-advanced-${width}.png`) });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });
}
