/**
 * Brief 06 §2.4 / §2.5 (journey 4) + §8 scenarios 4 and 5: the entry screen, URL params and the
 * layering of edits on top of a starting point.
 */
import { expect } from '@playwright/test';
import { experimentSpec, launchExperiment, resetFakes, test, waitForSubmitted } from '../support';
import {
  dialog,
  expectReady,
  goStep,
  launchButton,
  listPresets,
  maxAttempts,
  nameBox,
  openHome,
  openLaunch,
  rail,
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

test.describe('home', () => {
  test('nothing is selected on load; ticking an environment picks the default preset and a name makes it ready', async ({
    page,
  }) => {
    await openHome(page, f.project.slug);
    await expect(page.getByRole('checkbox', { name: 'Alpha' })).not.toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Pick an environment.' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Default preset/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeDisabled();
    // Before an environment is picked every start card is disabled alike: "From scratch" is not highlighted either.
    const scratch = page.getByRole('radio', { name: /From scratch/ });
    await expect(scratch).toHaveAttribute('aria-disabled', 'true');
    await expect(scratch).not.toBeChecked();
    // The short path holds neither priority, versioning details nor any section.
    await expect(page.getByLabel('Priority')).toHaveCount(0);
    await expect(page.getByLabel('Versioning details')).toHaveCount(0);
    await expect(review(page)).toHaveCount(0);
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /Default preset v1/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: /1 problem to fix/ })).toBeVisible();
    await nameBox(page).fill('home run');
    await expect(
      page.getByRole('status').filter({ hasText: 'Ready: Default preset v1 on Alpha' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled();
  });

  test('tick, name, Launch as is: three actions launch the default preset', async ({ page }) => {
    await openHome(page, f.project.slug);
    await page.getByRole('listitem').filter({ hasText: 'Alpha' }).getByText('Alpha', { exact: true }).click();
    await nameBox(page).fill('three actions');
    const launch = page.getByRole('button', { name: 'Launch as is' });
    await expect(launch).toBeEnabled({ timeout: 15_000 });
    await launch.click();
    await expect(page).toHaveURL(/\/experiments\/[^/]+$/);
  });

  test('Customize keeps what was typed and opens step 1; the browser Back button walks back to home', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('kept name');
    await page.getByRole('button', { name: /Customize/ }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeFocused();
    await expect(nameBox(page)).toHaveValue('kept name');
    await expect(page.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
    await page.getByRole('button', { name: /Continue to starting point/ }).click();
    await expect(page).toHaveURL(/step=start/);
    await page.goBack();
    await expect(page).toHaveURL(/step=where/);
    await page.goBack();
    await expect(page).not.toHaveURL(/step=/);
    await expect(nameBox(page)).toHaveValue('kept name');
  });

  test('"Start" returns home without losing edits and Show on a name problem focuses the name', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('x');
    await page.getByRole('button', { name: '← Start' }).click();
    await expect(page).not.toHaveURL(/step=/);
    await nameBox(page).fill('');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(nameBox(page)).toBeFocused();
  });

  test('the start cards explain themselves and the selected one is marked', async ({ page }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    const def = page.getByRole('radio', { name: /Default preset v1/ });
    await expect(def).toContainText('Recommended');
    await expect(def).toContainText('What this environment’s managers published.');
    await expect(def).toBeChecked();
    await expect(page.getByRole('radio', { name: /Top-scoring run/ })).toContainText('Best past run');
    await expect(page.getByRole('radio', { name: /Slow timeout/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /From scratch/ })).not.toBeChecked();
  });
});

test.describe('entry', () => {
  test('an environment with a default preset auto-selects it; Launch as is enables once the dry run is Ready', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'start');
    await expect(page.getByRole('radio', { name: /Default preset v1/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('Default preset v1');
    await expect(launchButton(page)).toBeDisabled();
    await expect(review(page)).toContainText('Name the experiment.');
    await goStep(page, 'where');
    await nameBox(page).fill('entry run');
    await expectReady(page);
    await expect(launchButton(page)).toBeEnabled();
    await expect(review(page)).toContainText(/1\s*run to launch/);
  });

  test('an environment without a default preset starts from scratch and asks for a dataset', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.bare.id}`, 'start');
    await expect(page.getByRole('radio', { name: /From scratch/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /Default preset/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(
      page.getByText('No default preset is published for Bare yet, so the form starts from scratch.'),
    ).toBeVisible();
    await expect(review(page)).toContainText('Choose a dataset.');
    await goStep(page, 'where');
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
    await openLaunch(page, f.project.slug, `?clone=${x.id}&job=${x.jobs[0]!.id}`, 'start');
    await expect(page.getByRole('radio', { name: /Copy an experiment/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('Clone of src exp');
    await goStep(page, 'where');
    await expect(nameBox(page)).toHaveValue('src exp (rerun)');
    await expect(page.getByRole('checkbox', { name: 'Alpha' })).toBeChecked();
    await expectReady(page);
  });

  test('?base=saved&preset= opens on that saved preset', async ({ page, request }) => {
    const saved = (await listPresets(request, f.project.id, f.env.id)).find((p) => p.kind === 'saved')!;
    await openLaunch(page, f.project.slug, `?env=${f.env.id}&base=saved&preset=${saved.id}`, 'start');
    await expect(page.getByRole('radio', { name: /Slow timeout/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText(
      'Saved preset “Slow timeout” v1',
    );
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
    await expect(rail(page).getByRole('button', { name: /Environment configurations/ })).toContainText('1');
    await expect(review(page)).toContainText('Environment configurations: 1 change');

    await page.getByRole('button', { name: /^Reset .*Max Attempts/ }).click();
    await expect(field).toHaveValue('');
    await goStep(page, 'start');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('0 changes on top');
    await expect(page.getByRole('button', { name: 'Undo all changes' })).toBeDisabled();

    const field2 = await maxAttempts(page);
    await field2.fill('4');
    await goStep(page, 'start');
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('1 change on top');
    await page.getByRole('button', { name: 'Undo all changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('0 changes on top');
    await expect(await maxAttempts(page)).toHaveValue('');
  });

  test('switching the starting point confirms first and the edit survives when it fits the new base', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const field = await maxAttempts(page);
    await field.fill('3');
    await goStep(page, 'start');
    await page.getByRole('radio', { name: /Slow timeout/ }).click();
    const d = dialog(page);
    await expect(d).toContainText('Change the starting point?');
    // Cancelling keeps the current base.
    await d
      .getByRole('button', { name: /^(Keep|Cancel)/ })
      .first()
      .click();
    await expect(page.getByRole('radio', { name: /Default preset v1/ })).toBeChecked();

    await page.getByRole('radio', { name: /Slow timeout/ }).click();
    await dialog(page).getByRole('button', { name: 'Change starting point' }).click();
    await expect(page.getByRole('radio', { name: /Slow timeout/ })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText(
      'Saved preset “Slow timeout”',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText('1 change on top');
    await expect(await maxAttempts(page)).toHaveValue('3');
  });
});
