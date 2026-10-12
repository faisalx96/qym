/// <reference lib="dom" />
/** QA fix list (datasets.md, reviews): bulk approve of decided rows, All-tab advance, history refresh, reasoning badge. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { decideViaApi, seedReviews } from './support';

const row = (page: Page, id: number) => page.locator(`[data-correction-row="${id}"]`);

test.describe('reviews QA fixes', () => {
  test('bulk Approve on decided rows refuses instead of opening an "Approve 0 corrections" dialog', async ({
    page,
    request,
  }) => {
    const s = await seedReviews(request, 'qabulk', 3);
    await decideViaApi(request, s.corrections[0]!.id, 'approve');
    await gotoApp(page, `/projects/${s.project.slug}/reviews?status=all`);
    await expect(page.locator('[data-correction-row]')).toHaveCount(3);
    await page.getByTestId(`row-${s.corrections[0]!.id}`).focus();
    await page.keyboard.press('x');
    await expect(page.getByTestId('bulk-approve')).toBeVisible();
    await page.keyboard.press('Shift+A');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/pending/i).first()).toBeVisible();
    await expect(page.getByTestId('bulk-approve')).toBeDisabled();
  });

  test('on the All tab a / r moves to the next pending row and never re-approves a decided one', async ({
    page,
    request,
  }) => {
    const s = await seedReviews(request, 'qaall', 3);
    await gotoApp(page, `/projects/${s.project.slug}/reviews?status=all`);
    const [c1, c2] = [s.corrections[0]!.id, s.corrections[1]!.id];
    await expect(page.getByTestId(`row-${c1}`)).toHaveAttribute('aria-current', 'true');
    const posts: string[] = [];
    page.on(
      'request',
      (r) => r.method() === 'POST' && /\/api\/corrections\/\d+\/approve/.test(r.url()) && posts.push(r.url()),
    );
    await page.getByTestId(`row-${c1}`).focus();
    await page.keyboard.press('a');
    await expect(row(page, c1)).toHaveAttribute('data-status', 'approved');
    await expect(page.getByTestId(`row-${c2}`)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('k');
    await expect(page.getByTestId(`row-${c1}`)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('a'); // decided: no second request
    await page.waitForTimeout(300);
    expect(posts).toHaveLength(1);
  });

  test('a reasoning model shows a badge on the row', async ({ page, request }) => {
    const s = await seedReviews(request, 'qareason', 2);
    await page.route(/\/api\/corrections\?/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.corrections = body.corrections.map((c: object) => ({ ...c, has_reasoning: true }));
      await route.fulfill({ response: res, json: body });
    });
    await gotoApp(page, `/projects/${s.project.slug}/reviews`);
    await expect(row(page, s.corrections[0]!.id)).toContainText('reasoning');
  });
});
