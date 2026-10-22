/**
 * WP-D: the Datasets card of the launch home view and Customize step 1 (spec-d QD-1 to QD-29): the single Select
 * while nothing is chosen, the dataset boxes with their versions, the run shape, the environment shape tags and the
 * numbers of the composed pages at 1440 / 1024 / 390. With QYM_SHOTS_DIR the after-screenshots and the measured
 * numbers are written there (after-d-*.png, measure-d-*.json).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { axeSeriousViolations, describeViolations, expectNoPageOverflow, resetFakes, test } from '../support';
import { openHome, openLaunch, captureExperimentPosts } from './launchSupport';
import {
  addDataset,
  chooseDataset,
  composeFour,
  datasetSelect,
  datasetsCard,
  dsBox,
  overflowing,
  seedMulti,
  setVersions,
  sized,
  WIDTHS,
  type MultiFixture,
} from './multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

const SHOTS = process.env.QYM_SHOTS_DIR;
let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
function save(name: string, data: unknown): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(data, null, 2));
}
/** Expected number with a tolerance (sub-pixel layout and the web font differ by a fraction). */
function near(actual: number, expected: number, tolerance = 1.6, what = ''): void {
  expect(Math.abs(actual - expected), `${what} ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

const tick = (page: Page, name: string) => page.getByRole('checkbox', { name }).click({ force: true });
const tickBoth = async (page: Page) => {
  await tick(page, 'production');
  await tick(page, 'staging');
};

test.describe('the Datasets card', () => {
  test('QD-1, QD-9: nothing chosen is today single Select; one dataset costs two clicks', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug);
    await expect(page.getByTestId('datasets-fieldset')).toHaveCount(0);
    await expect(page.getByTestId('run-shape')).toHaveCount(0);
    const select = datasetSelect(page);
    near((await sized(select)).height, 24, 0.6, 'select height');
    // Tick (1), open (2), choose (3): the ready home bar.
    let clicks = 0;
    await tick(page, 'production');
    clicks += 1;
    await select.click();
    clicks += 1;
    await page.getByRole('option', { name: /support-tickets/ }).click();
    clicks += 1;
    expect(clicks).toBe(3);
    await expect(datasetsCard(page)).toBeVisible();
    await expect(page.getByTestId('pair-count')).toHaveText('1 dataset version');
    await expect(page.getByTestId('run-shape')).toHaveCount(0);
    await expect(page.getByTestId('env-shape-tag')).toHaveCount(0);
    // The dataset is on Latest: the request carries no version (as today).
    const posts = captureExperimentPosts(page);
    await page.getByRole('textbox', { name: 'Experiment name' }).fill('one dataset');
    await expect.poll(() => posts.dryRuns.length).toBeGreaterThan(0);
    const spec = posts.dryRuns.at(-1)!.body.spec.evaluator;
    expect(spec.dataset).toBe('support-tickets');
    expect(spec.dataset_version).toBeUndefined();
    expect(spec.datasets).toBeUndefined();
    expect(spec.run_shape).toBeUndefined();
  });

  for (const width of WIDTHS) {
    test(`single dataset box and the composed card at ${width}px (QD-3 to QD-14, QD-18, QD-20 to QD-23)`, async ({ page }) => {
      const height = width === 1440 ? 900 : 1000;
      await page.setViewportSize({ width, height });
      await openHome(page, f.project.slug);
      const m: Record<string, unknown> = { width };
      await shot(page, `after-d-home-empty-${width}`);
      await tickBoth(page);
      // The empty card: the select and the card.
      const selectBox = datasetSelect(page);
      m['selectWidth'] = (await sized(selectBox)).width;
      await chooseDataset(page, 'support-tickets');
      const fieldset = datasetsCard(page);
      m['singleFieldset'] = await sized(fieldset);
      m['singleBox'] = await sized(dsBox(page, 'support-tickets'));
      near((await sized(dsBox(page, 'support-tickets'))).height, 67, 1.6, 'QD-3 box height');
      const trigger = dsBox(page, 'support-tickets').getByRole('button', { name: /^Versions.* of support-tickets$/ });
      const tsize = await sized(trigger);
      m['trigger'] = tsize;
      expect(tsize.height).toBeLessThanOrEqual(24.5);
      expect(tsize.width).toBeLessThanOrEqual(139.5);
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      const tag = dsBox(page, 'support-tickets').locator('[data-kind="version"], span').filter({ hasText: /^Latest version$/ }).first();
      await expect(tag).toBeVisible();
      await shot(page, `after-d-home-single-${width}`);

      // Four dataset versions: the composed state.
      await setVersions(page, 'support-tickets', ['v2', 'v3']);
      await addDataset(page, 'billing-faq');
      await setVersions(page, 'billing-faq', ['v1', 'v2']);
      await expect(page.getByTestId('pair-count')).toHaveText('4 dataset versions from 2 datasets');
      m['composedFieldset'] = await sized(fieldset);
      m['shape'] = await sized(page.getByTestId('run-shape'));
      const radios = page.getByTestId('run-shape').getByRole('radiogroup', { name: 'Run shape' });
      m['shapeControl'] = await sized(radios);
      near((await sized(radios)).height, 24, 0.8, 'QD-12 control');
      await expect(radios.getByRole('radio', { name: 'Combine into one run' })).toBeChecked();
      // Environment tags (QD-20/21): production takes a list, staging does not.
      const prodTag = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'production' }) }).getByTestId('env-shape-tag');
      const stagTag = page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'staging' }) }).getByTestId('env-shape-tag');
      await expect(prodTag).toHaveText('1 combined run');
      await expect(stagTag).toHaveText('4 runs, one per dataset version (older service)');
      m['prodTag'] = await sized(prodTag);
      m['stagTag'] = await sized(stagTag);
      expect((await sized(prodTag)).height).toBeLessThanOrEqual(20.5);
      // The home bar hides the count below 961 px (as before this round); the review pane says it.
      await expect(page.getByText(/^5 runs to launch$/)).toBeAttached();
      m['envBoxes'] = {
        production: await sized(page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'production' }) })),
        staging: await sized(page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'staging' }) })),
      };
      m['homeBar'] = await sized(page.getByRole('region', { name: 'Launch' }));
      // The app scrolls inside its shell: the page is the scroll height of the tallest scrolling element.
      m['pageHeight'] = await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollHeight,
          ...Array.from(document.querySelectorAll<HTMLElement>('*'))
            .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY))
            .map((e) => e.scrollHeight),
        ),
      );
      expect(await overflowing(fieldset)).toEqual([]);
      await expectNoPageOverflow(page);
      await shot(page, `after-d-home-composed-${width}`);
      // One run each: both environments fan out (QD-21), the count is 8.
      await radios.getByRole('radio', { name: 'One run each' }).click({ force: true });
      await expect(prodTag).toHaveText('4 runs, one per dataset version');
      await expect(stagTag).toHaveText('4 runs, one per dataset version');
      await expect(page.getByText(/^8 runs to launch$/)).toBeAttached();
      await radios.getByRole('radio', { name: 'Combine into one run' }).click({ force: true });
      await expect(page.getByText(/^5 runs to launch$/)).toBeAttached();
      if (width !== 1024) {
        const violations = await axeSeriousViolations(page);
        expect(violations, describeViolations(violations)).toEqual([]);
      }
      save(`measure-d-home-${width}`, m);
    });
  }

  test('QD-5 to QD-8, QD-11, QD-17, QD-19: references, snap back, add, remove and focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug);
    await tickBoth(page);
    await chooseDataset(page, 'support-tickets');
    const trigger = dsBox(page, 'support-tickets').getByRole('button', { name: /^Versions.* of support-tickets$/ });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: /Versions options/ });
    await expect(panel.getByRole('checkbox')).toHaveCount(5);
    const labels = await panel.getByRole('checkbox').evaluateAll((els) => els.map((e) => e.closest('label')?.textContent?.trim()));
    expect(labels[0]).toBe('Latest version');
    expect(labels.slice(1, 4)).toEqual(['Version v3', 'Version v2', 'Version v1']);
    expect(labels.at(-1)).toBe('Alias production');
    await expect(panel.getByRole('button', { name: /Select all|Only/ })).toHaveCount(0);
    // Space toggles, the tags and the count follow at once.
    await panel.getByRole('checkbox', { name: /Version v3/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('pair-count')).toHaveText('2 dataset versions from 1 dataset');
    await expect(dsBox(page, 'support-tickets').getByText('v3', { exact: true })).toBeVisible();
    // Unticking the last reference snaps back to Latest.
    await panel.getByRole('checkbox', { name: /Version v3/ }).click({ force: true });
    await panel.getByRole('checkbox', { name: /Latest version/ }).click({ force: true });
    await expect(page.getByTestId('pair-count')).toHaveText(/1 dataset version/);
    await expect(panel.getByRole('checkbox', { name: /Latest version/ })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    // Add another dataset: the chosen one is not offered again (QD-11).
    await page.getByRole('button', { name: 'Add another dataset' }).click();
    await expect(page.getByRole('menuitem', { name: /support-tickets/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(2);
    await page.getByRole('menuitem', { name: /refund-cases/ }).click();
    await expect(page.getByTestId('run-shape')).toBeVisible();
    // The shape survives going back to one version (QD-19) but is hidden.
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    await dsBox(page, 'refund-cases').getByRole('button', { name: 'Remove refund-cases' }).click();
    await expect(page.getByTestId('run-shape')).toHaveCount(0);
    await addDataset(page, 'billing-faq');
    await expect(page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' })).toBeChecked();
    // Remove the first dataset: focus moves to the next box's trigger (QD-8).
    await dsBox(page, 'support-tickets').getByRole('button', { name: 'Remove support-tickets' }).click();
    await expect(dsBox(page, 'support-tickets')).toHaveCount(0);
    // Removing the last one returns to the single Select.
    await dsBox(page, 'billing-faq').getByRole('button', { name: 'Remove billing-faq' }).click();
    await expect(datasetsCard(page)).toHaveCount(0);
    await expect(datasetSelect(page)).toBeVisible();
  });

  test('QD-25 to QD-28: Customize step 1 shows the same card and issues no extra requests', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const hits: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'GET' && /versioning-details|\/tasks$|\/versions\?/.test(r.url())) hits.push(r.url().replace(/^.*\/v1\//, '/v1/'));
    });
    await openHome(page, f.project.slug);
    await tickBoth(page);
    await composeFour(page);
    await expect(page.getByTestId('pair-count')).toHaveText('4 dataset versions from 2 datasets');
    const before = hits.length;
    const homeText = await datasetsCard(page).innerText();
    await page.getByRole('button', { name: /Customize/ }).click();
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
    await expect(datasetsCard(page)).toBeVisible();
    expect(await datasetsCard(page).innerText()).toBe(homeText);
    expect(hits.length).toBe(before);
    save('measure-d-step1-1440', {
      fieldset: await sized(datasetsCard(page)),
      review: await sized(page.getByRole('complementary', { name: 'Review' })),
    });
    await shot(page, 'after-d-step1-composed-1440');
    // Review rail below the step at 1024 and 390.
    for (const width of [1024, 390] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(datasetsCard(page)).toBeVisible();
      await shot(page, `after-d-step1-composed-${width}`);
    }
  });

  test('QD-29: the stepper counts a changed list, shape and task once each', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`);
    await chooseDataset(page, 'support-tickets');
    await setVersions(page, 'support-tickets', ['v2', 'v3']);
    const step = page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: /Where it runs/ });
    const tag = step.locator('[title$="changed from the starting point"]');
    const count = async () => ((await tag.count()) ? Number((await tag.first().getAttribute('title'))?.match(/^\d+/)?.[0]) : 0);
    const base = await count();
    expect(base).toBeGreaterThan(0);
    await addDataset(page, 'billing-faq');
    await expect.poll(count).toBe(base); // the list is "Datasets changed" once
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    await expect.poll(count).toBe(base + 1);
  });
});
