/**
 * The Models page over a real project (cutover of test_models_paging_browser.py, whose server half
 * is tests/platform/test_dashboard_models_api.py): one card per model, K runs per model, the run
 * selection dialog across pages, and failures with Retry instead of false zero scores.
 */
import { test, expect, type Page } from '@playwright/test';
import { APP } from '../helpers';
import { clickBox, sharedProject } from './support';

const url = (slug: string, qs = '') => `${APP}/projects/${slug}/models?task=text2sql&dataset=spider-dev${qs}`;
const cards = (page: Page) => page.locator('article[data-model]');

test('one card per model for the chosen task and dataset, with a ranking', async ({ page, request }) => {
  const s = await sharedProject(request, 55, 'big');
  await page.goto(url(s.project.slug));
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole('heading', { name: /^Ranking by/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Rank 1' })).toBeVisible();
  // every metric of the runs is offered, whichever run carries it
  await page
    .getByRole('button', { name: /Metric/ })
    .first()
    .click();
  const options = page.getByRole('option');
  await expect(options.filter({ hasText: 'accuracy' })).toBeVisible();
  await expect(options.filter({ hasText: 'quality' })).toBeVisible();
  await expect(options.filter({ hasText: 'latency_s' })).toBeVisible();
});

test('choosing a task and dataset is part of the URL; K narrows the runs counted per model', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 55, 'big');
  await page.goto(`${APP}/projects/${s.project.slug}/models`);
  await expect(page.getByText('Select a task and dataset')).toBeVisible();
  await page.goto(url(s.project.slug, '&k=3'));
  await expect(cards(page)).toHaveCount(2);
  for (const card of await cards(page).all())
    await expect(card).toContainText(/3 of \d+|3\s*\/\s*\d+|last 3/i);
  const stats: Array<{ groups: Array<{ runs: string[] }> }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /models\/stats/.test(r.url())) stats.push(r.postDataJSON());
  });
  await page.goto(url(s.project.slug, '&k=100'));
  await expect(cards(page)).toHaveCount(2);
  await expect.poll(() => stats.length).toBeGreaterThan(0);
  // One statistics request carries every model's runs (no per-run row reads).
  const last = stats[stats.length - 1]!;
  expect(last.groups.length).toBe(2);
  expect(last.groups.every((g) => g.runs.length > 3)).toBe(true);
});

test('the run selection dialog keeps picks across pages, caps them at K and applies them to the card', async ({
  page,
  request,
}) => {
  const s = await sharedProject(request, 55, 'big');
  await page.goto(url(s.project.slug, '&k=4'));
  const card = cards(page).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^Edit run selection of/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Select runs/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('4 / 4 selected');
  // at the cap the other boxes are disabled until one is removed
  const boxes = dialog.getByRole('checkbox');
  const checked = dialog.getByRole('checkbox', { checked: true });
  await expect(checked).toHaveCount(4);
  const unchecked = dialog.getByRole('checkbox', { checked: false }).first();
  await expect(unchecked).toBeDisabled();
  await clickBox(checked.first());
  await expect(dialog).toContainText('3 / 4 selected');
  await expect(unchecked).toBeEnabled();
  await clickBox(unchecked);
  await expect(dialog).toContainText('4 / 4 selected');
  expect(await boxes.count()).toBeGreaterThan(4);
  await dialog.getByRole('button', { name: 'Apply selection' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cards(page).first()).toBeVisible();
  // reopening shows the applied selection
  await cards(page)
    .first()
    .getByRole('button', { name: /^Edit run selection of/ })
    .click();
  await expect(page.getByRole('dialog', { name: /^Select runs/ })).toContainText('4 / 4 selected');
});

for (const failing of ['/api/dashboard/models', '/api/dashboard/models/stats'] as const) {
  test(`a failed ${failing.split('/').pop()} read shows an error with Retry and no zero scores`, async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 55, 'big');
    let fail = true;
    await page.route(
      (u) => u.pathname === failing && fail,
      (route) => route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }),
    );
    await page.goto(url(s.project.slug));
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(cards(page)).toHaveCount(0);
    fail = false;
    await alert.getByRole('button', { name: /Retry/ }).click();
    await expect(cards(page)).toHaveCount(2);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
}
