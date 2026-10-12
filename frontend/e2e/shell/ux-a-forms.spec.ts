/// <reference lib="dom" />
/** UX review (area A) regressions: required whitespace, form focus, unsaved prompt drafts. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';

test('create project: a whitespace-only name is rejected, nothing is created', async ({ page }) => {
  await gotoApp(page, '/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Create project' });
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/projects')) posts.push(r.url());
  });
  await dlg.getByRole('textbox', { name: /Name/ }).fill('   ');
  await dlg.getByRole('textbox', { name: /Name/ }).press('Enter');
  await expect(dlg.getByText('Name is required.')).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('LLM connection form takes focus on open and returns it to Add when closed', async ({
  page,
  request,
}) => {
  const p = await createProject(request, 'UX LLM Focus', uniqueSlug('uxllm'));
  await gotoApp(page, `/projects/${p.slug}/settings?tab=llm`);
  await page.getByRole('button', { name: 'Add connection' }).first().click();
  await expect(page.getByRole('textbox', { name: /^Name/ })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Add connection' })).toBeFocused();
});

test('prompt drafts: leaving the tab with unsaved edits asks first', async ({ page, request }) => {
  const p = await createProject(request, 'UX Prompt Guard', uniqueSlug('uxprm'));
  await gotoApp(page, `/projects/${p.slug}/settings?tab=prompts`);
  const editor = page.getByRole('textbox', { name: 'LLM analyzer prompt' });
  await editor.fill('A short custom prompt');
  await page.getByRole('tab', { name: 'General' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Keep editing' }).click();
  await expect(editor).toHaveValue('A short custom prompt');
  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).not.toHaveURL(/tab=prompts/);
  // Clean drafts never prompt.
  await page.getByRole('tab', { name: 'Prompts' }).click();
  await page.getByRole('tab', { name: 'General' }).click();
  await expect(page).not.toHaveURL(/tab=prompts/);
});

test('command palette: choosing an entry clears the search for the next open', async ({ page, request }) => {
  const p = await createProject(request, 'UX Palette Reset', uniqueSlug('uxpal'));
  await gotoApp(page, `/projects/${p.slug}`);
  await expect(page.locator('[data-app-shell]')).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.locator('[data-command-palette]');
  const input = palette.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('Project settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings/);
  await page.keyboard.press('Control+k');
  await expect(palette.getByRole('combobox')).toHaveValue('');
});
