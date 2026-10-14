/**
 * Override tables: endpoints and roles share one design (a global row over per-element rows), and the
 * global row can sweep several values (one run per value).
 */
import { expect, type Page } from '@playwright/test';
import { resetFakes, test } from '../support';
import { openGroup, openLaunch, openSection, review, seedLaunch, type LaunchFixture } from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

async function routing(page: Page) {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'settings');
  await openGroup(page, 'LLM routing');
}

test('endpoints are a table: a global row writes to every endpoint, new endpoints add a row', async ({
  page,
}) => {
  await routing(page);
  const table = page.getByRole('table', { name: 'endpoint overrides' });
  await expect(table.getByRole('rowheader', { name: 'primary' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New endpoint name' }).fill('fast');
  await page.getByRole('textbox', { name: 'New endpoint name' }).press('Enter');
  await expect(table.getByRole('rowheader', { name: 'fast' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'All endpoints' })).toBeVisible();
  await table.getByRole('textbox', { name: 'All endpoints · Timeout' }).fill('45');
  await table.getByRole('textbox', { name: 'All endpoints · Timeout' }).press('Enter');
  await expect(
    table.getByRole('row', { name: /^primary/ }).getByRole('textbox', { name: /^(primary|fast) · Timeout$/ }),
  ).toHaveValue('45');
  await expect(
    table.getByRole('row', { name: /^fast/ }).getByRole('textbox', { name: /^(primary|fast) · Timeout$/ }),
  ).toHaveValue('45');
  await table.getByRole('button', { name: 'Remove fast' }).click();
  await expect(table.getByRole('rowheader', { name: 'fast' })).toHaveCount(0);
});

test('role overrides keep their table and global row', async ({ page }) => {
  await routing(page);
  const table = page.getByRole('table', { name: 'role overrides' });
  await expect(table.getByRole('rowheader', { name: 'All roles' })).toBeVisible();
  await table.getByRole('textbox', { name: 'All roles · max_tokens' }).fill('512');
  await table.getByRole('textbox', { name: 'All roles · max_tokens' }).press('Enter');
  await expect(
    table.getByRole('row', { name: /router/i }).getByRole('textbox', { name: /max.?tokens/i }),
  ).toHaveValue('512');
});

test('the global row sweeps several values: chips, "sweeps N runs", and one run per value', async ({
  page,
}) => {
  await routing(page);
  const table = page.getByRole('table', { name: 'role overrides' });
  await table.getByRole('button', { name: 'Sweep values: All roles · max_tokens' }).click();
  const chips = table.locator('[data-global-sweep]');
  await chips.getByRole('textbox').fill('256, 512, 1024');
  await chips.getByRole('textbox').press('Enter');
  await expect(chips).toContainText('sweeps 3 runs');
  // linked: three runs (one per value), not one per combination of the roles
  await expect(review(page)).toContainText(/3\s*runs to launch/, { timeout: 15_000 });
  await chips.getByRole('button', { name: /Single value/ }).click();
  await expect(review(page)).toContainText(/1\s*run to launch/, { timeout: 15_000 });
});

test('390px: the global sweep keeps the run count in the launch bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routing(page);
  const table = page.getByRole('table', { name: 'role overrides' });
  await table.getByRole('button', { name: 'Sweep values: All roles · max_tokens' }).click();
  const chips = table.locator('[data-global-sweep]');
  await chips.getByRole('textbox').fill('256, 512');
  await chips.getByRole('textbox').press('Enter');
  await expect(page.getByRole('region', { name: 'Launch', exact: true })).toContainText(
    /2\s*runs to launch/,
    {
      timeout: 15_000,
    },
  );
  await openSection(page, 'Models');
});
