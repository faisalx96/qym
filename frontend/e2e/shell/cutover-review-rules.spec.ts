/**
 * Cutover of tests/platform/test_review_rules.py::test_reviews_page_disables_blocked_decisions_with_the_rule_and_equal_buttons
 * (the project settings half): the General tab edits who may approve corrections and whether the
 * author may review their own, and saves through PATCH /v1/projects/{id}/review-rules.
 * (The disabled decisions with the rule on the Reviews page: e2e/reviews/reviews.spec.ts.)
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';

test('General: the review rules save to the project and survive a reload', async ({ page, request }) => {
  const project = await createProject(request, 'Review rules', uniqueSlug('rules'));
  await gotoApp(page, `/projects/${project.slug}/settings`);
  const card = page.locator('section[aria-labelledby="general-rules"]');
  await expect(card).toBeVisible();
  const save = card.getByRole('button', { name: 'Save rules' });
  const different = card.getByRole('checkbox', { name: 'Require a different reviewer than the author' });
  await expect(different).not.toBeChecked();
  await expect(save).toBeDisabled();

  await card.getByRole('button', { name: /Approvers/ }).click();
  await page.getByRole('option', { name: 'Managers only' }).click();
  await card.getByText('Require a different reviewer than the author').click();
  await expect(different).toBeChecked();
  await expect(save).toBeEnabled();
  const put = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/v1/projects/${project.id}/review-rules`));
  await save.click();
  expect((await put).postDataJSON()).toEqual({
    correction_approvers: 'managers',
    correction_require_different_reviewer: true,
  });
  await expect(page.getByRole('status').filter({ hasText: 'Review rules saved' })).toBeVisible();

  await page.reload();
  const again = page.locator('section[aria-labelledby="general-rules"]');
  await expect(again.getByRole('checkbox', { name: 'Require a different reviewer than the author' })).toBeChecked();
  await expect(again.getByRole('button', { name: /Approvers/ })).toContainText('Managers only');
  await expect(again.getByRole('button', { name: 'Save rules' })).toBeDisabled();
});
