/** UX review (group C): the compare score editor shares the run page's focus and double-submit behaviour. */
import { expect, test } from '@playwright/test';
import { compareUrl, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-ux-edit');
});

test('Escape returns focus to the pencil; a double click on Save posts once', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/runs/update_metric')) posts.push(r.postData() ?? '');
  });
  await page.goto(compareUrl([seed.runs.base, seed.runs.a], { item: 'cmp-002' }));
  await waitLoaded(page);
  const edit = page.getByRole('button', { name: 'Edit quality score' }).first();
  await edit.click();
  const box = page.getByRole('textbox', { name: 'New quality score' });
  await expect(box).toBeFocused();
  await box.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(edit).toBeFocused();
  // unchanged value: nothing is posted
  await edit.click();
  await page.getByRole('textbox', { name: 'New quality score' }).press('Enter');
  await expect(box).toHaveCount(0);
  expect(posts).toEqual([]);
  // a real change posted by a double click goes out once
  await edit.click();
  await page.getByRole('textbox', { name: 'New quality score' }).fill('0.33');
  await page.getByRole('button', { name: 'Save' }).dblclick();
  await expect(box).toHaveCount(0);
  expect(posts).toHaveLength(1);
});
