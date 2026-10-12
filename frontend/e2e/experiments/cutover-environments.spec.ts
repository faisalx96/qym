/**
 * Cutover: environment behaviours the vanilla pytest suite protected
 * (test_eval_environments_ui.py, test_official_defaults_editor.py) that no other spec asserts:
 * the HIGH max-priority warning, and the default preset / saved presets sections of the page.
 */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  createEnvironment,
  experimentSpec,
  publishDefaultPreset,
  resetFakes,
  saveSavedPreset,
  seedProject,
  test,
} from './support';
import { pickSelect } from './ui';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

const envPath = (slug: string, id: string) => `/projects/${slug}/environments/${id}`;

test('choosing HIGH as the max priority shows the preemption warning for this environment', async ({
  page,
  request,
}) => {
  const { project } = await seedProject(request, 'envhighwarn');
  const env = await createEnvironment(request, project.id, 'staging', { maxPriority: 'NORMAL' });
  await gotoApp(page, envPath(project.slug, env.id));
  const warning = page.getByText(
    'Launching at HIGH cancels every running LOW/NORMAL job on staging for all users.',
  );
  await expect(warning).toHaveCount(0);
  await pickSelect(page, 'Max priority', 'HIGH');
  await expect(warning).toBeVisible();
  await pickSelect(page, 'Max priority', 'LOW');
  await expect(warning).toHaveCount(0);
});

test('the page shows the default preset with its version history and the saved presets', async ({
  page,
  request,
}) => {
  const { project, connectionId } = await seedProject(request, 'envpresets');
  const env = await createEnvironment(request, project.id, 'staging');
  await publishDefaultPreset(request, project.id, env.id, experimentSpec(connectionId, 60));
  await saveSavedPreset(request, project.id, env.id, 'Slow timeout', experimentSpec(connectionId, 120));
  await gotoApp(page, envPath(project.slug, env.id));

  const official = page.locator('[data-section="env-default-preset"]');
  await expect(official).toContainText('v1');
  await expect(official).toContainText('Release notes');
  await expect(official).toContainText('Initial default');
  await expect(official.getByText('Version history')).toBeVisible();

  const saved = page.getByRole('grid', { name: 'Saved presets' });
  const row = saved.getByRole('row').filter({ hasText: 'Slow timeout' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('v1');
  await expect(row.getByRole('button', { name: 'Open Slow timeout in the launch form' })).toBeVisible();
  await row.getByRole('button', { name: 'Open Slow timeout in the launch form' }).click();
  await expect(page).toHaveURL(new RegExp(`/experiments/new\\?.*base=saved.*`));
});
