/** UX review (group B) regressions for the Models page. */
import { test, expect, type Page } from '@playwright/test';
import { APP } from '../helpers';
import { clickBox, sharedProject } from './support';

const cards = (page: Page) => page.locator('article[data-model]');

test.describe('models: UX regressions', () => {
  test('the Task select can switch to another task once one is chosen, and hand-picked runs reset with it', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 55, 'big');
    await page.goto(`${APP}/projects/${s.project.slug}/models?task=text2sql&dataset=spider-dev&k=4`);
    await expect(cards(page)).toHaveCount(2);

    // hand-pick 3 of 4 runs for the first model
    const first = cards(page).first();
    await first.getByRole('button', { name: /^Edit run selection of/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Select runs/ });
    await clickBox(dialog.getByRole('checkbox', { checked: true }).first());
    await expect(dialog).toContainText('3 / 4 selected');
    await dialog.getByRole('button', { name: 'Apply selection' }).click();
    await expect(cards(page).first()).toContainText('3/4 runs');

    // the select offers the other tasks, not only the one in the URL
    await page.getByRole('button', { name: /Task/ }).first().click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    await options.filter({ hasText: 'summarize' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBe('summarize');
    await expect(cards(page).first()).toBeVisible();

    // back to the first task: the earlier hand-picked subset is gone
    await page.getByRole('button', { name: /Task/ }).first().click();
    await page.getByRole('option').filter({ hasText: 'text2sql' }).click();
    await expect(cards(page)).toHaveCount(2);
    for (const card of await cards(page).all()) await expect(card).not.toContainText('3/4 runs');
  });
});
