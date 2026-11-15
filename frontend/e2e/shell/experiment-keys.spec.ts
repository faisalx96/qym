/** Evaluation Service keys sit in a closed group under the project's own API keys (never in the main table). */
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

test('the key minted for an experiment is in the closed group, not in the main table', async ({
  page,
  request,
}) => {
  const { project, connectionId } = await seedProject(request, 'keygrp');
  const env = await createEnvironment(request, project.id, 'staging', { port: FAKE_A });
  const exp = await launchExperiment(request, project.id, {
    name: 'timeout sweep',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
  });
  const own = await request.post(`/v1/projects/${project.id}/api-keys`, { data: { name: 'CI pipeline' } });
  expect(own.ok()).toBeTruthy();

  await gotoApp(page, `/projects/${project.slug}/settings?tab=apikeys`);
  const card = page.locator('[data-api-keys]');
  const main = card.getByRole('grid', { name: 'API keys' });
  await expect(main.getByText('CI pipeline')).toBeVisible();
  await expect(main.getByText('timeout sweep')).toHaveCount(0);

  const group = card.getByRole('button', { name: /Evaluation Service keys/ });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(group).toContainText('1 · issued at launch, revoked when the experiment settles');
  await expect(card.getByText('Evaluation Service · timeout sweep')).toBeHidden();

  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const row = card
    .getByRole('grid', { name: 'Evaluation Service keys' })
    .getByRole('row')
    .filter({ hasText: 'Evaluation Service · timeout sweep' });
  await expect(row).toBeVisible();
  const link = row.getByTestId('key-experiment-link');
  await expect(link).toHaveText('timeout sweep');
  await expect(link).toHaveAttribute('href', new RegExp(`/experiments/${exp.id}$`));
  await expect(main.getByText('Evaluation Service · timeout sweep')).toHaveCount(0);
  await expect(card.getByText(/qym_[A-Za-z0-9_-]{24,}/)).toHaveCount(0);
});
