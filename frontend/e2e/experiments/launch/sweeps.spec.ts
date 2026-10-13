/** Brief 06 §8 scenario 7: sweeps, range chips, run counts, linking axes and the run cap. */
import { expect, type Locator, type Page } from '@playwright/test';
import { resetFakes, test } from '../support';
import {
  expectReady,
  launchButton,
  nameBox,
  openGroup,
  openLaunch,
  openSection,
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

async function openRouting(page: Page): Promise<void> {
  await openSection(page, 'Environment configurations');
  await openGroup(page, 'LLM routing');
}

/** Connect Timeout = first, then "Sweep values". */
async function startSweep(page: Page, field: string, first: string): Promise<void> {
  await page.getByRole('textbox', { name: field, exact: true }).fill(first);
  await page.getByRole('button', { name: `Sweep values: primary · ${field}` }).click();
}

async function addRange(page: Page, label: string, start: string, stop: string, step: string): Promise<void> {
  const sec = page.getByRole('region', { name: /^Sweeps/ });
  const group = sec.getByRole('group', { name: `${label} (swept values)` });
  await group.getByRole('button', { name: 'Range…' }).click();
  await group.getByLabel(`Start of the range for ${label}`).fill(start);
  await group.getByLabel(`Stop of the range for ${label}`).fill(stop);
  await group.getByLabel(`Step of the range for ${label}`).fill(step);
  await group.getByRole('button', { name: `Add range to ${label}` }).click();
}

/** The axis checkbox is a visually hidden input: focus it and press Space, as a keyboard user does. */
async function tick(page: Page, box: Locator): Promise<void> {
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
}

test('a range 0.1 to 0.5 step 0.1 makes 5 chips and "5 runs to launch"', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('sweep run');
  await openRouting(page);
  await startSweep(page, 'Connect Timeout', '0.1');
  const sweeps = page.getByRole('region', { name: /^Sweeps/ });
  await expect(sweeps).toBeVisible();
  await expect(page.getByRole('region', { name: /^Sweeps/ })).toBeVisible();
  const label = 'Endpoints › primary › Connect Timeout';
  await addRange(page, label, '0.1', '0.5', '0.1');
  const chips = sweeps.getByRole('list', { name: `${label} values` }).getByRole('listitem');
  await expect(chips).toHaveCount(5);
  await expect(chips).toHaveText(['0.1', '0.2', '0.3', '0.4', '0.5']);
  await expect(review(page)).toContainText(/5\s*runs to launch/);
  await expect(sweeps.getByTestId('sweep-math')).toContainText('5');
  await expectReady(page);
  await expect(launchButton(page)).toBeEnabled();
  // Removing a chip updates the count.
  await sweeps.getByRole('button', { name: `Remove 0.5 from ${label}` }).click();
  await expect(review(page)).toContainText(/4\s*runs to launch/);
  // Single value stops the sweep.
  await sweeps.getByRole('button', { name: `Single value for ${label}` }).click();
  await expect(review(page)).toContainText(/1\s*run to launch/);
});

test('linking two axes of different lengths is an error; equal lengths zip', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('link run');
  await openRouting(page);
  await startSweep(page, 'Connect Timeout', '1');
  await startSweep(page, 'Max Attempts', '1');
  const sweeps = page.getByRole('region', { name: /^Sweeps/ });
  await addRange(page, 'Endpoints › primary › Connect Timeout', '2', '3', '1'); // 1,2,3
  await addRange(page, 'Endpoints › primary › Max Attempts', '2', '3', '1'); // 1,2,3
  await expect(review(page)).toContainText(/9\s*runs to launch/);
  // Make the lengths differ, then try to link.
  await sweeps.getByRole('button', { name: 'Remove 3 from Endpoints › primary › Max Attempts' }).click();
  await tick(
    page,
    sweeps.getByRole('checkbox', { name: 'Select Endpoints › primary › Connect Timeout to link' }),
  );
  await tick(
    page,
    sweeps.getByRole('checkbox', { name: 'Select Endpoints › primary › Max Attempts to link' }),
  );
  await sweeps.getByRole('button', { name: 'Link selected' }).click();
  await expect(sweeps.getByRole('alert')).toBeVisible();
  await expect(sweeps.getByRole('alert')).toContainText(/same number|length|values/i);
  await expect(sweeps.getByText('linked', { exact: true })).toHaveCount(0);
  // Equal lengths: link and the run count zips.
  await addRange(page, 'Endpoints › primary › Max Attempts', '3', '3', '1');
  await sweeps.getByRole('button', { name: 'Link selected' }).click();
  await expect(sweeps.getByText('linked', { exact: true })).toHaveCount(1);
  await expect(review(page)).toContainText(/3\s*runs to launch/);
  await sweeps
    .getByRole('button', { name: /^Unlink/ })
    .first()
    .click();
  await expect(review(page)).toContainText(/9\s*runs to launch/);
});

test('exceeding the run cap disables Launch and shows the over-cap callout', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await nameBox(page).fill('too many');
  await openRouting(page);
  await startSweep(page, 'Connect Timeout', '1');
  await startSweep(page, 'Max Attempts', '1');
  await addRange(page, 'Endpoints › primary › Connect Timeout', '2', '9', '1'); // 9
  await addRange(page, 'Endpoints › primary › Max Attempts', '2', '9', '1'); // 9 -> 81
  const sweeps = page.getByRole('region', { name: /^Sweeps/ });
  await expect(sweeps.getByText(/81 runs is over the limit of 64/)).toBeVisible();
  await expect(review(page)).toContainText(/81\s*runs/);
  await expect(launchButton(page)).toBeDisabled();
  await expect(page.getByRole('region', { name: /^Sweeps/ })).toBeVisible();
  // Linking brings it back under the cap.
  await tick(
    page,
    sweeps.getByRole('checkbox', { name: 'Select Endpoints › primary › Connect Timeout to link' }),
  );
  await tick(
    page,
    sweeps.getByRole('checkbox', { name: 'Select Endpoints › primary › Max Attempts to link' }),
  );
  await sweeps.getByRole('button', { name: 'Link selected' }).click();
  await expect(review(page)).toContainText(/9\s*runs to launch/);
  await expectReady(page);
  await expect(launchButton(page)).toBeEnabled();
});
