/** UX review (group C): a half-typed issue survives a stray click on the backdrop; Escape and Cancel still close. */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;
test.beforeAll(async () => {
  s = await seedProject('rd-ux-issue');
  classic = await seedClassic(s);
});

test('backdrop click keeps typed text; Escape closes; an untouched dialog closes on the backdrop', async ({
  page,
}) => {
  await openRun(page, s.slug, classic, 'item=item-0002');
  const card = page.getByTestId('item-card');
  const dialog = page.getByTestId('issue-dialog');
  const add = card.getByRole('button', { name: '+ Add issue' }).first();
  // untouched: the backdrop dismisses
  await add.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  // typed: the backdrop does nothing
  await add.click();
  await dialog.getByLabel('Finding').fill('half-typed finding');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Finding')).toHaveValue('half-typed finding');
  // Escape still closes, focus returns to the opener
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
});
