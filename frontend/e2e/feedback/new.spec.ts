/// <reference lib="dom" />
/** QE-25 to QE-34: the subject step. */
import { test, expect } from '@playwright/test';
import { createProject } from '../helpers';
import { gotoApp } from '../helpers';
import { box, configureAgent, near, overflowX, record, setViewport, shot, WIDTHS } from './support';

test.beforeAll(async ({ request }) => {
  await configureAgent(request);
});

test('QE-25 to QE-29: the form card, radio group, message field and footer', async ({ page }) => {
  const expectedCard = { 1440: 827, 1024: 777, 390: 279 } as const;
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, '/feedback/new');
    const form = page.getByTestId('new-form');
    await expect(form).toBeVisible();
    const card = await box(form);
    near(card.w, expectedCard[w]);
    const area = await box(page.getByLabel('What do you need?'));
    await expect(page.getByRole('radio', { name: /qym itself/ })).toBeChecked();
    await expect(page.getByText('Visible to everyone signed in')).toBeVisible();
    const start = page.getByRole('button', { name: 'Start conversation' });
    await expect(start).toBeDisabled();
    await page.getByLabel('What do you need?').fill('We need a PDF export.');
    await expect(start).toBeEnabled();
    expect(await overflowX(page)).toBe(0);
    record(`new-${w}`, { card, textarea: area });
    await shot(page, 'new', w);
    await page.evaluate(() => sessionStorage.clear());
  }
  await expect(page.getByRole('listitem').filter({ hasText: 'You describe the need' })).toBeVisible();
});

test('QE-26, QE-143: the subject is one radio group with arrow keys', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback/new');
  const platform = page.getByRole('radio', { name: /qym itself/ });
  await platform.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /A product I evaluate/ })).toBeChecked();
});

test('QE-27, QE-33: product fields in order, preselected from the URL', async ({ page, request }) => {
  const project = await createProject(request, 'Support agent', 'support-agent');
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/new?subject=product&project=${project.slug}&kind=dataset`);
  const fields = page.getByTestId('product-fields');
  await expect(fields).toBeVisible();
  await expect(fields.getByRole('button', { name: /Project/ })).toContainText('Support agent');
  await expect(page.getByRole('radio', { name: 'Dataset' })).toBeChecked();
  const start = page.getByRole('button', { name: 'Start conversation' });
  await page.getByLabel('What do you need?').fill('Mark a nightly run red.');
  await expect(start).toBeEnabled();
});

test('QE-28, QE-51: counter from 3,600 characters; text is kept per tab (QE-32)', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback/new');
  const area = page.getByLabel('What do you need?');
  await area.fill('x'.repeat(3601));
  await expect(page.locator('form, body').getByText(/3,601 \/ 4,000/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('What do you need?')).toHaveValue('x'.repeat(3601));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/feedback$/);
  await gotoApp(page, '/feedback/new');
  await expect(page.getByLabel('What do you need?')).toHaveValue('');
});

test('QE-30: Start conversation creates one draft and moves to it', async ({ page }) => {
  await setViewport(page, 1440);
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/v1/feedback' && posts.push(r.url()));
  await gotoApp(page, '/feedback/new');
  await page.getByLabel('What do you need?').fill('We need a PDF export of the compare page.');
  await page.getByRole('button', { name: 'Start conversation' }).dblclick();
  await expect(page).toHaveURL(/\/feedback\/[0-9a-f-]{36}$/);
  expect(posts).toHaveLength(1);
  await expect(page.getByTestId('chat')).toBeVisible();
});

test('QE-34, QE-123: not configured replaces the form with the not-set-up page', async ({ page, request }) => {
  await request.delete('/v1/admin/feedback-agent');
  try {
    await setViewport(page, 1440);
    await gotoApp(page, '/feedback/new');
    await expect(page.getByTestId('feedback-unconfigured-page')).toBeVisible();
    await expect(page.getByText('The feedback assistant is not set up yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Feedback agent settings' })).toBeVisible();
    const empty = await box(page.locator('[data-empty-state]'));
    record('unconfigured-1440', { emptyState: empty });
    await shot(page, 'unconfigured', 1440);
    await gotoApp(page, '/feedback');
    await expect(page.getByText('The feedback assistant is not set up')).toBeVisible();
    await expect(page.getByTestId('new-feedback-disabled')).toHaveAttribute('title', 'An administrator has to connect a model first');
  } finally {
    await configureAgent(request);
  }
});
