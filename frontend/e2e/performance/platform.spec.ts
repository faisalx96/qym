/** Existing dev frontend only: real platform components in the registered fixture shell. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const story = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./fixtures/platform-story.json', import.meta.url)), 'utf8'),
);
type PlatformFixtureState = 'discovery' | 'running' | 'finished';
const platformSetup = story.setup;
const platformRunRead = (state: string) => structuredClone(story.reads[state]);
function platformFixtureRead(sub: string) {
  if (sub === '/setup') return story.setup;
  if (sub === '/targets')
    return {
      targets: [story.target],
      can_manage: true,
      encryption_ready: true,
      platform_limits: { max_users: 200, max_duration_s: 28800 },
    };
  if (sub.endsWith('/events')) return story.events;
  if (sub.endsWith('/log')) return story.log;
  if (sub === '/runs') return story.home.runs;
  return story.home;
}

const mock = (state: string) => `/__mock/performance/platform-${state}`;

test('finished platform breakpoint keeps coverage beside the result and exposes dashboard detail', async ({
  page,
}) => {
  await page.goto(mock('finished'));
  await expect(page.getByRole('heading', { name: 'Run 24', exact: true })).toBeVisible();
  await expect(page.getByText('Breaks at 8 users (dashboard-open time)', { exact: true })).toBeVisible();
  await expect(page.getByText('Coverage incomplete.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Questions' })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Dashboards/ }).click();
  await expect(page.getByRole('treegrid', { name: 'Dashboards', exact: true })).toContainText(
    'التجارة الخارجية',
  );
  await page.getByText('التجارة الخارجية', { exact: true }).click();
  await expect(page.getByRole('grid', { name: 'Dashboard steps' })).toContainText('Failed request');
  await expect(page.getByRole('grid', { name: 'Dashboard steps' })).toContainText('Control: year');
  await expect(page.getByRole('grid', { name: 'Dashboard steps' })).not.toContainText('2026');
});

test('live progress has no final verdict or fabricated live request error rate', async ({ page }) => {
  await page.goto(mock('running'));
  await expect(page.getByRole('heading', { name: 'Run 25', exact: true })).toBeVisible();
  await expect(page.getByText('Results are not final yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('Open p95 so far', { exact: true })).toBeVisible();
  await expect(page.getByText(/Breaks at 8 users/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
});

test('waiting sign-in keeps the clock running and sends only the cookie handoff', async ({ page }) => {
  const handoffs: unknown[] = [];
  await page.route('**/api/projects/demo/performance/runs/*/tokens', async (route) => {
    handoffs.push(route.request().postDataJSON());
    await route.fulfill({
      json: { name: 'session_cookie', hint: '2 cookies, saved 2026-11-25T16:24:00Z', version: 2 },
    });
  });
  await page.goto(mock('waiting'));
  await expect(page.getByText(/The test clock continues while sign-in is replaced/)).toBeVisible();
  await page.getByRole('button', { name: 'Save a new sign-in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Cookie header/).fill('session=fictional-cookie; refresh=fictional-refresh');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(handoffs).toEqual([
    {
      name: 'session_cookie',
      token: 'session=fictional-cookie; refresh=fictional-refresh',
      expires_at: null,
    },
  ]);
  await expect(page.getByText('fictional-cookie', { exact: false })).toHaveCount(0);
});

test('report downloads send the platform read opt-in', async ({ page }) => {
  let header: string | undefined;
  await page.route('**/api/projects/demo/performance/runs/*/report', async (route) => {
    header = route.request().headers()['x-qym-performance-platform'];
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Disposition': 'attachment; filename="performance-run-24.html"' },
      body: '<!doctype html><title>Fictional platform report</title>',
    });
  });
  await page.goto(mock('finished'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('performance-run-24.html');
  expect(header).toBe('1');
});

for (const [state, number, text] of [
  ['smoke', 23, 'Passed'],
  ['discovery', 27, 'Finding dashboards'],
  ['failed', 28, 'No dashboard'],
  ['stopped', 29, 'Stopped'],
  ['interrupted', 30, 'Interrupted'],
] as const) {
  test(`platform ${state} renders its own lifecycle`, async ({ page }) => {
    await page.goto(mock(state));
    await expect(page.getByRole('heading', { name: `Run ${number}`, exact: true })).toBeVisible();
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Questions' })).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`platform composed page at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(mock('finished'));
    await expect(page.getByRole('heading', { name: 'Run 24', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`platform-finished-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('starts Smoke and polls the same run through discovery, load and its final result', async ({ page }) => {
  const project = {
    id: 'platform-demo',
    name: 'QA - Performance',
    slug: 'demo',
    is_active: true,
    member_count: 3,
    run_count: 1,
    role: 'MANAGER',
    created_at: '2026-11-25T15:00:00Z',
    updated_at: '2026-11-25T15:00:00Z',
    correction_approvers: 'members',
    correction_require_different_reviewer: true,
  };
  await page.route('**/v1/me', (route) =>
    route.fulfill({
      json: {
        id: 'user-demo',
        email: 'demo@example.test',
        display_name: 'Demo Operator',
        role: 'ADMIN',
        auth_type: 'none',
        needs_admin_bootstrap: false,
        can_bootstrap_admin: false,
        projects: [project],
        default_project: project,
      },
    }),
  );
  await page.route('**/v1/projects/by-slug/demo', (route) => route.fulfill({ json: project }));
  let phase: PlatformFixtureState = 'discovery';
  let started: Record<string, unknown> | undefined;
  const optIns: (string | undefined)[] = [];
  const id = 'platform-lifecycle';
  await page.route('**/api/projects/demo/performance{,/**}', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const sub = url.pathname.replace('/api/projects/demo/performance', '');
    if (request.method() === 'POST' && sub === '/runs') {
      started = request.postDataJSON();
      await route.fulfill({
        status: 201,
        json: {
          id,
          number: 42,
          status: 'queued',
          requested_at: '2026-11-25T16:00:00Z',
          plan: { ...platformSetup.platform.defaults.smoke, timeout_seconds: 60 },
        },
      });
      return;
    }
    optIns.push(request.headers()['x-qym-performance-platform']);
    if (sub === `/runs/${id}`) {
      const read = platformRunRead(phase === 'finished' ? 'smoke' : phase);
      const smoke = platformRunRead('smoke');
      read.run.id = id;
      read.run.number = 42;
      read.run.test_type = 'smoke';
      read.run.max_users = 1;
      read.config = smoke.config;
      if (read.discovery) read.discovery.resolved_plan = smoke.discovery!.resolved_plan;
      if (read.progress) {
        read.progress.users_max = 1;
        if (phase === 'running') {
          read.progress.phase = 'steady';
          read.progress.stage = null;
          read.progress.level = 1;
          read.progress.users = 1;
          read.progress.message = 'Opening every runnable dashboard once';
          read.progress.levels = [read.progress.levels[0]!];
        }
      }
      if (read.summary) read.summary.identity = { ...read.summary.identity, run_id: id, run_number: 42 };
      await route.fulfill({ json: read });
      return;
    }
    await route.fulfill({ json: platformFixtureRead(sub) });
  });
  await page.goto('/projects/demo/performance/new?target=platform');
  await page.getByRole('button', { name: 'Continue to Test' }).click();
  await page
    .getByRole('radiogroup', { name: 'Test', exact: true })
    .getByText('Smoke', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Skip to review and start' }).click();
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/performance/runs/${id}$`));
  await expect(page.getByRole('heading', { name: 'Run 42', exact: true })).toBeVisible();
  await expect(page.getByText('Preparing the test', { exact: true })).toBeVisible();
  expect(started).toMatchObject({
    target_id: 'platform',
    target_kind: 'estishraf_platform',
    test_type: 'smoke',
    plan: { users: 1, pick: 'roundrobin', max_dashboards: null },
  });
  expect(started).not.toHaveProperty('dataset_version_id');
  expect(started).not.toHaveProperty('mix');
  phase = 'running';
  await expect(page.getByText(/Opening every runnable dashboard once/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Open p95 so far', { exact: true })).toBeVisible();
  phase = 'finished';
  await expect(page.getByText('Passed', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Smoke coverage', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);
  expect(optIns.length).toBeGreaterThanOrEqual(4);
  expect(optIns.every((value) => value === '1')).toBe(true);
});

for (const width of [1440, 390]) {
  test(`adds a platform target and saves its cookie at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: { path: string; body: unknown }[] = [];
    await page.route('**/api/projects/demo/performance/targets{,/**}', async (route) => {
      writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
      await route.fulfill({
        json: route.request().url().endsWith('/session_cookie')
          ? { name: 'session_cookie', hint: '2 cookies, saved now', version: 1, expired: false }
          : { ...story.target, id: 'new-platform', name: 'Fictional platform' },
      });
    });
    await page.goto(mock('targets'));
    await page.getByRole('button', { name: 'Add target', exact: true }).click();
    await page.getByRole('dialog').getByText('Estishraf platform', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^Address/)).toHaveValue('');
    await dialog.getByLabel(/^Name/).fill('Fictional platform');
    await dialog.getByLabel(/^Address/).fill('https://platform.example.test');
    await dialog.getByLabel(/^Cookie header/).fill('session=fictional-cookie; refresh=fictional-refresh');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
      1,
    );
    await page.screenshot({
      path: testInfo.outputPath(`platform-target-dialog-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Save target', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.body).toMatchObject({
      kind: 'estishraf_platform',
      base_url: 'https://platform.example.test',
    });
    expect(writes[0]?.body).not.toHaveProperty('chat_path');
    expect(writes[1]).toMatchObject({
      path: '/api/projects/demo/performance/targets/new-platform/tokens/session_cookie',
      body: { token: 'session=fictional-cookie; refresh=fictional-refresh', expires_at: null },
    });
    await expect(page.getByText('fictional-cookie', { exact: false })).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`both target kinds keep Advanced inside the dialog at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(mock('targets'));
    for (const kind of ['Insightor chat', 'Estishraf platform']) {
      await page.getByRole('button', { name: 'Add target', exact: true }).click();
      await page.getByRole('dialog').getByText(kind, { exact: true }).click();
      const dialog = page.getByRole('dialog');
      const advanced = dialog.getByRole('button', { name: 'Advanced' });
      await expect(advanced).toHaveAttribute('aria-expanded', 'false');
      await advanced.click();
      const last = dialog.getByRole('textbox', { name: 'Longest run, minutes' });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeVisible();
      expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(await advanced.evaluate((el) => getComputedStyle(el).alignItems)).toBe('center');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  });
}
