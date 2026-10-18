/** UX review (group C): the inline score editor keeps focus, never posts twice and never posts a no-op. */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded, openMetric } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-ux-edit');
  classic = await seedClassic(s);
});

async function openEditor(page: Page, item: string, metric = 'quality') {
  await openRun(page, s.slug, classic, `item=${item}`);
  const card = page.getByTestId('item-card');
  await expect(card).toBeVisible();
  const panel = await openMetric(card, metric);
  const edit = panel.getByRole('button', { name: 'Edit score', exact: true });
  await edit.click();
  const box = card.getByRole('textbox', { name: `New ${metric} score` });
  await expect(box).toBeFocused();
  return { card, edit, box };
}

const updates = (page: Page) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/runs/update_metric')) posts.push(r.postData() ?? '');
  });
  return posts;
};

test('Escape and Cancel give focus back to the Edit button', async ({ page }) => {
  const { edit, box, card } = await openEditor(page, 'item-0002');
  await box.press('Escape');
  await expect(card.getByRole('textbox', { name: 'New quality score' })).toHaveCount(0);
  await expect(edit).toBeFocused();
  await edit.click();
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toBeFocused();
});

test('saving without changing the number posts nothing and closes the editor', async ({ page }) => {
  const posts = updates(page);
  const { edit, box, card } = await openEditor(page, 'item-0003');
  await box.press('Enter');
  await expect(card.getByRole('textbox', { name: 'New quality score' })).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(posts).toEqual([]);
  await expect(card.getByText('edited', { exact: true })).toHaveCount(0);
});

test('a double click on Save posts the score once and returns focus', async ({ page }) => {
  const posts = updates(page);
  const { edit, box, card } = await openEditor(page, 'item-0004');
  await box.fill('0.42');
  await card.getByRole('button', { name: 'Save' }).dblclick();
  await expect(card.getByRole('textbox', { name: 'New quality score' })).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(posts).toHaveLength(1);
});
