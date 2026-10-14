/**
 * Evaluation Service versions live on the home view (moved from the Models step): what a run started
 * now would record, per selected environment, with Refresh; the wizard only recaps them in the review.
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

const card = (page: Page) => page.getByRole('group', { name: 'Current versions' });

test.describe('versions on the home view', () => {
  test('ticking an environment shows its versions; Refresh re-reads them; nothing to decide', async ({
    page,
    request,
  }) => {
    await openHome(page, f.project.slug);
    await expect(card(page)).toHaveCount(0);
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await expect(card(page)).toContainText('agent-1.4.2');
    await expect(card(page)).toContainText('img-20261001');
    await expect(card(page)).toContainText('kb-77');
    // The three-action path is unchanged: name, Launch as is.
    await nameBox(page).fill('versions run');
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled({ timeout: 15_000 });
    await setFakeVersioning(request, FAKE_A, {
      agent_version: 'agent-2.0.0',
      image_version: 'img-20261101',
      kb_version: 'kb-80',
    });
    await card(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(card(page)).toContainText('agent-2.0.0');
  });

  test('several environments each get a row with their own versions', async ({ page, request }) => {
    const other = await createEnvironment(request, f.project.id, 'Other', { port: FAKE_B });
    await setFakeVersioning(request, FAKE_B, {
      agent_version: 'agent-9.9.9',
      image_version: 'img-b',
      kb_version: 'kb-b',
    });
    await openHome(page, f.project.slug, `?env=${f.env.id},${other.id}`);
    const rows = card(page).locator('[data-env-version]');
    await expect(rows).toHaveCount(2);
    await expect(card(page)).toContainText('agent-1.4.2');
    await expect(card(page)).toContainText('agent-9.9.9');
  });

  test('"Add versioning details" opens step 1; the Models step has no versions block; the review recaps them', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await card(page).getByRole('button', { name: 'Add versioning details' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(page.getByLabel('Versioning details')).toBeVisible();
    await goStep(page, 'models');
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByText('Current versions')).toHaveCount(0);
    await expect(review(page)).toContainText('Versions');
    await expect(review(page)).toContainText('agent-1.4.2');
  });

  test('a deep link to the wizard recaps the versions without the home view', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'review');
    await expect(review(page)).toContainText('agent-1.4.2', { timeout: 15_000 });
  });

  test('390px: the card fits and stays readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(card(page)).toContainText('agent-1.4.2');
    await expectNoPageOverflow(page);
  });
});
