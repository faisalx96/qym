/** WP-B: experiment tokens in Project Settings, API keys, Dataset read tokens (spec-b B4-39 to B4-46). */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  createEnvironment,
  experimentSpec,
  launchExperiment,
  resetFakes,
  seedProject,
  test,
} from '../experiments/support';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test('an experiment token lists with its kind, links to the experiment and revokes with its own text', async ({
  page,
  request,
}) => {
  const { project, connectionId } = await seedProject(request, 'tok');
  const env = await createEnvironment(request, project.id, 'staging', { port: FAKE_A });
  const exp = await launchExperiment(request, project.id, {
    name: 'timeout sweep',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
  });
  const admin = await request.post(`/v1/projects/${project.id}/dataset-read-tokens`, { data: { name: 'Eval service' } });
  expect(admin.ok()).toBeTruthy();

  await gotoApp(page, `/projects/${project.slug}/settings?tab=apikeys`);
  const card = page.locator('[data-read-tokens]');
  await expect(card).toContainText(
    'Experiment tokens are issued at launch and revoked when the experiment settles.',
  );
  const rows = card.getByRole('row');
  const experimentRow = rows.filter({ hasText: 'Evaluation Service · timeout sweep' });
  await expect(experimentRow.getByTestId('token-kind-chip')).toHaveText('experiment');
  const link = experimentRow.getByTestId('token-experiment-link');
  await expect(link).toHaveText('Experiment · timeout sweep');
  await expect(link).toHaveAttribute('href', new RegExp(`/experiments/${exp.id}$`));
  const adminRow = rows.filter({ hasText: 'Eval service' });
  await expect(adminRow.getByTestId('token-kind-chip')).toHaveCount(0);
  await expect(card.getByText(/qym_dr_[A-Za-z0-9_-]{20,}/)).toHaveCount(0);

  await experimentRow.getByRole('button', { name: /Revoke Evaluation Service · timeout sweep/ }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
  await expect(dialog).toContainText('Revoke “Evaluation Service · timeout sweep”?');
  await expect(dialog).toContainText(
    'Jobs of this experiment that have not read their dataset yet will fail until you retry them; the retry issues a new token.',
  );
  await dialog.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('Token revoked').first()).toBeVisible();
  await expect(experimentRow).toContainText('revoked');
});
