/**
 * Brief 06 §2.4 / §2.5 (journey 4) + §8 scenarios 4 and 5: the entry screen, URL params and the
 * layering of edits on top of a starting point.
 */
import { expect } from '@playwright/test';
import { experimentSpec, launchExperiment, resetFakes, test, waitForSubmitted } from '../support';
import {
  dialog,
  expectReady,
  launchButton,
  listPresets,
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

test.describe('entry', () => {
  test('an environment with a default preset auto-selects it; Launch as is enables once the dry run is Ready', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await expect(page.getByRole('radio', { name: /^Default preset v1/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('Default preset v1');
    await expect(page.getByRole('button', { name: 'Launch as is' })).toHaveCount(0);
    await expect(launchButton(page)).toBeDisabled();
    await expect(review(page)).toContainText('Name the experiment.');
    await nameBox(page).fill('entry run');
    await expectReady(page);
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled();
    await expect(launchButton(page)).toBeEnabled();
    await expect(review(page)).toContainText(/1\s*run to launch/);
  });

  test('an environment without a default preset starts from scratch and asks for a dataset', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.bare.id}`);
    await expect(page.getByRole('radio', { name: /^From scratch/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^Default preset/ })).toBeDisabled();
    await expect(
      page.getByText('No default preset is published for Bare yet, so the form starts from scratch.'),
    ).toBeVisible();
    await expect(review(page)).toContainText('Choose a dataset.');
    await nameBox(page).fill('scratch run');
    await page
      .getByRole('button', { name: /Dataset$/ })
      .first()
      .click();
    await page.getByRole('option', { name: 'golden' }).click();
    await expectReady(page);
    await expect(launchButton(page)).toBeEnabled();
  });

  test('?clone=&job= opens a copy of the experiment with its name and settings', async ({
    page,
    request,
  }) => {
    const x = await launchExperiment(request, f.project.id, {
      name: 'src exp',
      environment_ids: [f.env.id],
      spec: experimentSpec(f.connectionId, 77),
    });
    await waitForSubmitted(request, f.project.id, x.id);
    await openLaunch(page, f.project.slug, `?clone=${x.id}&job=${x.jobs[0]!.id}`);
    await expect(page.getByRole('radio', { name: /^Copy of experiment/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('Clone of src exp');
    await expect(nameBox(page)).toHaveValue('src exp (rerun)');
    await expect(page.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
    await expectReady(page);
  });

  test('?base=saved&preset= opens on that saved preset', async ({ page, request }) => {
    const saved = (await listPresets(request, f.project.id, f.env.id)).find((p) => p.kind === 'saved')!;
    await openLaunch(page, f.project.slug, `?env=${f.env.id}&base=saved&preset=${saved.id}`);
    await expect(page.getByRole('radio', { name: /^Saved preset/ })).toBeChecked();
    await expect(page.getByRole('button', { name: /^Slow timeout/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText(
      'Saved preset “Slow timeout” v1',
    );
  });

  test('without ?env= nothing is selected and the review asks for an environment', async ({ page }) => {
    await openLaunch(page, f.project.slug);
    await expect(page.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
    await expect(launchButton(page)).toBeDisabled();
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /^Default preset v1/ })).toBeChecked();
  });
});

test.describe('layering edits on a starting point', () => {
  test('a change shows the dot, the section badge and "1 change on top"; Reset field and Undo all revert it', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const field = await maxAttempts(page);
    const wrapper = page.locator('[data-field$="primary_2f_max_5f_attempts"]');
    await expect(wrapper).not.toHaveAttribute('data-changed', '');
    await field.fill('3');
    await expect(wrapper).toHaveAttribute('data-changed', '');
    await expect(wrapper.getByText('changed', { exact: true })).toBeAttached();
    await expect(
      page
        .getByRole('navigation', { name: 'Sections' })
        .getByRole('button', { name: /Environment configurations/ }),
    ).toContainText('1');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('1 change on top');
    await expect(review(page)).toContainText('Environment configurations: 1 change');

    await page.getByRole('button', { name: /^Reset .*Max Attempts/ }).click();
    await expect(field).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('0 changes on top');
    await expect(page.getByRole('button', { name: 'Undo all changes' })).toBeDisabled();

    await field.fill('4');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('1 change on top');
    await page.getByRole('button', { name: 'Undo all changes' }).click();
    await expect(field).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('0 changes on top');
  });

  test('switching the starting point confirms first and the edit survives when it fits the new base', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const field = await maxAttempts(page);
    await field.fill('3');
    await page.getByRole('radio', { name: /^Saved preset/ }).click();
    const d = dialog(page);
    await expect(d).toContainText('Change the starting point?');
    // Cancelling keeps the current base.
    await d
      .getByRole('button', { name: /^(Keep|Cancel)/ })
      .first()
      .click();
    await expect(page.getByRole('radio', { name: /^Default preset v1/ })).toBeChecked();
    await expect(field).toHaveValue('3');

    await page.getByRole('radio', { name: /^Saved preset/ }).click();
    await dialog(page).getByRole('button', { name: 'Change starting point' }).click();
    await expect(page.getByRole('radio', { name: /^Saved preset/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText(
      'Saved preset “Slow timeout”',
    );
    await expect(field).toHaveValue('3');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('1 change on top');
  });
});
