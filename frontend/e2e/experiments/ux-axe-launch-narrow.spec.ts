/** UX review D: the mobile launch bar's "Fix N problems first" link meets AA contrast at 768. */
import { expect } from '@playwright/test';
import { test, axeSeriousViolations, describeViolations, seedProject, createEnvironment } from './support';

test('launch bar problem link has enough contrast', async ({ page, request }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const { project } = await seedProject(request, 'uxaxe');
  await createEnvironment(request, project.id, 'staging');
  await page.goto(`/projects/${project.slug}/experiments/new?step=where`);
  const link = page.getByRole('button', { name: /Fix \d+ problems? first/ });
  await expect(link).toBeVisible();
  await page.waitForTimeout(450);
  const v = await axeSeriousViolations(page);
  expect(v, describeViolations(v)).toEqual([]);
});
