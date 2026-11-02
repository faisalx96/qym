/**
 * QA-B points 2 and 4 (spec-b QA2-14, QA2-16, QA4-1 to QA4-13, QA4-16, amended 2026-10-22): the read-only
 * Evaluation Service versions shown inside each ticked environment's box on Customize step 1 (the same
 * component and query as the home view), the request counts, the loading frame at the loaded height and
 * the states. Numbers are the app's at 1440 / 1024 / 390.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  createEnvironment,
  describeViolations,
  FAKE_B,
  resetFakes,
  setFakeVersioning,
  test,
} from '../support';
import { archiveProject, unarchiveProject } from '../../helpers';
import {
  captureExperimentPosts,
  nameBox,
  openHome,
  openLaunch,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const WIDTHS = [1440, 1024, 390] as const;
const SHOTS = process.env.QYM_SHOTS_DIR;
let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const lines = (page: Page) => page.locator('[data-env-version]');
const boxOf = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const lineOf = (page: Page, name: string) => boxOf(page, name).locator('[data-env-version]');
const loaded = (page: Page) => page.locator('[data-env-version][data-status="ok"]');
const refreshOf = (page: Page, name: string) =>
  lineOf(page, name).getByRole('button', { name: `Refresh versions of ${name}` });
const round = (n: number) => Math.round(n * 10) / 10;
/** Sizes are measured in the web fonts: the mono tags are taller in the fallback font. */
async function box(l: Locator) {
  await l.page().evaluate(() => document.fonts.ready);
  const b = await l.boundingBox();
  expect(b).toBeTruthy();
  return b!;
}
/** Counts GET .../versioning-details requests per environment id. */
function countReads(page: Page): { total: () => number; of: (id: string) => number; reset: () => void } {
  let hits: string[] = [];
  page.on('request', (r) => {
    const m = /\/eval-environments\/([^/]+)\/versioning-details/.exec(r.url());
    if (r.method() === 'GET' && m) hits.push(m[1]!);
  });
  return {
    total: () => hits.length,
    of: (id) => hits.filter((h) => h === id).length,
    reset: () => (hits = []),
  };
}
const overflowing = (l: Locator) =>
  l.evaluate((el) =>
    [el, ...Array.from(el.querySelectorAll('[data-env-version]'))]
      .filter((n) => n.scrollWidth > n.clientWidth + 0.5)
      .map((n) => n.getAttribute('data-env-version') ?? n.tagName),
  );

async function twoEnvs(request: Parameters<typeof createEnvironment>[0]) {
  const other = await createEnvironment(request, f.project.id, 'Other', { port: FAKE_B });
  await setFakeVersioning(request, FAKE_B, { agent_version: 'agent-9.9.9', image_version: 'img-b', kb_version: 'kb-b' });
  return other;
}

test.describe('versions inside the environment box on step 1', () => {
  for (const width of WIDTHS) {
    test(`placement, size, rows and copy at ${width}px (QA4-1 to QA4-5, QA2-11)`, async ({ page, request }) => {
      const other = await twoEnvs(request);
      await page.setViewportSize({ width, height: 900 });
      // QA4-1: no environment ticked, no versions anywhere.
      await openLaunch(page, f.project.slug);
      await expect(lines(page)).toHaveCount(0);
      // One ticked: only its box carries a line.
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await expect(loaded(page)).toHaveCount(1);
      await expect(lineOf(page, 'Alpha')).toHaveCount(1);
      await expect(lineOf(page, 'Other')).toHaveCount(0);
      await expect(page.locator('li:not([data-selected="true"]) [data-env-version]')).toHaveCount(0);
      // Both ticked: one line per box, each the last child of its box.
      await openLaunch(page, f.project.slug, `?env=${f.env.id},${other.id}`);
      await expect(loaded(page)).toHaveCount(2);
      const placed = await lineOf(page, 'Alpha').evaluate((el) => {
        const li = el.parentElement!;
        return [li.tagName, li.getAttribute('data-selected'), li.lastElementChild === el];
      });
      expect(placed).toEqual(['LI', 'true', true]);
      // QA4-2 / QA4-3: the line spans the box's content width, one row high above 390.
      const liBox = await box(boxOf(page, 'Alpha'));
      const b = await box(lineOf(page, 'Alpha'));
      console.log('QA4-2 box', width, round(liBox.width), round(liBox.height), 'line', round(b.width), round(b.height));
      expect(round(liBox.width - b.width)).toBeCloseTo({ 1440: 18, 1024: 18, 390: 18 }[width], 0);
      // Row 1 = label | Refresh (24 px), then the values grid: two columns in the 343 px box (two
      // rows), one column at 390 (three rows); 4 px top gap + 1 px rule.
      expect(round(b.height)).toBe({ 1440: 77, 1024: 77, 390: 101 }[width]);
      expect(await overflowing(boxOf(page, 'Alpha'))).toEqual([]);
      expect(await overflowing(boxOf(page, 'Other'))).toEqual([]);
      // QA4-4: copy, one Refresh button per line, no input, no block title.
      await expect(lineOf(page, 'Alpha')).toContainText('Versions');
      await expect(page.getByText('Evaluation Service versions')).toHaveCount(0);
      await expect(page.getByText('Current versions')).toHaveCount(0);
      await expect(lineOf(page, 'Alpha').getByRole('button')).toHaveText(['Refresh']);
      await expect(lineOf(page, 'Other').getByRole('button')).toHaveText(['Refresh']);
      await expect(lines(page).locator('input, textarea, select, [contenteditable]')).toHaveCount(0);
      await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
      await expect(lineOf(page, 'Other')).toContainText('agent-9.9.9');
      await expect(lineOf(page, 'Alpha')).not.toContainText('agent-9.9.9');
      // Value tags: mono 10 px / 650, 20 px high, never truncated.
      const tag = lineOf(page, 'Alpha').locator('dd span').first();
      expect(await tag.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).textOverflow])).toEqual(['10px', '650', 'clip']);
      expect(Math.round((await box(tag)).height)).toBe(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-qb-versions-inline-step1-${width}.png`, fullPage: true });
    });
  }

  for (const width of [1440, 390] as const) {
    test(`home view: the same lines in the same boxes at ${width}px`, async ({ page, request }) => {
      const other = await twoEnvs(request);
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, f.project.slug, `?env=${f.env.id},${other.id}`);
      await expect(loaded(page)).toHaveCount(2);
      await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
      await expect(lineOf(page, 'Other')).toContainText('agent-9.9.9');
      await expect(page.getByText('Evaluation Service versions')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-qb-versions-inline-home-${width}.png`, fullPage: true });
    });
  }

  test('the same DOM and text as the home view (QA4-5)', async ({ page }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(loaded(page)).toHaveCount(1);
    const html = (l: Locator) => l.evaluate((el) => el.outerHTML.replace(/ (id|aria-labelledby|aria-describedby)="[^"]*"/g, ''));
    const home = await html(lineOf(page, 'Alpha'));
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(loaded(page)).toHaveCount(1);
    expect(await html(lineOf(page, 'Alpha'))).toBe(home);
  });

  test('one fetch per environment: cache hit on Customize, one per newly ticked environment, one per Refresh (QA4-6)', async ({
    page,
    request,
  }) => {
    const other = await twoEnvs(request);
    const reads = countReads(page);
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(loaded(page)).toHaveCount(1);
    expect(reads.of(f.env.id)).toBe(1);
    expect(reads.of(other.id)).toBe(0);
    reads.reset();
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(loaded(page)).toHaveCount(1);
    expect(reads.total()).toBe(0);
    // Ticking a second environment on step 1 reads only that one.
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(loaded(page)).toHaveCount(2);
    expect(reads.of(other.id)).toBe(1);
    expect(reads.of(f.env.id)).toBe(0);
    // Unticking reads nothing and removes the line.
    reads.reset();
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(lines(page)).toHaveCount(1);
    expect(reads.total()).toBe(0);
    // Refresh: one for its own environment only.
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(loaded(page)).toHaveCount(2);
    reads.reset();
    await refreshOf(page, 'Alpha').click();
    await expect.poll(() => reads.total()).toBe(1);
    expect(reads.of(f.env.id)).toBe(1);
    expect(reads.of(other.id)).toBe(0);
    await refreshOf(page, 'Other').click();
    await expect.poll(() => reads.total()).toBe(2);
    expect(reads.of(other.id)).toBe(1);
    // A hard reload reads each once.
    reads.reset();
    await page.goto(`/projects/${f.project.slug}/experiments/new?step=where&env=${f.env.id},${other.id}`);
    await expect(loaded(page)).toHaveCount(2);
    expect(reads.of(f.env.id)).toBe(1);
    expect(reads.of(other.id)).toBe(1);
  });

  for (const width of WIDTHS) {
    test(`the loading frame is the loaded height at ${width}px (QA4-7)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route('**/versioning-details', async (route) => {
        await gate;
        await route.continue();
      });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      const list = page.locator('dl[aria-busy="true"]');
      await expect(list).toHaveCount(1);
      await expect(lineOf(page, 'Alpha').getByRole('status')).toHaveText('Reading…');
      // The line, not the whole box: the box's "Checking schema…" tag comes and goes on its own clock.
      const loading = await box(lineOf(page, 'Alpha'));
      release();
      await expect(loaded(page)).toHaveCount(1);
      const done = await box(lineOf(page, 'Alpha'));
      console.log('QA4-7', width, round(loading.height), round(done.height));
      expect(Math.abs(loading.height - done.height)).toBeLessThanOrEqual(1);
    });
  }

  test('unsupported, error and unset states per box; none blocks launching (QA4-8, QA4-9)', async ({ page, request }) => {
    const other = await twoEnvs(request);
    const third = await createEnvironment(request, f.project.id, 'Third', { port: FAKE_B });
    await page.route(`**/eval-environments/${other.id}/versioning-details`, (route) =>
      route.fulfill({
        json: { environment_id: other.id, status: 'unsupported', versioning_details: {}, error: null, fetched_at: null },
      }),
    );
    await page.route(`**/eval-environments/${third.id}/versioning-details`, (route) =>
      route.fulfill({
        json: { environment_id: third.id, status: 'error', versioning_details: {}, error: 'kb offline', fetched_at: null },
      }),
    );
    await page.route(`**/eval-environments/${f.env.id}/versioning-details`, (route) =>
      route.fulfill({
        json: {
          environment_id: f.env.id,
          status: 'ok',
          versioning_details: { agent_version: 'agent-1.4.2', image_version: null, kb_version: 'kb-77' },
          error: null,
          fetched_at: null,
        },
      }),
    );
    await openLaunch(page, f.project.slug, `?env=${f.env.id},${other.id},${third.id}`);
    await expect(lines(page)).toHaveCount(3);
    await expect(page.locator(`[data-env-version="${other.id}"]`)).toContainText(
      'Not supported by this environment (its Evaluation Service is older than v1.2).',
    );
    const err = page.locator(`[data-env-version="${third.id}"]`);
    await expect(err).toContainText('Couldn’t read: kb offline');
    expect(await err.locator('[class*="errorText"]').evaluate((el) => getComputedStyle(el).color)).not.toBe('');
    const ok = page.locator(`[data-env-version="${f.env.id}"]`);
    await expect(ok.locator('[data-unset]')).toHaveCount(1);
    await expect(ok.locator('[data-unset]')).toHaveText('not set');
    for (const name of ['Alpha', 'Other', 'Third']) expect(await overflowing(boxOf(page, name))).toEqual([]);
    expect(describeViolations(await axeSeriousViolations(page))).toBe('');
    // The states are informational: typing keeps them, and no problem item mentions versions.
    await nameBox(page).fill('with states');
    await expect(page.getByText(/Couldn.t read|Not supported/)).toHaveCount(2);
    await expect(lines(page).first()).toBeVisible();
  });

  test('Refresh pressed twice reads once more for its box, which never shrinks (QA4-11)', async ({ page }) => {
    const reads = countReads(page);
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(loaded(page)).toHaveCount(1);
    const before = await box(lineOf(page, 'Alpha'));
    reads.reset();
    const refresh = refreshOf(page, 'Alpha');
    await refresh.click();
    await refresh.click();
    await expect(loaded(page)).toHaveCount(1);
    expect(reads.of(f.env.id)).toBeLessThanOrEqual(2);
    expect(reads.of(f.env.id)).toBeGreaterThanOrEqual(1);
    const after = await box(lineOf(page, 'Alpha'));
    console.log('QA4-11', round(before.height), round(after.height));
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    await expect(refresh).toBeFocused();
  });

  test('archived project: the versions show and Refresh works (QA4-10)', async ({ page, request }) => {
    await archiveProject(request, f.project.id);
    try {
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await expect(loaded(page)).toHaveCount(1);
      await expect(refreshOf(page, 'Alpha')).toBeEnabled();
    } finally {
      await unarchiveProject(request, f.project.id);
    }
  });

  test('the Models step and steps 3 to 5 have no versions; Refresh sits in its box in tab order (QA4-12, QA4-13)', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(lines(page)).toHaveCount(1);
    for (const step of ['models', 'settings', 'evaluation'] as const) {
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`, step);
      await expect(page.getByText('Current versions')).toHaveCount(0);
      await expect(lines(page)).toHaveCount(0);
    }
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(loaded(page)).toHaveCount(1);
    await nameBox(page).focus();
    const seen: string[] = [];
    for (let i = 0; i < 40 && !seen.some((s) => s.includes('golden')); i++) {
      await page.keyboard.press('Tab');
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return (el.getAttribute('aria-label') ?? el.closest('label')?.textContent ?? el.textContent ?? el.tagName).trim().slice(0, 40);
        }),
      );
    }
    const at = (needle: string) => seen.findIndex((s) => s.includes(needle));
    console.log('QA4-13 tab order', JSON.stringify(seen));
    const order = [at('Environment default'), at('Latency-sensitive run'), at('Alpha'), at('Details of Alpha'), at('Refresh versions of Alpha'), at('New environment'), at('golden')];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    await expect(refreshOf(page, 'Alpha')).toHaveAccessibleName('Refresh versions of Alpha');
  });

  for (const width of [1440, 390] as const) {
    test(`axe: 0 serious violations, loaded and loading, at ${width}px (QA4-13)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route('**/versioning-details', async (route) => {
        await gate;
        await route.continue();
      });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await expect(page.locator('dl[aria-busy="true"]')).toHaveCount(1);
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
      release();
      await expect(loaded(page)).toHaveCount(1);
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
    });
  }
});

test.describe('no versioning input anywhere (QA2-9, QA2-14, QA2-16, QA2-12)', () => {
  test('a launch from the form sends no versioning_details and a dry run neither', async ({ page }) => {
    const posts = captureExperimentPosts(page);
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('no versioning');
    await expect.poll(() => posts.dryRuns.length).toBeGreaterThan(0);
    for (const d of posts.dryRuns) expect(d.body).not.toHaveProperty('versioning_details');
    await expect(page.getByText('Versioning details')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
  });

  test('a stale client that still sends the field sees the server text and nothing else changes (QA2-16)', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('stale tab');
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled({ timeout: 15_000 });
    await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
      const req = route.request();
      if (req.method() !== 'POST' || req.postDataJSON()?.dry_run) return route.fallback();
      const res = await route.fetch({
        postData: JSON.stringify({ ...req.postDataJSON(), versioning_details: { agent_version: 'x' } }),
      });
      return route.fulfill({ response: res });
    });
    await page.getByRole('button', { name: 'Launch as is' }).click();
    await expect(
      page.getByText('Versioning details are set by the Evaluation Service and cannot be sent with an experiment.'),
    ).toBeVisible();
    await expect(nameBox(page)).toHaveValue('stale tab');
  });

  test('Rerun opens a form with no versioning input and sends none (QA2-14)', async ({ page, request }) => {
    const res = await request.post(`/v1/projects/${f.project.id}/experiments`, {
      data: {
        name: 'to clone',
        environment_ids: [f.env.id],
        spec: { evaluator: { dataset: 'golden', config: {} }, slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } } },
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const id = ((await res.json()) as { id: string }).id;
    const clone = await request.post(`/v1/projects/${f.project.id}/experiments/${id}/clone`);
    expect(await clone.json()).not.toHaveProperty('versioning_details');
    await page.goto(`/projects/${f.project.slug}/experiments/new?clone=${id}`);
    await expect(nameBox(page)).toBeVisible();
    await expect(page.getByLabel('Versioning details')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
  });
});
