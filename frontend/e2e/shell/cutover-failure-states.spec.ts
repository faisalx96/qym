/**
 * Failure states and dialog focus from the P1 accessibility review
 * (cutover of test_p1_a11y_visual_browser.py): a failed read is an error with the right
 * kind of message, never the empty state; Arabic text reads right to left; modals keep
 * focus inside and give it back.
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { seedReviews } from '../reviews/support';

test.describe('datasets', () => {
  for (const failure of ['abort', 500, 403] as const) {
    test(`a failed dataset list (${failure}) is an error, not "No datasets yet"`, async ({
      page,
      request,
    }) => {
      const project = await createProject(request, 'Failure datasets', uniqueSlug('fail-ds'));
      await page.route(/\/v1\/datasets(\?|$)/, (route) =>
        failure === 'abort' ? route.abort() : route.fulfill({ status: failure, json: { detail: 'nope' } }),
      );
      await gotoApp(page, `/projects/${project.slug}/datasets`);
      const alert = page.getByRole('alert');
      await expect(alert.first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('No datasets yet')).toHaveCount(0);
      await expect(page.getByText('Create your first dataset')).toHaveCount(0);
      if (failure !== 403) await expect(alert.getByRole('button', { name: /Retry/ })).toBeVisible();
      else await expect(alert.getByRole('button', { name: /Retry/ })).toHaveCount(0);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    });
  }

  test('the dataset detail says "not found" only for a 404; other failures offer Retry', async ({
    page,
    request,
  }) => {
    const project = await createProject(request, 'Failure dataset detail', uniqueSlug('fail-dd'));
    await gotoApp(page, `/projects/${project.slug}/datasets/missing-dataset`);
    await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 15_000 });
    await page.route(/\/v1\/datasets\/broken/, (route) =>
      route.fulfill({ status: 500, json: { detail: 'boom' } }),
    );
    await gotoApp(page, `/projects/${project.slug}/datasets/broken`);
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).not.toContainText(/not found/i);
    await expect(alert.getByRole('button', { name: /Retry/ })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('reviews', () => {
  test('a failed load is an error with Retry, not "no corrections"', async ({ page, request }) => {
    const project = await createProject(request, 'Failure reviews', uniqueSlug('fail-rv'));
    let fail = true;
    await page.route(/\/api\/corrections(\?|$)/, (route) =>
      fail ? route.fulfill({ status: 500, body: 'boom' }) : route.continue(),
    );
    await gotoApp(page, `/projects/${project.slug}/reviews`);
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No corrections/i)).toHaveCount(0);
    fail = false;
    await alert.getByRole('button', { name: /Retry/ }).click();
    await expect(alert).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Arabic previews read right to left with lang="ar"; code stays left to right', async ({
    page,
    request,
  }) => {
    const s = await seedReviews(request, 'revar', 6);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    // The first correction belongs to an Arabic item (every 5th seeded item is Arabic).
    const first = page.locator(`[data-correction-row="${s.corrections[0]!.id}"]`);
    await first.locator('[data-review-card]').focus();
    await page.keyboard.press('o');
    await expect(page.locator('[data-full-detail]')).toBeVisible();
    const arabic = page.locator('[data-full-detail] [dir="rtl"][lang="ar"]');
    await expect(arabic.first()).toBeVisible();
    const style = await arabic.first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { direction: cs.direction, leading: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) };
    });
    expect(style.direction).toBe('rtl');
    expect(Math.abs(style.leading - 1.7)).toBeLessThan(0.01);
  });

  test('the Reject dialog is labelled, traps Tab, and Escape returns focus to the row', async ({
    page,
    request,
  }) => {
    const s = await seedReviews(request, 'revdlg', 3);
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    const first = page.locator('[data-correction-row]').first();
    const reject = first.getByRole('button', { name: /^Reject/ }).first();
    await reject.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', /true|$/);
    expect(await dlg.getAttribute('aria-labelledby')).toBeTruthy();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    // Focus goes back to the review card of the row it came from.
    await expect(page.locator('[data-review-card]:focus')).toHaveCount(1);
  });
});

test.describe('compare', () => {
  test('a failed compare is an error with Retry, not "No runs to compare"', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/compare?*', (route) => {
      calls++;
      return route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    await page.goto('/compare?runs=r1&runs=r2');
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No runs to compare')).toHaveCount(0);
    await alert.getByRole('button', { name: /Retry/ }).click();
    await expect.poll(() => calls).toBe(2);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Compare names the runs the server could not return', async ({ page }) => {
    await page.route('**/api/compare?*', (route) =>
      route.fulfill({ json: { runs: [], missing_runs: [{ run_id: 'r1' }, { run_id: 'r2' }] } }),
    );
    await page.goto('/compare?runs=r1&runs=r2');
    await expect(page.getByText('Runs in this comparison were not found')).toBeVisible({ timeout: 15_000 });
    const text =
      (await page.getByRole('alert').first().innerText()) + (await page.locator('main').innerText());
    expect(text).toContain('2 of the runs in this link were deleted or are not visible to you');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('shell dialogs', () => {
  test('New project is a labelled modal: focus starts on Name, Tab stays inside, Escape returns focus', async ({
    page,
  }) => {
    await gotoApp(page, '/');
    const trigger = page.getByRole('button', { name: /New project/i }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: /project/i });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    await expect(dlg.getByRole('textbox', { name: /Slug/i })).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
