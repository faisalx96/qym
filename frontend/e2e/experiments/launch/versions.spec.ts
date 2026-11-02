/**
 * Evaluation Service versions live inside each ticked environment's box, on the home view and on
 * Customize step 1 (read only): what a run started now would record, with a Refresh per environment;
 * the review recaps them. The QA-B specs are qa-b-versions.spec.ts.
 */
import { expect, type Page } from '@playwright/test';
import {
  createEnvironment,
  expectNoPageOverflow,
  FAKE_A,
  FAKE_B,
  resetFakes,
  setFakeVersioning,
  test,
} from '../support';
import {
  goStep,
  nameBox,
  openHome,
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

const lines = (page: Page) => page.locator('[data-env-version]');
const lineOf = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ hasText: name }).locator('[data-env-version]');

test.describe('versions on the home view', () => {
  test('ticking an environment shows its versions in its box; Refresh re-reads them; nothing to decide', async ({
    page,
    request,
  }) => {
    await openHome(page, f.project.slug);
    await expect(lines(page)).toHaveCount(0);
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
    await expect(lineOf(page, 'Alpha')).toContainText('img-20261001');
    await expect(lineOf(page, 'Alpha')).toContainText('kb-77');
    // The three-action path is unchanged: name, Launch as is.
    await nameBox(page).fill('versions run');
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled({ timeout: 15_000 });
    await setFakeVersioning(request, FAKE_A, {
      agent_version: 'agent-2.0.0',
      image_version: 'img-20261101',
      kb_version: 'kb-80',
    });
    await lineOf(page, 'Alpha').getByRole('button', { name: 'Refresh versions of Alpha' }).click();
    await expect(lineOf(page, 'Alpha')).toContainText('agent-2.0.0');
    // Unticking removes the line from the box.
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await expect(lines(page)).toHaveCount(0);
  });

  test('several ticked environments each show their own versions in their own box', async ({ page, request }) => {
    const other = await createEnvironment(request, f.project.id, 'Other', { port: FAKE_B });
    await setFakeVersioning(request, FAKE_B, {
      agent_version: 'agent-9.9.9',
      image_version: 'img-b',
      kb_version: 'kb-b',
    });
    await openHome(page, f.project.slug, `?env=${f.env.id},${other.id}`);
    await expect(lines(page)).toHaveCount(2);
    await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
    await expect(lineOf(page, 'Other')).toContainText('agent-9.9.9');
    await expect(lineOf(page, 'Alpha')).not.toContainText('agent-9.9.9');
  });

  test('no "Add versioning details" button; the Models step has no versions; the review recaps them', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(lineOf(page, 'Alpha').getByRole('button')).toHaveText(['Refresh']);
    await expect(page.getByText('Add versioning details')).toHaveCount(0);
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(page.getByLabel('Versioning details')).toHaveCount(0);
    await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
    await goStep(page, 'models');
    await expect(lines(page)).toHaveCount(0);
    await expect(page.getByText('Current versions')).toHaveCount(0);
    await expect(review(page)).toContainText('Versions');
    await expect(review(page)).toContainText('agent-1.4.2');
  });

  test('a deep link to the wizard recaps the versions without the home view', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'review');
    await expect(review(page)).toContainText('agent-1.4.2', { timeout: 15_000 });
  });

  test('390px: the box fits and stays readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(lineOf(page, 'Alpha')).toContainText('agent-1.4.2');
    await expectNoPageOverflow(page);
  });
});
