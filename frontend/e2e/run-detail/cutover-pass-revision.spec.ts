/**
 * Cutover of tests/platform/test_pass_revision_browser.py: a page that was loaded before a sibling pass
 * was deleted sends the pass version it loaded with, so the server refuses its edit ("Passes changed");
 * a page loaded after the deletion reaches the remaining pass and edits it under the new version.
 * (The analyzer half is covered in e2e/analyzer: Analyze sends expected_pass_version from the loaded
 * run, frontend/src/features/analyzer/model/__tests__/settings.test.ts.)
 */
import { test, expect } from '@playwright/test';
import { compareUrl, waitLoaded } from '../compare/support';
import { itemButton, openRun, client, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-passrev');
});

async function deletePass(runId: string, pass: number, expectedVersion?: number): Promise<number> {
  const query = expectedVersion === undefined ? '' : `?expected_pass_version=${expectedVersion}`;
  const res = await fetch(`${client.baseUrl}/api/runs/${encodeURIComponent(runId)}/passes/${pass}${query}`, {
    method: 'DELETE',
  });
  expect(res.ok, await res.text()).toBe(true);
  return res.status;
}

test('run page: a stale page is refused after a pass was deleted; a fresh page edits the remaining pass', async ({
  page,
}) => {
  const runId = await seedRepeat(s);
  await deletePass(runId, 3); // pass revision 0 -> 1
  await openRun(page, s.slug, runId, 'pass=1');
  await deletePass(runId, 1, 1); // revision 1 -> 2: only pass 2 remains, behind the page's back

  // stale page: edit an item score
  await itemButton(page, 2).click();
  const chip = page
    .locator('[data-testid=item-card]')
    .first()
    .locator('[role=listitem][data-metric=quality]');
  await expect(chip).toBeVisible();
  await chip.getByRole('button', { name: 'Edit quality score' }).click();
  await chip.getByRole('textbox', { name: 'New quality score' }).fill('0.5');
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/runs/update_metric'));
  await chip.getByRole('button', { name: 'Save' }).click();
  const response = await refused;
  expect(response.status()).toBe(409);
  expect((response.request().postDataJSON() as { expected_pass_version: number }).expected_pass_version).toBe(
    1,
  );
  await expect(chip.getByRole('alert')).toContainText('Passes changed');
  await expect(chip.getByRole('textbox')).toBeVisible();

  // fresh page: the remaining pass is reachable and its edit goes through under the new version
  await openRun(page, s.slug, runId);
  // the remaining pass is renumbered: it is "Pass 1" now
  const pill = page
    .getByRole('region', { name: 'Run summary' })
    .getByRole('link', { name: 'Pass 1', exact: true });
  await expect(pill).toHaveAttribute('href', /\?pass=1$/);
  await pill.click();
  await expect(page).toHaveURL(/pass=1/);
  await itemButton(page, 2).click();
  const fresh = page
    .locator('[data-testid=item-card]')
    .first()
    .locator('[role=listitem][data-metric=quality]');
  await fresh.getByRole('button', { name: 'Edit quality score' }).click();
  await fresh.getByRole('textbox', { name: 'New quality score' }).fill('0.25');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/runs/update_metric'));
  await fresh.getByRole('button', { name: 'Save' }).click();
  const ok = await saved;
  expect(ok.status()).toBe(200);
  const body = ok.request().postDataJSON() as { pass_number: number; expected_pass_version: number };
  expect([body.pass_number, body.expected_pass_version]).toEqual([1, 2]);
  await expect(fresh).toContainText('25');
});

test('compare: an edit from a page loaded before the deletion is refused with the version it loaded', async ({
  page,
}) => {
  const a = await seedRepeat(s);
  const b = await seedRepeat(s);
  await deletePass(a, 3);
  await page.goto(compareUrl([`${a}::pass1`, `${b}::pass1`]));
  await waitLoaded(page);
  await deletePass(a, 1, 1);

  await page
    .getByRole('button', { name: /^Expand item 2$/ })
    .first()
    .click();
  const chip = page.locator('[data-metric="quality"]').first();
  await chip.getByRole('button', { name: /^Edit quality score of/ }).click();
  await chip.getByRole('textbox', { name: 'New quality score' }).fill('0.5');
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/runs/update_metric'));
  await chip.getByRole('button', { name: 'Save' }).click();
  const response = await refused;
  expect(response.status()).toBe(409);
  expect((response.request().postDataJSON() as { expected_pass_version: number }).expected_pass_version).toBe(
    1,
  );
  await expect(chip.getByRole('alert')).toContainText('Passes changed');
});
