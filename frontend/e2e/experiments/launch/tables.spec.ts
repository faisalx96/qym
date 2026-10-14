/**
 * Override tables: endpoints and roles share one design (a global row over per-element rows), and the
 * global row can sweep several values (one run per value).
 */
import { expect, type Page } from '@playwright/test';
import { expectNoPageOverflow, FAKE_A, resetFakes, setFakeArrayLeaves, test } from '../support';
import { openGroup, openLaunch, review, seedLaunch, type LaunchFixture } from './launchSupport';

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
  await chips.getByRole('button', { name: /edit sweep/i }).click();
  const editor = page.getByRole('dialog', { name: /Sweep values of/ });
  await editor.getByRole('textbox').fill('256, 512, 1024');
  await editor.getByRole('textbox').press('Enter');
  await expect(chips).toContainText('sweeps 3 runs');
  await expect(chips).toContainText('256 · 512 · 1024');
  // linked: three runs (one per value), not one per combination of the roles
  await expect(review(page)).toContainText(/3\s*runs to launch/, { timeout: 15_000 });
  await editor.getByRole('button', { name: /Single value/ }).click();
  await expect(review(page)).toContainText(/1\s*run to launch/, { timeout: 15_000 });
});

test('the settings step uses the full width: the review rail gives way to the launch bar, tables read in full', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await routing(page);
  // no 22rem rail beside the step; the compact launch bar carries the run count
  await expect(page.getByRole('region', { name: 'Launch', exact: true })).toContainText(/runs? to launch/);
  const frame = page.locator('[data-table-wrap]').first();
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  expect(box.width).toBeGreaterThan(1000);
  // at most two bordered boxes around a table: the group and the table frame (no section > block > block > table)
  const nested = await frame.evaluate((el) => {
    let boxes = 0;
    for (let n: Element | null = el; n && !n.matches('main'); n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (
        parseFloat(cs.borderTopWidth) > 0 &&
        cs.borderTopStyle !== 'none' &&
        cs.borderTopColor !== 'rgba(0, 0, 0, 0)'
      )
        boxes += 1;
    }
    return boxes;
  });
  expect(nested).toBeLessThanOrEqual(3);
});

test('a table that still overflows shows a scroll cue (edge fade) and loses it at the end', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await routing(page);
  const frame = page.locator('[data-table-wrap]').first();
  await expect(frame).toHaveAttribute('data-cue-end', '');
  await expect(frame).not.toHaveAttribute('data-cue-start', '');
  await frame.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(frame).toHaveAttribute('data-cue-start', '');
  await expect(frame).not.toHaveAttribute('data-cue-end', '');
});

test('390px: the global sweep keeps the run count in the launch bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routing(page);
  const table = page.getByRole('table', { name: 'role overrides' });
  const trigger = table.getByRole('button', { name: 'Sweep values: All roles · max_tokens' });
  // the sticky launch bar covers the bottom of a phone viewport: put the target in the upper third first
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -200));
  await trigger.click();
  const chips = table.locator('[data-global-sweep]');
  await chips.getByRole('button', { name: /edit sweep/i }).click();
  const editor = page.getByRole('dialog', { name: /Sweep values of/ });
  await editor.getByRole('textbox').fill('256, 512');
  await editor.getByRole('textbox').press('Enter');
  await expect(page.getByRole('region', { name: 'Launch', exact: true })).toContainText(
    /2\s*runs to launch/,
    {
      timeout: 15_000,
    },
  );
});

test.describe('list settings (the fake service serves STOP_WORDS, ALLOWED_REGIONS, TOOL_LIMITS)', () => {
  test.beforeEach(async ({ request }) => {
    await resetFakes(request);
    await setFakeArrayLeaves(request, FAKE_A);
    f = await seedLaunch(request);
  });

  test('adding items to a string list gives blank rows and no problems; an integer list starts at 0', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'settings');
    await openGroup(page, 'Other');
    await page.getByRole('button', { name: /Edit .*Stop Words.* as fields/ }).click();
    const stop = page.getByRole('group', { name: /Stop Words/ }).first();
    // an unset list opened as fields changes nothing yet
    await expect(page.getByRole('button', { name: /Reset .*Stop Words/ })).toHaveCount(0);
    for (let i = 0; i < 3; i++) await stop.getByRole('button', { name: '+ Add item' }).click();
    const table = stop.getByRole('table');
    await expect(table.getByRole('textbox')).toHaveCount(4); // the All row plus three items
    await expect(review(page)).not.toContainText(/None is not of type|Every item must be/);
    await table.getByRole('textbox', { name: /\(all items\)/ }).fill('x');
    await table.getByRole('textbox', { name: /\(all items\)/ }).press('Enter');
    await expect(table.getByRole('textbox').nth(1)).toHaveValue('x');
    await page.getByRole('button', { name: /Edit .*Allowed Regions.* as fields/ }).click();
    const regions = page.getByRole('group', { name: /Allowed Regions/ }).first();
    await regions.getByRole('button', { name: '+ Add item' }).click();
    await expect(regions.getByRole('table').getByRole('textbox').first()).toHaveValue('0');
  });

  test('the list block takes the whole section width (no clipped columns)', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'settings');
    await openGroup(page, 'Other');
    await page.getByRole('button', { name: /Edit .*Stop Words.* as fields/ }).click();
    const stop = page.getByRole('group', { name: /Stop Words/ }).first();
    const [block, group] = [
      await stop.boundingBox(),
      await page.locator('[data-group]').last().boundingBox(),
    ];
    expect(block!.width).toBeGreaterThan(group!.width * 0.8);
  });
});

test('one endpoint already shows the All endpoints row (like All roles)', async ({ page }) => {
  await routing(page);
  const table = page.getByRole('table', { name: 'endpoint overrides' });
  await expect(table.getByRole('row', { name: /^primary/ })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'All endpoints' })).toBeVisible();
});

test('390px: the first column of the tables stays while the columns scroll, and nothing overflows the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routing(page);
  const table = page.getByRole('table', { name: 'role overrides' });
  const wrap = table.locator('xpath=..');
  await wrap.evaluate((el) => (el.scrollLeft = 200));
  const name = table.getByRole('rowheader', { name: /router/i });
  const [w, n] = [await wrap.boundingBox(), await name.boundingBox()];
  expect(n!.x).toBeGreaterThanOrEqual(w!.x - 1);
  expect(n!.x).toBeLessThan(w!.x + 40);
  await expectNoPageOverflow(page);
});
