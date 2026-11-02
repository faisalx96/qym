/* eslint-disable @typescript-eslint/no-explicit-any -- request/response bodies are untyped JSON here */
/**
 * Brief 06 §2.6 launch: real launch, HIGH confirmation, preemption confirm-and-resend, server 422
 * errors, the unsaved-changes guard, the dry-run debounce and keyboard-only completion.
 */
import { expect } from '@playwright/test';
import { getExperiment, resetFakes, test, fakeJobs } from '../support';
import { pickSelect } from '../ui';
import {
  captureConsole,
  captureExperimentPosts,
  dialog,
  expectReady,
  launchButton,
  maxAttempts,
  nameBox,
  openLaunch,
  review,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const EXPERIMENT_URL = /\/experiments\/[0-9a-f-]{36}$/;

test('Launch navigates to the experiment detail, the experiment exists, no guard prompt appears', async ({
  page,
  request,
}) => {
  const posts = captureExperimentPosts(page);
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link', { name: 'Experiments' })).toBeVisible();
  await expect(trail.getByText('New experiment')).toHaveAttribute('aria-current', 'page');
  await nameBox(page).fill('first launch');
  const field = await maxAttempts(page);
  await field.fill('3');
  await expectReady(page);
  await launchButton(page).click();
  await expect(page).toHaveURL(EXPERIMENT_URL);
  await expect(dialog(page).filter({ hasText: 'Leave without launching?' })).toHaveCount(0);
  await expect(page.getByText('first launch').first()).toBeVisible();
  const id = page.url().split('/').pop()!;
  const exp = await getExperiment(request, f.project.id, id);
  expect(exp.name).toBe('first launch');
  expect(exp.jobs).toHaveLength(1);
  const sent = posts.launches.at(-1)!.body;
  expect(sent.environment_ids).toEqual([f.env.id]);
  expect(sent.spec.env_overrides.LLM_OVERRIDES.endpoints.primary.max_attempts).toBe(3);
  await expect.poll(async () => (await fakeJobs(request)).length).toBe(1);
});

test('HIGH priority asks for confirmation first and sends acknowledge_preemption', async ({
  page,
  request,
}) => {
  const posts = captureExperimentPosts(page);
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('high run');
  await pickSelect(page, /Priority/, /^HIGH/);
  await expectReady(page);
  await launchButton(page).click();
  const d = dialog(page);
  await expect(d).toContainText('Launch at HIGH priority?');
  await d.getByRole('button', { name: 'Do not launch' }).click();
  await expect(page).not.toHaveURL(EXPERIMENT_URL);
  expect(posts.launches).toHaveLength(0);

  await launchButton(page).click();
  await dialog(page).getByRole('button', { name: 'Launch at HIGH' }).click();
  await expect(page).toHaveURL(EXPERIMENT_URL);
  expect(posts.launches.at(-1)!.body.priority).toBe('HIGH');
  expect(posts.launches.at(-1)!.body.acknowledge_preemption).toBe(true);
  const exp = await getExperiment(request, f.project.id, page.url().split('/').pop()!);
  expect(exp.name).toBe('high run');
});

test('a server preemption_acknowledgement_required answer is confirmed and resent', async ({ page }) => {
  let answered = false;
  const sentBodies: any[] = [];
  await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = req.postDataJSON();
    if (body.dry_run) return route.continue();
    sentBodies.push(body);
    if (!answered) {
      answered = true;
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            code: 'preemption_acknowledgement_required',
            message: 'A HIGH job is active on Alpha. Send acknowledge_preemption: true to launch.',
          },
        }),
      });
    }
    return route.continue();
  });
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('preempt run');
  await expectReady(page);
  await launchButton(page).click();
  const d = dialog(page);
  await expect(d).toContainText('Launch at HIGH priority?');
  await expect(d).toContainText('A HIGH job is active on Alpha');
  await d.getByRole('button', { name: 'Launch at HIGH' }).click();
  await expect(page).toHaveURL(EXPERIMENT_URL);
  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[0].acknowledge_preemption).toBeFalsy();
  expect(sentBodies[1].acknowledge_preemption).toBe(true);
});

test('server 422 validation errors are listed, toasted and the first one is focused', async ({ page }) => {
  let blocked = true;
  await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || req.postDataJSON().dry_run || !blocked) return route.continue();
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          errors: [{ pointer: '/evaluator/config/samples', message: 'samples is too large for Alpha' }],
        },
      }),
    });
  });
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('bad run');
  await expectReady(page);
  await launchButton(page).click();
  await expect(page.getByText('1 problem to fix before launching')).toBeVisible();
  await expect(review(page)).toContainText('samples is too large for Alpha');
  await expect(page.getByRole('textbox', { name: 'Samples' })).toBeFocused();
  await expect(launchButton(page)).toBeDisabled();
  // Editing the form clears the stale server error.
  blocked = false;
  await page.getByRole('textbox', { name: 'Samples' }).fill('3');
  await expectReady(page);
  await expect(launchButton(page)).toBeEnabled();
});

test('unsaved changes: leaving asks first; Keep editing stays, Leave goes', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('draft');
  await page.getByRole('link', { name: 'All experiments' }).click();
  const d = dialog(page);
  await expect(d).toContainText('Leave without launching?');
  await d.getByRole('button', { name: 'Keep editing' }).click();
  await expect(nameBox(page)).toHaveValue('draft');
  await page.getByRole('link', { name: 'All experiments' }).click();
  await dialog(page).getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.project.slug}/experiments(\\?.*)?$`));
});

test('an untouched form leaves without a prompt', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await page.getByRole('link', { name: 'All experiments' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${f.project.slug}/experiments(\\?.*)?$`));
});

test('typing quickly sends at most one dry run per 600 ms window', async ({ page }) => {
  const posts = captureExperimentPosts(page);
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('debounce');
  await expectReady(page);
  const field = await maxAttempts(page);
  const before = posts.dryRuns.length;
  await field.pressSequentially('12345', { delay: 70 });
  await expect(review(page).getByText('Ready to launch')).toBeVisible();
  await page.waitForTimeout(900);
  const fresh = posts.dryRuns.slice(before);
  expect(fresh.length, 'dry runs after 5 quick keystrokes').toBe(1);
  expect(fresh[0]!.body.spec.env_overrides.LLM_OVERRIDES.endpoints.primary.max_attempts).toBe(12345);
  // Over the whole session no two dry runs are closer than the debounce window (aborted ones aside).
  for (let i = 1; i < posts.dryRuns.length; i++) {
    expect(posts.dryRuns[i]!.at - posts.dryRuns[i - 1]!.at).toBeGreaterThanOrEqual(100);
  }
});

test('keyboard only: pick the environment, name the run, launch', async ({ page, request }) => {
  const logs = captureConsole(page);
  await openLaunch(page, f.project.slug);
  const alpha = page.getByRole('checkbox', { name: 'Alpha' });
  await alpha.focus();
  await page.keyboard.press('Space');
  await expect(alpha).toBeChecked();
  await nameBox(page).focus();
  await page.keyboard.type('keyboard run');
  await expectReady(page);
  await launchButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(EXPERIMENT_URL);
  const exp = await getExperiment(request, f.project.id, page.url().split('/').pop()!);
  expect(exp.name).toBe('keyboard run');
  expect(
    logs.filter((l) => /^(error|pageerror)/.test(l)),
    'console errors',
  ).toEqual([]);
});
