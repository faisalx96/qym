/// <reference lib="dom" />
/** QE-1 to QE-4, QE-170: the navigation entry and the calls the shell does not make. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, countCalls, record, setViewport, shot, WIDTHS } from './support';

test.beforeAll(async ({ request }) => {
  await configureAgent(request);
});

test('QE-1 to QE-3: Feedback is the third global entry, 32 px high, active on every feedback page', async ({ page }) => {
  const expected = { 1440: 175, 1024: 175, 390: 39 } as const;
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, '/feedback');
    const entry = page.locator('[data-nav="feedback"]');
    await expect(entry).toBeVisible();
    const global = page.getByRole('navigation', { name: /Global|Main/i }).first();
    const ids = await page.locator('[data-nav]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
    expect(ids.slice(0, 3)).toEqual(['projects', 'docs', 'feedback']);
    await expect(entry).toHaveAttribute('aria-current', 'page');
    const b = await box(entry);
    expect(b.h).toBeGreaterThanOrEqual(31);
    expect(Math.abs(b.w - expected[w]), `${b.w} vs ${expected[w]}`).toBeLessThanOrEqual(4);
    record(`nav-${w}`, { entry: b, items: ids });
    void global;
    if (w === 1440) await shot(page, 'nav', w);
  }
  await gotoApp(page, '/feedback/new');
  await expect(page.locator('[data-nav="feedback"]')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/New feedback/);
});

test('QE-4: the shell makes no feedback call on the home page or a run page', async ({ page }) => {
  const calls = countCalls(page, '/v1/feedback');
  await setViewport(page, 1440);
  await gotoApp(page, '/');
  await page.waitForTimeout(800);
  expect(calls.urls()).toEqual([]);
  await gotoApp(page, '/admin/runs');
  await page.waitForTimeout(500);
  expect(calls.urls()).toEqual([]);
});

test('QE-4: the command palette offers Feedback and New feedback', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/');
  await page.getByRole('button', { name: /^Go to/ }).click();
  await page.getByRole('dialog', { name: 'Go to' }).locator('input').fill('feedback');
  await expect(page.getByRole('option', { name: /^Feedback/ }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: /New feedback/ })).toBeVisible();
});

test('QE-170: only the status call precedes a feedback page opening', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/');
  const calls = countCalls(page, '/v1/feedback');
  await page.getByRole('link', { name: 'Feedback' }).first().click();
  await expect(page.getByTestId('feedback-list-page')).toBeVisible();
  await page.waitForTimeout(600);
  const urls = calls.urls();
  expect(urls.filter((u) => u.startsWith('GET /v1/feedback/status')).length).toBe(1);
  expect(urls.filter((u) => /GET \/v1\/feedback$/.test(u)).length).toBe(1); // QE-20: one list request per page view
});
