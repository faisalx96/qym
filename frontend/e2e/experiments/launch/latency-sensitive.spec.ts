/**
 * WP-B feature 5 (and the launch half of feature 4): the Latency-sensitive checkbox in step 1
 * (spec-b B5-23 to B5-34), its review row, blocking item and warnings (B5-35 to B5-42) and the
 * dataset picker badges (B4-21 to B4-27). Numbers are the spec's, measured at 1440, 1024 and 390.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { createEnvironment, fakeJobsOf, getExperiment, resetFakes, setFakeFlags, FAKE_A, test } from '../support';
import { launchButton, nameBox, openLaunch, review, seedLaunch, type LaunchFixture } from './launchSupport';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const WIDTHS = [1440, 1024, 390] as const;
const HELPER =
  'Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.';
const CEILING =
  'No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)';

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const checkbox = (page: Page) => page.getByRole('checkbox', { name: 'Latency-sensitive run' });
const block = (page: Page) => page.getByTestId('launch-latency');

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b).toBeTruthy();
  return b!;
}

test.describe('Run settings', () => {
  for (const width of WIDTHS) {
    test(`checkbox, helper, callout and review row at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await nameBox(page).fill('quiet run');
      await expect(checkbox(page)).not.toBeChecked();
      // Below the name/priority row (B5-23); the Versioning details box is gone (QA2-9).
      const nameTop = (await box(nameBox(page))).y;
      const checkTop = (await box(checkbox(page))).y;
      expect(nameTop).toBeLessThan(checkTop);
      await expect(page.getByLabel('Versioning details')).toHaveCount(0);
      const helper = block(page).getByText(HELPER);
      await expect(helper).toBeVisible();
      expect(await helper.evaluate((el) => getComputedStyle(el).paddingInlineStart)).toBe('24px');
      const lineHeight = 15.4;
      const lines = Math.round((await box(helper)).height / lineHeight);
      expect(lines).toBe(width === 1440 ? 1 : width === 1024 ? 2 : 4);
      await expect(page.getByText('Other jobs wait while this run executes')).toHaveCount(0);

      await checkbox(page).check({ force: true });
      const callout = page.getByRole('note').filter({ hasText: 'Other jobs wait while this run executes' });
      await expect(callout).toBeVisible();
      const c = await box(callout);
      expect(c.height).toBeCloseTo(width === 390 ? 51.6 : 34.8, 0);
      // B5-34: nothing scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      // Review row (B5-35): "Latency-sensitive: yes" after Priority.
      const summary = review(page).getByLabel('Summary');
      await expect(summary).toContainText('Latency-sensitive');
      await expect(summary).toContainText('yes');
      await expect(page.getByLabel('Summary').getByText('Priority')).toBeVisible();
    });
  }

  test('the request carries latency_sensitive only when ticked, and the keyboard toggles it', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const bodies: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/experiments$/.test(r.url())) bodies.push(r.postDataJSON());
    });
    await nameBox(page).fill('keyboard');
    await checkbox(page).focus();
    await page.keyboard.press('Space');
    await expect(checkbox(page)).toBeChecked();
    await expect(checkbox(page)).toHaveAttribute('aria-describedby', /launch-latency-help/);
    await expect.poll(() => bodies.some((b) => (b as { latency_sensitive?: boolean }).latency_sensitive === true)).toBe(true);
    await page.keyboard.press('Space');
    await expect(checkbox(page)).not.toBeChecked();
    await expect.poll(() => bodies.some((b) => !('latency_sensitive' in (b as object)))).toBe(true);
  });

  test('launching a latency-sensitive experiment stores the flag and sends it to the service', async ({
    page,
    request,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('flagged');
    await checkbox(page).check({ force: true });
    await expect(launchButton(page)).toBeEnabled({ timeout: 15_000 });
    await launchButton(page).click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}/);
    const id = page.url().split('/').pop()!.split('?')[0]!;
    const res = await request.get(`/v1/projects/${f.project.id}/experiments/${id}`);
    expect((await res.json()).latency_sensitive).toBe(true);
    await expect(page.getByTestId('latency-tag')).toBeVisible();
    await expect
      .poll(async () => {
        const detail = await getExperiment(request, f.project.id, id);
        const jobs = await fakeJobsOf(request, detail, FAKE_A);
        return jobs.length > 0 && jobs.every((j) => j.latency_sensitive === true);
      })
      .toBe(true);
  });
});

test.describe('Review warnings', () => {
  test('the ceiling and token warnings appear for a service that declares the keys and never block', async ({
    page,
    request,
  }) => {
    await setFakeFlags(request, FAKE_A, true);
    const declaring = await createEnvironment(request, f.project.id, 'Declaring');
    await openLaunch(page, f.project.slug, `?env=${declaring.id}`);
    await nameBox(page).fill('ceiling');
    await checkbox(page).check({ force: true });
    const callout = review(page).getByRole('note').filter({ hasText: 'Post-run ceiling not set' });
    await expect(callout).toBeVisible({ timeout: 15_000 });
    await expect(callout).toContainText(CEILING);
    await expect(callout.getByRole('button', { name: 'Set ceiling' })).toBeVisible();
    // F1 (B5-39): "Set ceiling" opens the collapsed group and focuses the setting's input.
    await callout.getByRole('button', { name: 'Set ceiling' }).click();
    await expect(page.getByRole('heading', { name: 'Environment configurations', level: 2 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Post Run Max Requests/i })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await openLaunch(page, f.project.slug, `?env=${declaring.id}`);
    // A warning is not a problem: it never joins the list of problems to fix (B5-41).
    await expect(review(page).getByRole('list', { name: 'Problems to fix' })).not.toContainText('ceiling');
  });
});

test.describe('Dataset picker', () => {
  test('a private test set carries its badge and the token help; plain datasets carry none', async ({
    page,
    request,
  }) => {
    const res = await request.post('/v1/datasets', {
      data: { project_slug: f.project.slug, name: 'secret-set', description: 'e2e', private_test_set: true },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      const trigger = page.getByRole('button', { name: /^(golden|secret-set|Choose a dataset) Dataset$/ });
      await trigger.click();
      const options = page.getByRole('option');
      await expect(options).toHaveCount(2);
      const chip = options.filter({ hasText: 'secret-set' }).getByTestId('dataset-chip');
      await expect(chip).toHaveText('Private test set');
      // F2 (B4-22): the badge is 99 x 20 in the open list, as in the trigger.
      const chipBox = await box(chip);
      expect([Math.round(chipBox.width * 10) / 10, Math.round(chipBox.height)]).toEqual([99, 20]);
      await expect(options.filter({ hasText: 'golden' }).getByTestId('dataset-chip')).toHaveCount(0);
      // No launch gate: every option is selectable.
      for (const o of await options.all()) await expect(o).not.toHaveAttribute('aria-disabled', 'true');
      await options.filter({ hasText: 'secret-set' }).click();
      await expect(page.getByTestId('dataset-token-help')).toContainText('Private test set. The experiment reads it');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  });
});

test.describe('Token warning', () => {
  test('the not-sent warning reads the same sentence and measures the amended heights (B5-40)', async ({
    page,
    request,
  }) => {
    const res = await request.post('/v1/datasets', {
      data: { project_slug: f.project.slug, name: 'golden-private', description: 'e2e', private_test_set: true },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const heights: Record<number, number> = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await nameBox(page).fill('token');
      await page.getByRole('button', { name: /^(golden|golden-private|Choose a dataset) Dataset$/ }).click();
      await page.getByRole('option', { name: /golden-private/ }).click();
      const callout = review(page).getByRole('note').filter({ hasText: 'Dataset read token will not be sent' });
      await expect(callout).toBeVisible({ timeout: 15_000 });
      await expect(callout).toContainText(
        'The schema of Alpha does not declare QYM_DATASET_READ_TOKEN, so \u201cgolden-private\u201d (private) is read with the worker\u2019s own token.',
      );
      heights[width] = Math.round((await box(callout)).height * 10) / 10;
    }
    console.log('B5-40 heights', JSON.stringify(heights));
    // Amended: the verbatim sentence wraps to 73.6 px in the 777 px column at 1024.
    expect(heights[1024]).toBe(73.6);
  });
});
