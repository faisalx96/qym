import { test, expect } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { ageRunner, pageApi, seedPerformance } from './support';

test('the Runner page shows the fake runner connected, then silent', async ({ page, request }) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-runner'));
  const accepted = await seed.runner.events([
    {
      at: new Date().toISOString(),
      level: 'warning',
      code: 'qym_unreachable',
      message: 'QA - qym did not answer for 12 seconds',
      details: { seconds: 12 },
      run_id: null,
    },
  ]);
  expect(accepted.accepted).toBe(1);

  await gotoApp(page, `/projects/${seed.projectSlug}/performance/runner`);
  const status = page.locator('[data-performance-block="runner-status"]');
  await expect(status.getByText('Connected', { exact: true })).toBeVisible();
  await expect(status.getByText('QA - Runner', { exact: true })).toBeVisible();
  await expect(status.getByText('QA lab', { exact: true })).toBeVisible();
  await expect(page.getByTestId('performance-runner-notice')).toHaveCount(0);
  const key = page.locator('[data-performance-block="runner-key"]');
  await expect(key.getByRole('button', { name: /QA - Runner key/ })).toBeVisible();
  const events = page.locator('[data-performance-block="runner-events"]');
  await expect(events.getByText('QA - qym did not answer for 12 seconds')).toBeVisible();

  // Sixty seconds without a heartbeat: past the 30 s the runner counts as connected, so the notice shows from here
  // (coordinator's decision, lanes/E.md 7.1); a run in progress is not ended yet.
  ageRunner(seed.projectId, 60);
  await page.reload();
  await expect(status.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('performance-runner-notice')).toContainText('Not reporting.');
  await expect(page.getByTestId('performance-runner-notice')).toContainText('If the silence reaches 2m');
  // Another ninety: past the 120 s after which a run would be ended. The page says so.
  ageRunner(seed.projectId, 90);
  await page.reload();
  await expect(status.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('performance-runner-notice')).toContainText('Not reporting.');

  // The next heartbeat brings it back.
  await seed.runner.heartbeat();
  await page.reload();
  await expect(status.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('performance-runner-notice')).toHaveCount(0);
});

test('a Manager chooses another runner key; the runner on the old key no longer gets tokens', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-runner-key'));
  const second = (await (
    await request.post(`/v1/projects/${seed.projectId}/api-keys`, { data: { name: 'QA - Second key' } })
  ).json()) as { id: string; prefix: string };

  await gotoApp(page, `/projects/${seed.projectSlug}/performance/runner`);
  const card = page.locator('[data-performance-block="runner-key"]');
  await expect(card.getByText('The runner uses this key')).toBeVisible();
  await card.getByRole('button', { name: /QA - Runner key/ }).click();
  await page.getByRole('option', { name: `QA - Second key · ${second.prefix}` }).click();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('The runner uses another key')).toBeVisible();

  const again = await seed.runner.register();
  expect(again.tokens_disclosed).toBe(false);
  // qym refuses a start while the connected runner uses another key, and the New run page says so.
  const setup = (await (await request.get(pageApi(seed.projectSlug, '/setup'))).json()) as {
    defaults: { breakpoint: { plan: unknown; mix: unknown } };
  };
  const refused = await request.post(pageApi(seed.projectSlug, '/runs'), {
    data: {
      target_id: seed.preprod.id,
      dataset_version_id: seed.dataset.versionId,
      test_type: 'breakpoint',
      ...setup.defaults.breakpoint,
    },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain('runner_key_mismatch');
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
  await page
    .getByRole('radiogroup', { name: 'Target' })
    .getByRole('radio', { name: /QA - Preprod/ })
    .click({ force: true });
  await page.getByRole('navigation', { name: 'New run steps' }).getByText('Review and start').click();
  await expect(
    page.locator('[data-performance-block="step-bar"]').getByRole('button', { name: 'Start run' }),
  ).toBeDisabled();
  await expect(page.locator('[data-performance-block="checks"]').first()).toContainText(/another API key/i);
});
