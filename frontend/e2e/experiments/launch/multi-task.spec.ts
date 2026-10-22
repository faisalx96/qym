/**
 * WP-D: the task row inside a ticked environment's box (spec-d QD-30 to QD-39): the row and its geometry at
 * 1440 / 1024 / 390, the request counts, the states (loading at the loaded height, empty, error, unsupported,
 * archived) and what the document does with the chosen task.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { archiveProject, unarchiveProject } from '../../helpers';
import { expectNoPageOverflow, FAKE_A, resetFakes, setFakeTasks, test } from '../support';
import { captureExperimentPosts, openHome, openLaunch } from './launchSupport';
import { envBox, seedMulti, sized, WIDTHS, type MultiFixture } from './multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

const SHOTS = process.env.QYM_SHOTS_DIR;
let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});

const both = () => `?env=${f.production.id},${f.staging.id}`;
const row = (page: Page, env = 'production') => envBox(page, env).locator('[data-env-task]');
const select = (page: Page) => row(page).getByRole('button', { name: /Task of production/ });
function save(name: string, data: unknown): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(data, null, 2));
}
function countTasks(page: Page) {
  let hits: string[] = [];
  page.on('request', (r) => {
    const m = /\/eval-environments\/([^/]+)\/tasks$/.exec(r.url());
    if (r.method() === 'GET' && m) hits.push(m[1]!);
  });
  return { of: (id: string) => hits.filter((h) => h === id).length, total: () => hits.length, reset: () => (hits = []) };
}
const near = (actual: number, expected: number, tolerance = 1.6) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);

test.describe('the task row', () => {
  for (const width of WIDTHS) {
    test(`geometry at ${width}px (QD-30, QD-32)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openHome(page, f.project.slug, `?env=${f.production.id}`);
      await expect(row(page)).toHaveAttribute('data-status', 'ok');
      const m: Record<string, unknown> = { width };
      m['row'] = await sized(row(page));
      m['select'] = await sized(select(page));
      m['box'] = await sized(envBox(page, 'production'));
      near((await sized(row(page))).height, 24);
      await expect(row(page)).toContainText('Task');
      // Directly after the versions line, inside the same box.
      const order = await envBox(page, 'production').evaluate((li) =>
        Array.from(li.children).map((c) => c.getAttribute('data-env-version') !== null ? 'versions' : c.getAttribute('data-env-task') !== null ? 'task' : 'other'),
      );
      expect(order.slice(-2)).toEqual(['versions', 'task']);
      // Worker default, then the tasks in the service's order, each with its description.
      await expect(select(page)).toContainText('Worker default');
      await select(page).click();
      const options = page.getByRole('option');
      await expect(options).toHaveCount(4);
      const texts = await options.allInnerTexts();
      expect(texts.map((t) => t.split('\n')[0])).toEqual(['Worker default', 'Answer a ticket', 'Route a ticket', 'Summarise a ticket']);
      expect(texts[1]).toContain('Reply to a support ticket from the knowledge base');
      if (width === 1440 && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-d-task-open-1440.png') });
      await page.keyboard.press('Escape');
      await expectNoPageOverflow(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `after-d-task-row-${width}.png`), fullPage: true });
      save(`measure-d-task-${width}`, m);
    });
  }

  test('QD-28, QD-31: one tasks request per ticked environment that offers tasks; none for the other, none on Customize', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const counts = countTasks(page);
    await openHome(page, f.project.slug);
    await page.getByRole('checkbox', { name: 'staging' }).click({ force: true }); // a v1.3 service: no row, no request
    await expect(page.locator('[data-env-version]')).toHaveCount(1);
    await expect(page.locator('[data-env-task]')).toHaveCount(0);
    expect(counts.total()).toBe(0);
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    expect(counts.of(f.production.id)).toBe(1);
    expect(counts.of(f.staging.id)).toBe(0);
    // Untick and Customize issue nothing.
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    await page.getByRole('button', { name: /Customize/ }).click();
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    expect(counts.total()).toBe(1);
    // Refresh reads versions and tasks, once each (QD-39).
    const refresh = envBox(page, 'production').getByRole('button', { name: 'Refresh versions and tasks of production' });
    await refresh.click();
    await expect.poll(() => counts.of(f.production.id)).toBe(2);
    await expect(envBox(page, 'staging').getByRole('button', { name: 'Refresh versions of staging' })).toBeVisible();
  });

  test('QD-38: the chosen task is part of the request and is dropped with the environment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await openHome(page, f.project.slug, both());
    await select(page).click();
    await page.getByRole('option', { name: /Route a ticket/ }).click();
    await expect(select(page)).toContainText('Route a ticket');
    await expect.poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task).toEqual({ [f.production.id]: 'route-ticket' });
    // Unticking drops the entry; a later tick starts at the worker default.
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    await expect(select(page)).toContainText('Worker default');
    await expect.poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task).toBeUndefined();
  });

  test('QD-33: the loading frame has the loaded height', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setFakeTasks(request, FAKE_A, { delay_ms: 1500 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(row(page)).toHaveAttribute('data-status', 'loading');
    await expect(row(page).getByRole('status')).toHaveText('Reading tasks…');
    const loading = await sized(envBox(page, 'production'));
    await expect(row(page)).toHaveAttribute('data-status', 'ok', { timeout: 8000 });
    const loaded = await sized(envBox(page, 'production'));
    expect(Math.abs(loading.height - loaded.height)).toBeLessThanOrEqual(1);
    save('measure-d-task-loading-1440', { loading, loaded });
  });

  test('QD-34: an empty list is a disabled select', async ({ page, request }) => {
    await setFakeTasks(request, FAKE_A, { tasks: [] });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    await expect(select(page)).toBeDisabled();
    await expect(select(page)).toContainText('No tasks listed');
    near((await sized(row(page))).height, 24);
  });

  test('QD-35: an error keeps the row and does not block launching', async ({ page, request }) => {
    await setFakeTasks(request, FAKE_A, { status: 503 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 900 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(row(page)).toHaveAttribute('data-status', 'error');
    await expect(row(page)).toContainText('Couldn’t read tasks: could not list tasks: registry offline');
    expect((await sized(row(page))).height).toBeGreaterThanOrEqual(24);
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
  });

  for (const status of [404, 405, 422]) {
    test(`QD-36: a service answering ${status} has no row and no error`, async ({ page, request }) => {
      await setFakeTasks(request, FAKE_A, { status });
      const consoleErrors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
      await openHome(page, f.project.slug, `?env=${f.production.id}`);
      await expect(page.locator('[data-env-version][data-status="ok"]')).toHaveCount(1);
      await expect(page.locator('[data-env-task]')).toHaveCount(0);
      await expect(page.getByText('Couldn’t read tasks')).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    });
  }

  test('QD-37: an archived project shows the task but cannot change it', async ({ page, request }) => {
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await select(page).click();
    await page.getByRole('option', { name: /Route a ticket/ }).click();
    await archiveProject(request, f.project.id);
    try {
      await page.reload();
      await expect(row(page)).toHaveAttribute('data-status', 'ok');
      await expect(select(page)).toBeDisabled();
    } finally {
      await unarchiveProject(request, f.project.id);
    }
  });

  test('QD-30: Customize step 1 shows the same row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`);
    await expect(row(page)).toHaveAttribute('data-status', 'ok');
    const box: Locator = envBox(page, 'production');
    save('measure-d-task-step1-1440', { box: await sized(box), row: await sized(row(page)), select: await sized(select(page)) });
  });
});
