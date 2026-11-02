/// <reference lib="dom" />
/** QE-123 to QE-138: loading frames at the loaded height, errors, empty, resume, limits. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, near, record, seedFeedback, setViewport, shot, WIDTHS } from './support';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(0);
});

test('QE-125: the list loading frame is as tall as the loaded table at three widths (0 ± 1 px)', async ({ page }) => {
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, '/feedback');
    await expect(page.getByTestId('dup-note')).toBeVisible();
    await page.waitForTimeout(700);
    const loaded = await box(page.getByTestId('feedback-table-frame'));
    await page.route('**/v1/feedback?*', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue().catch(() => undefined);
    });
    await page.reload();
    await expect(page.getByTestId('feedback-table-frame')).toBeVisible();
    await page.waitForTimeout(900);
    const frame = await box(page.getByTestId('feedback-table-frame'));
    record(`loading-${w}`, { loaded, frame, delta: Math.round((frame.h - loaded.h) * 10) / 10 });
    await shot(page, 'list-loading', w);
    near(frame.h, loaded.h);
    await page.unroute('**/v1/feedback?*');
  }
});

test('QE-126: a failed list is an error with Retry, never an empty list', async ({ page }) => {
  await setViewport(page, 1440);
  await page.route('**/v1/feedback?*', (route) => route.fulfill({ status: 500, json: { detail: 'boom' } }));
  await gotoApp(page, '/feedback');
  await expect(page.getByText('Couldn’t load feedback')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await shot(page, 'list-error', 1440);
});

test('QE-127: filtered to nothing says so; QE-136 is covered by the platform rate-limit test', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback?q=zzzz-nothing&sort=priority:desc');
  await expect(page.getByText('No requests match.')).toBeVisible();
  // The empty state offers the way out (review fix): Clear filters drops the search and keeps the sort.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/feedback\?sort=priority/);
  await expect(page.getByRole('link', { name: 'FB-0001' }).first()).toBeVisible();
});

test('QE-125: the chat loading frame is as tall as the loaded chat at three widths (0 ± 1 px)', async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = ((await (await request.post('/v1/feedback', { data: { subject: 'platform', message: 'A draft for the loading frame.' } })).json()) as { id: string }).id;
  await request.post(`/v1/feedback/${id}/turn`, { headers: { Accept: 'application/json' } });
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByTestId('feedback-chat-page')).toBeVisible();
    const loaded = await box(page.getByTestId('feedback-chat-page'));
    await page.route(new RegExp(`/v1/feedback/${id}$`), async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue().catch(() => undefined);
    });
    await page.reload();
    await expect(page.getByTestId('chat-loading')).toBeVisible();
    await page.waitForTimeout(600);
    const frame = await box(page.getByTestId('chat-loading'));
    near(frame.h, loaded.h, 1);
    await page.unroute(new RegExp(`/v1/feedback/${id}$`));
  }
});

test('QE-129: the message limit callout and a forced proposal', async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.put('/v1/admin/feedback-agent', { data: { max_user_messages: 6 } });
  await configureAgent(request, 'forced_propose');
  try {
    const res = await request.post('/v1/feedback', { data: { subject: 'platform', message: 'Message 1 of 6.' } });
    const id = ((await res.json()) as { id: string }).id;
    await request.post(`/v1/feedback/${id}/turn`, { headers: { Accept: 'application/json' } });
    for (let i = 2; i <= 5; i += 1)
      await request.post(`/v1/feedback/${id}/messages`, { data: { content: `Message ${i} of 6.` }, headers: { Accept: 'application/json' } });
    await setViewport(page, 1440);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByTestId('chat-log')).toContainText('Message 5 of 6.');
    await page.getByLabel('Your reply').fill('Message 6 of 6.');
    await page.getByLabel('Your reply').press('Enter');
    await expect(page.getByText('6 of 6 messages used')).toBeVisible();
    await expect(page.getByTestId('proposal')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('proposal')).toContainText('The assistant did not learn:');
    await shot(page, 'chat-limit', 1440);
  } finally {
    await request.put('/v1/admin/feedback-agent', { data: { max_user_messages: 30 } });
    await configureAgent(request);
  }
});

test('QE-130: an invented request id is removed and the log says so', async ({ page, request }) => {
  await configureAgent(request, 'invalid_request_id');
  try {
    const res = await request.post('/v1/feedback', { data: { subject: 'platform', message: 'Invented id please.' } });
    const id = ((await res.json()) as { id: string }).id;
    await setViewport(page, 1440);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByText('The assistant’s proposal named a request that does not exist. It was removed before you saw it.')).toBeVisible({ timeout: 20_000 });
    await shot(page, 'chat-corrected', 1440);
  } finally {
    await configureAgent(request);
  }
});

test('QE-54, QE-152: Arabic text renders right to left inside its block', async ({ page, request }) => {
  await configureAgent(request, 'arabic');
  try {
    const res = await request.post('/v1/feedback', { data: { subject: 'platform', message: 'نحتاج إلى تصدير المقارنة' } });
    const id = ((await res.json()) as { id: string }).id;
    await setViewport(page, 1440);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByTestId('chat-log')).toContainText('شكرًا', { timeout: 15_000 });
    const dirs = await page.getByTestId('chat-log').locator('[data-text-mode]').evaluateAll((els) => els.map((e) => e.getAttribute('dir')));
    expect(dirs.every((d) => d === 'rtl')).toBe(true);
  } finally {
    await configureAgent(request);
  }
});
