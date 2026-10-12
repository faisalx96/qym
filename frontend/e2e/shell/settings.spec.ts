/// <reference lib="dom" />
/**
 * Brief 01 J6 (project settings) and §8.7 scenarios 7–9: tabs, members
 * combobox, API keys + secret dialog, LLM connections, AI prompts, danger zone.
 */
import { test, expect, type Page } from '@playwright/test';
import { archiveProject, createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';
import { createUser } from './support';

function tab(page: Page, name: RegExp | string) {
  return page.getByRole('tab', { name });
}

test.describe('settings tabs', () => {
  test('?tab= deep link selects the tab; arrow keys move and update the URL; tab is persistent URL state', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Tabs Project', uniqueSlug('tabs'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=members`);
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    await expect(tab(page, /^Members/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-add-member]')).toBeVisible();
    await tab(page, /^Members/).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'API keys')).toBeFocused();
    await expect(tab(page, 'API keys')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\?tab=apikeys$/);
    await expect(page.locator('[data-api-keys]')).toBeVisible();
    await page.keyboard.press('End');
    await expect(tab(page, 'Danger zone')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\?tab=danger$/);
    await expect(page.locator('[data-danger-zone]')).toBeVisible();
    // General clears the parameter; unknown tab falls back to General and is stripped
    await tab(page, 'General').click();
    await expect(page).toHaveURL(/\/settings$/);
    await gotoApp(page, `/projects/${p.slug}/settings?tab=bogus`);
    await expect(tab(page, 'General')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/settings$/);
    // admin-only tabs are present for dev@local (ADMIN); the page header shows slug + role + status
    await expect(tab(page, 'AI prompts')).toBeVisible();
    await expect(
      page.locator('[data-settings-page]').getByText(p.slug, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('[data-settings-page]').getByText('active', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`${p.name} · Settings`));
  });

  test('General: rename updates the breadcrumb switcher without reload', async ({ page, request }) => {
    const p = await createProject(request, 'Rename Me', uniqueSlug('rename'));
    await gotoApp(page, `/projects/${p.slug}/settings`);
    const loads = trackPageLoads(page);
    const field = page.getByRole('textbox', { name: 'Project name' });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await field.fill('Renamed Project');
    await field.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Renamed to Renamed Project' })).toBeVisible();
    await expect(page.locator('[data-project-switcher]')).toContainText('Renamed Project');
    await expect(
      page.locator('[data-settings-page]').getByRole('heading', { name: 'Renamed Project' }),
    ).toBeVisible();
    expect(loads.count()).toBe(0);
  });
});

test.describe('members (§8.7 scenario 8)', () => {
  test('combobox keyboard flow adds a member; remove dialog opens focused on Cancel; no transfer select without runs', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Members Project', uniqueSlug('members'));
    const tag = uniqueSlug('u');
    const user = await createUser(request, `${tag}@e2e.local`, `Member ${tag}`);
    await gotoApp(page, `/projects/${p.slug}/settings?tab=members`);
    const loads = trackPageLoads(page);
    const table = page
      .getByRole('grid', { name: 'Members' })
      .or(page.getByRole('table', { name: 'Members' }));
    await expect(table).toBeVisible();
    await expect(table.getByRole('gridcell', { name: 'dev@local', exact: true })).toBeVisible();

    const combo = page.locator('[data-add-member]').getByRole('combobox', { name: 'Add member' });
    await expect(page.locator('[data-add-member]').getByRole('button', { name: 'Add' })).toBeDisabled();
    await combo.fill(tag);
    const listbox = page.getByRole('listbox', { name: 'Matching users' });
    await expect(listbox.getByRole('option')).toHaveCount(1);
    await expect(listbox.getByRole('option')).toContainText(user.email);
    await combo.press('ArrowDown');
    await expect(combo).toHaveAttribute('aria-activedescendant', /./);
    await combo.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(combo).toHaveValue(`Member ${tag} <${user.email}>`);
    await page.locator('[data-add-member]').getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Member ${tag} added` })).toBeVisible();
    const row = table.getByRole('row').filter({ hasText: user.email });
    await expect(row).toBeVisible();
    await expect(combo).toHaveValue('');
    // member_count comes from the project query; soft so the rest of the flow still runs if it is stale
    await expect.soft(tab(page, /^Members/), 'Members tab count after add').toContainText('2');
    // Escape closes the suggestion list
    await combo.fill('dev');
    await combo.press('Escape');
    await expect(listbox).toBeHidden();

    // Role change for the new member
    await row.getByRole('button', { name: `Role for ${user.email}` }).click();
    await page.getByRole('option', { name: 'Manager' }).click();
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Role saved' })).toBeVisible();

    // Remove: destructive dialog opens focused on Cancel; no transfer select (member owns no runs)
    await row.getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Remove Member ${tag}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByText(/owns no runs in this project\./)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Transfer their runs to' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Remove member' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: /Member .* was removed/ })).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect.soft(tab(page, /^Members/), 'Members tab count after remove').toContainText('1');
    // the current user cannot remove themselves
    await expect(
      table.getByRole('row').filter({ hasText: 'dev@local' }).getByRole('button', { name: 'Remove' }),
    ).toHaveCount(0);
    expect(loads.count()).toBe(0);
  });
});

test.describe('API keys (§8.7 scenario 9)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('create → secret dialog with Copy → list updates; revoke confirm → status revoked, no reload', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Keys Project', uniqueSlug('keys'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=apikeys`);
    const loads = trackPageLoads(page);
    const card = page.locator('[data-api-keys]');
    await expect(card.getByText('No API keys yet.')).toBeVisible();
    await card.getByRole('textbox', { name: 'Key name' }).fill('CI pipeline');
    await card.getByRole('button', { name: 'Create key' }).click();

    const dialog = page.getByRole('dialog', { name: 'API key created' });
    await expect(dialog).toBeVisible();
    const secret = dialog.locator('[data-secret]');
    const token = await secret.inputValue();
    expect(token.length).toBeGreaterThan(10);
    await dialog.getByRole('button', { name: 'Copy API key' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'API key copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    const row = card.getByRole('row').filter({ hasText: 'CI pipeline' });
    await expect(row).toBeVisible();
    await expect(row.getByText('active')).toBeVisible();
    await expect(row.getByText(`${token.slice(0, 6)}`)).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Key name' })).toHaveValue('');

    await row.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Revoke “CI pipeline”?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Revoke key' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Key revoked' })).toBeVisible();
    await expect(row.getByText('revoked')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    expect(loads.count()).toBe(0);
  });

  test('dataset read tokens (admin): create shows the one-time secret; revoke', async ({ page, request }) => {
    const p = await createProject(request, 'Tokens Project', uniqueSlug('tokens'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=apikeys`);
    const card = page.locator('[data-read-tokens]');
    await expect(card).toBeVisible();
    await card.getByRole('textbox', { name: 'Token name' }).fill('Eval service');
    await card.getByRole('button', { name: 'Create token' }).click();
    const dialog = page.getByRole('dialog', { name: 'Read token created' });
    await expect(dialog).toBeVisible();
    expect((await dialog.locator('[data-secret]').inputValue()).length).toBeGreaterThan(10);
    await dialog.getByRole('button', { name: 'Done' }).click();
    const row = card.getByRole('row').filter({ hasText: 'Eval service' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke token' }).click();
    await expect(row.getByText('revoked')).toBeVisible();
  });
});

test.describe('LLM connections', () => {
  test('add → edit → delete, with default tag and inline form', async ({ page, request }) => {
    // Saving a key needs QYM_LLM_CONFIG_ENCRYPTION_KEY in the platform env (the webServer inherits ours):
    // without it POST …/llm-connections answers 400 "LLM config encryption is not configured".
    test.skip(
      !process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY,
      'set QYM_LLM_CONFIG_ENCRYPTION_KEY for the e2e platform (playwright.config.ts does not)',
    );
    const p = await createProject(request, 'LLM Project', uniqueSlug('llm'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=llm`);
    const loads = trackPageLoads(page);
    await expect(page.getByText('No LLM connections yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Add connection' }).click();
    const form = page.locator('[data-llm-form]');
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Add connection' })).toBeDisabled();
    await form.getByRole('textbox', { name: /^Name/ }).fill('OpenAI prod');
    await form.getByRole('textbox', { name: /^Base URL/ }).fill('https://api.openai.com/v1');
    await form.getByRole('textbox', { name: /^Model/ }).fill('gpt-4.1');
    await form.getByLabel(/^API key/).fill('sk-e2e-secret-key');
    await form.getByRole('button', { name: 'Add connection' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Connection added' })).toBeVisible();
    await expect(form).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: 'OpenAI prod' });
    await expect(row).toBeVisible();
    await expect(row.getByText('default')).toBeVisible();
    await expect(row.getByText('gpt-4.1')).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(form.getByText('Edit “OpenAI prod”')).toBeVisible();
    await expect(form.getByLabel(/^API key/)).toHaveAttribute('placeholder', /Keep current/);
    await form.getByRole('textbox', { name: /^Model/ }).fill('gpt-4.1-mini');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Connection updated' })).toBeVisible();
    await expect(row.getByText('gpt-4.1-mini')).toBeVisible();

    await page.getByRole('button', { name: 'Add connection' }).click();
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toBeHidden();

    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete “OpenAI prod”?' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete connection' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Connection deleted' })).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('No LLM connections yet.')).toBeVisible();
    expect(loads.count()).toBe(0);
  });
});

test.describe('AI prompts', () => {
  test('edit → unsaved indicator → save → custom; view diff; restore default', async ({ page, request }) => {
    const p = await createProject(request, 'Prompts Project', uniqueSlug('prompts'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=prompts`);
    const panel = page.locator('[data-prompts]');
    await expect(panel).toBeVisible();
    const rail = panel.getByRole('tablist', { name: 'Prompts' });
    await expect(rail.getByRole('tab')).toHaveCount(3);
    await expect(rail.getByRole('tab', { name: /LLM analyzer/ })).toHaveAttribute('aria-selected', 'true');
    // vertical tablist arrow keys
    await rail.getByRole('tab', { name: /LLM analyzer/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rail.getByRole('tab', { name: /Aggregator/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(rail.getByRole('tab', { name: /LLM analyzer/ })).toHaveAttribute('aria-selected', 'true');

    const editor = panel.getByRole('textbox', { name: 'LLM analyzer prompt' });
    const shipped = await editor.inputValue();
    expect(shipped.length).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Restore default' })).toBeDisabled();
    await editor.fill(`${shipped} E2E-ADDED-WORD`);
    await expect(panel.getByText('● Unsaved changes')).toBeVisible();

    await panel.getByRole('button', { name: 'View diff' }).click();
    const diff = page.getByRole('dialog', { name: /changes vs shipped default/ });
    await expect(diff).toBeVisible();
    await expect(diff.locator('ins')).toContainText('E2E-ADDED-WORD');
    await page.keyboard.press('Escape');
    await expect(diff).toBeHidden();

    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Prompt saved' })).toBeVisible();
    await expect(panel.getByText('● Unsaved changes')).toHaveCount(0);
    await expect(rail.getByRole('tab', { name: /LLM analyzer/ })).toContainText('custom');
    await expect(panel.getByText('edited just now')).toBeVisible();

    await panel.getByRole('button', { name: 'Restore default' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Restore the shipped default?' });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Restore default' }).click();
    await expect(confirm).toBeHidden();
    await expect(rail.getByRole('tab', { name: /LLM analyzer/ })).toContainText('default');
    await expect(editor).toHaveValue(shipped);
  });
});

test.describe('danger zone and archived state', () => {
  test('archive → lands on Projects, project read-only; unarchive from the danger tab restores it', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Danger Project', uniqueSlug('danger'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=danger`);
    const zone = page.locator('[data-danger-zone]');
    await zone.getByRole('button', { name: 'Archive' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Archive “${p.name}”?` });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Archive project' }).click();
    await expect(page).toHaveURL(/\/?$/);
    await expect(page.getByRole('status').filter({ hasText: `${p.name} archived` })).toBeVisible();
    // archived projects leave me.projects → no card on the landing
    await expect(page.locator('[data-projects-page]')).toBeVisible();
    await expect(page.locator(`[data-project-card="${p.slug}"]`)).toHaveCount(0);

    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    await expect(page.locator('[data-settings-page]').getByText('archived', { exact: true })).toBeVisible();
    // archived: no rename form, no add-member bar, no key creation
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0);
    await tab(page, /^Members/).click();
    await expect(page.locator('[data-add-member]')).toHaveCount(0);
    await tab(page, 'API keys').click();
    await expect(page.locator('[data-api-keys]').getByRole('button', { name: 'Create key' })).toHaveCount(0);

    // the banner's "Unarchive it" link opens the danger tab
    await page.locator('[data-archived-banner]').getByRole('link', { name: 'Unarchive it' }).click();
    await expect(page).toHaveURL(/\?tab=danger$/);
    await zone.getByRole('button', { name: 'Unarchive' }).click();
    const unarchive = page.getByRole('dialog', { name: `Unarchive “${p.name}”?` });
    await expect(unarchive).toBeVisible();
    await unarchive.getByRole('button', { name: 'Unarchive' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${p.name} is active again` })).toBeVisible();
    await expect(page.locator('[data-archived-banner]')).toHaveCount(0);
    await expect(page.locator('[data-topbar]').getByText('Read-only')).toHaveCount(0);
    await expect(zone.getByRole('button', { name: 'Archive' })).toBeVisible();
    const res = await request.get(`/v1/projects/by-slug/${p.slug}`);
    expect(((await res.json()) as { is_active: boolean }).is_active).toBe(true);
  });

  test('unarchive preview lists active API keys and offers "Revoke keys first"', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Keys Archived', uniqueSlug('keysarch'));
    const key = await request.post(`/v1/projects/${p.id}/api-keys`, { data: { name: 'Still active' } });
    expect(key.ok()).toBeTruthy();
    await archiveProject(request, p.id);
    await gotoApp(page, `/projects/${p.slug}/settings?tab=danger`);
    await page.locator('[data-danger-zone]').getByRole('button', { name: 'Unarchive' }).click();
    const dialog = page.getByRole('dialog', { name: `Unarchive “${p.name}”?` });
    await expect(dialog.getByText('1 API key will work again')).toBeVisible();
    await expect(dialog.getByText('Still active')).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke keys first' }).click();
    await expect(page).toHaveURL(/\?tab=apikeys$/);
    await expect(
      page.locator('[data-api-keys]').getByRole('row').filter({ hasText: 'Still active' }),
    ).toBeVisible();
  });

  test('delete is blocked only by runs: an empty project deletes after the typed confirmation', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Delete Me', uniqueSlug('delete'));
    await gotoApp(page, `/projects/${p.slug}/settings?tab=danger`);
    await page.locator('[data-danger-zone]').getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Delete “${p.name}”?` });
    await expect(dialog).toBeVisible();
    const confirmBtn = dialog.getByRole('button', { name: 'Delete project' });
    await expect(confirmBtn).toBeDisabled();
    await dialog.getByRole('textbox').fill(p.name);
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(page).toHaveURL(/\/?$/);
    await expect(page.getByRole('status').filter({ hasText: `${p.name} deleted` })).toBeVisible();
    const res = await request.get(`/v1/projects/by-slug/${p.slug}`);
    expect(res.status()).toBe(404);
  });
});
