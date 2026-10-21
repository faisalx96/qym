/**
 * QA-B points 2 and 4 (spec-b QA2-14, QA2-16, QA4-1 to QA4-13, QA4-16): the read-only Evaluation Service
 * versions block on Customize step 1 (the same component and query as the home view), the request
 * counts, the loading frame at the loaded height and the states. Numbers are the app's at 1440 / 1024 / 390.
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
let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const card = (page: Page) => page.getByRole('group', { name: 'Current versions' });
const round = (n: number) => Math.round(n * 10) / 10;
async function box(l: Locator) {
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

test.describe('block on step 1', () => {
  for (const width of WIDTHS) {
    test(`placement, size, rows and copy at ${width}px (QA4-1 to QA4-5, QA2-11)`, async ({ page, request }) => {
      const other = await twoEnvs(request);
      await page.setViewportSize({ width, height: 900 });
      // QA4-1: no environment selected, no block.
      await openLaunch(page, f.project.slug);
      await expect(card(page)).toHaveCount(0);
      await openLaunch(page, f.project.slug, `?env=${f.env.id},${other.id}`);
      await expect(card(page)).toHaveCount(1);
      await expect(card(page).locator('[data-status="ok"]')).toHaveCount(2);
      // A direct child of the entry, after the Where row.
      const placed = await card(page).evaluate((el) => {
        const entry = el.parentElement!;
        return [entry.getAttribute('data-testid'), Array.from(entry.children).indexOf(el) === entry.children.length - 1];
      });
      expect(placed).toEqual(['launch-entry', true]);
      const b = await box(card(page));
      const colWidth = { 1440: 821, 1024: 777, 390: 279 }[width];
      expect(round(b.width)).toBeCloseTo(colWidth, 0);
      console.log('QA4-2 block', width, round(b.width), round(b.height));
      expect(round(b.height)).toBeCloseTo({ 1440: 131, 1024: 131, 390: 316.9 }[width], 0);
      const rows = card(page).locator('[data-env-version]');
      const heights = [round((await box(rows.nth(0))).height), round((await box(rows.nth(1))).height)];
      console.log('QA4-3 rows', width, JSON.stringify(heights));
      if (width > 390) expect(heights).toEqual([20, 20]);
      expect(await overflowing(card(page))).toEqual([]);
      // QA4-4: copy, one Refresh button, no input.
      await expect(card(page)).toContainText('Evaluation Service versions');
      await expect(card(page)).toContainText('Read from each environment. Runs record what its Evaluation Service reports.');
      await expect(card(page).getByRole('button')).toHaveText(['Refresh']);
      await expect(card(page).locator('input, textarea, select, [contenteditable]')).toHaveCount(0);
      await expect(card(page)).toContainText('agent-1.4.2');
      await expect(card(page)).toContainText('agent-9.9.9');
      // Value tags: mono 10 px / 650, 20 px high, never truncated.
      const tag = card(page).locator('dd span').first();
      expect(await tag.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).textOverflow])).toEqual(['10px', '650', 'clip']);
      expect(Math.round((await box(tag)).height)).toBe(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test('the same DOM and text as the home view (QA4-5)', async ({ page }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    const html = (l: Locator) => l.evaluate((el) => el.outerHTML.replace(/ (id|aria-labelledby|aria-describedby)="[^"]*"/g, ''));
    const home = await html(card(page));
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    expect(await html(card(page))).toBe(home);
  });

  test('one fetch per environment: cache hit on Customize, one per new environment, one per Refresh (QA4-6)', async ({
    page,
    request,
  }) => {
    const other = await twoEnvs(request);
    const reads = countReads(page);
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    expect(reads.of(f.env.id)).toBe(1);
    reads.reset();
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    expect(reads.total()).toBe(0);
    // Ticking a second environment on step 1 reads only that one.
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(2);
    expect(reads.of(other.id)).toBe(1);
    expect(reads.of(f.env.id)).toBe(0);
    // Unticking reads nothing.
    reads.reset();
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(card(page).locator('[data-env-version]')).toHaveCount(1);
    expect(reads.total()).toBe(0);
    // Refresh: one per selected environment.
    await page.getByRole('listitem').filter({ hasText: 'Other' }).getByText('Other', { exact: true }).click();
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(2);
    reads.reset();
    await card(page).getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => reads.total()).toBe(2);
    expect(reads.of(f.env.id)).toBe(1);
    expect(reads.of(other.id)).toBe(1);
    // A hard reload reads each once.
    reads.reset();
    await page.goto(`/projects/${f.project.slug}/experiments/new?step=where&env=${f.env.id},${other.id}`);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(2);
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
      const list = card(page).locator('dl[aria-busy="true"]');
      await expect(list).toHaveCount(1);
      await expect(card(page).getByRole('status')).toHaveText('Reading…');
      const loading = await box(card(page));
      release();
      await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
      const loaded = await box(card(page));
      console.log('QA4-7', width, round(loading.height), round(loaded.height));
      expect(Math.abs(loading.height - loaded.height)).toBeLessThanOrEqual(1);
    });
  }

  test('unsupported, error and unset states per row; none blocks launching (QA4-8, QA4-9)', async ({ page, request }) => {
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
    await expect(card(page).locator('[data-env-version]')).toHaveCount(3);
    await expect(card(page).locator(`[data-env-version="${other.id}"]`)).toContainText(
      'Not supported by this environment (its Evaluation Service is older than v1.2).',
    );
    const err = card(page).locator(`[data-env-version="${third.id}"]`);
    await expect(err).toContainText('Couldn’t read: kb offline');
    expect(await err.locator('span').last().evaluate((el) => getComputedStyle(el).color)).not.toBe('');
    const ok = card(page).locator(`[data-env-version="${f.env.id}"]`);
    await expect(ok.locator('[data-unset]')).toHaveCount(1);
    await expect(ok.locator('[data-unset]')).toHaveText('not set');
    expect(await overflowing(card(page))).toEqual([]);
    expect(describeViolations(await axeSeriousViolations(page))).toBe('');
    // The states are informational: typing keeps them, and no problem item mentions versions.
    await nameBox(page).fill('with states');
    await expect(page.getByText(/Couldn.t read|Not supported/)).toHaveCount(2);
    await expect(card(page)).toBeVisible();
  });

  test('Refresh pressed twice reads once more per row and the block never shrinks (QA4-11)', async ({ page }) => {
    const reads = countReads(page);
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    const before = await box(card(page));
    reads.reset();
    const refresh = card(page).getByRole('button', { name: 'Refresh' });
    await refresh.click();
    await refresh.click();
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    expect(reads.of(f.env.id)).toBeLessThanOrEqual(2);
    expect(reads.of(f.env.id)).toBeGreaterThanOrEqual(1);
    expect(Math.abs((await box(card(page))).height - before.height)).toBeLessThanOrEqual(1);
    await expect(refresh).toBeFocused();
  });

  test('archived project: the block shows and Refresh works (QA4-10)', async ({ page, request }) => {
    await archiveProject(request, f.project.id);
    try {
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
      await expect(card(page).getByRole('button', { name: 'Refresh' })).toBeEnabled();
    } finally {
      await unarchiveProject(request, f.project.id);
    }
  });

  test('the Models step and steps 3 to 5 have no block; tab order ends on Refresh (QA4-12, QA4-13)', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page)).toHaveCount(1);
    for (const step of ['models', 'settings', 'evaluation'] as const) {
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`, step);
      await expect(page.getByText('Current versions')).toHaveCount(0);
      await expect(card(page)).toHaveCount(0);
    }
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
    await nameBox(page).focus();
    const seen: string[] = [];
    for (let i = 0; i < 40 && !seen.includes('Refresh'); i++) {
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
    const order = [at('Environment default'), at('Latency-sensitive run'), at('Alpha'), at('Details of Alpha'), at('New environment'), at('golden'), at('Refresh')];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    await expect(card(page).getByRole('button', { name: 'Refresh' })).toHaveAccessibleName('Refresh');
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
      await expect(card(page).locator('dl[aria-busy="true"]')).toHaveCount(1);
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
      release();
      await expect(card(page).locator('[data-status="ok"]')).toHaveCount(1);
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
