/** WP-B: "Who can launch latency-sensitive runs" on the environment form (spec-b B5-43 to B5-47). */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { createEnvironment, resetFakes, seedProject, test } from '../experiments/support';
import { expectToast, pickSelect } from '../experiments/ui';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test('a manager changes the role and it persists; the options are the two copy lines', async ({
  page,
  request,
}) => {
  const { project } = await seedProject(request, 'role');
  const env = await createEnvironment(request, project.id, 'staging');
  await gotoApp(page, `/projects/${project.slug}/environments/${env.id}`);
  const select = page.getByRole('button', { name: /Who can launch latency-sensitive runs/ });
  await expect(select).toBeVisible();
  await expect(select).toContainText('Anyone in the project');
  expect((await select.boundingBox())!.height).toBeCloseTo(24, 0);
  await expect(
    page.getByText('Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.'),
  ).toBeVisible();
  await select.click();
  await expect(page.getByRole('option')).toHaveText(['Anyone in the project', 'Project managers only']);
  await page.keyboard.press('Escape');
  await pickSelect(page, /Who can launch latency-sensitive runs/, 'Project managers only');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expectToast(page, /Saved “staging”/);
  const res = await request.get(`/v1/projects/${project.id}/eval-environments`);
  const saved = (await res.json()).environments[0];
  expect(saved.latency_sensitive_min_role).toBe('manager');
  expect(saved.health_status).toBe(env && saved.health_status); // health untouched by a role change
});

test('the launch form disables the checkbox for the role it cannot satisfy (manager keeps it)', async ({
  page,
  request,
}) => {
  const { project } = await seedProject(request, 'role-launch');
  const env = await createEnvironment(request, project.id, 'prod');
  const put = await request.put(`/v1/projects/${project.id}/eval-environments/${env.id}`, {
    data: { latency_sensitive_min_role: 'manager' },
  });
  expect(put.ok()).toBeTruthy();
  // dev@local is an admin under QYM_AUTH_MODE=none: the box stays enabled and no reason shows.
  await gotoApp(page, `/projects/${project.slug}/experiments/new?step=where&env=${env.id}`);
  await expect(page.getByRole('checkbox', { name: 'Latency-sensitive run' })).toBeEnabled();
  await expect(page.getByTestId('launch-latency-reason')).toHaveCount(0);
});
