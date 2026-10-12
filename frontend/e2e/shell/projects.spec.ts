/**
 * Brief 01 J4 (projects landing) and §8.7 scenarios 5–6 (project switcher,
 * create project from the popover). QYM_AUTH_MODE=none: we are dev@local (ADMIN).
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';

test.describe('projects landing (J4)', () => {
  test('lists projects as cards, breadcrumb says Projects, search filters client-side', async ({
    page,
    request,
  }) => {
    const a = await createProject(request, 'Alpha Landing', uniqueSlug('alpha'));
    const b = await createProject(request, 'Beta Landing', uniqueSlug('beta'));
    await gotoApp(page, '/');
    await expect(page.locator('[data-projects-page]')).toBeVisible();
    await expect(page).toHaveTitle(/Projects/);
    // UX_DECISION adjustment 14: the landing crumb reads "Projects", not "Runs".
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]');
    await expect(crumb).toHaveText('Projects');
    await expect(crumb).toHaveCount(1);
    await expect(page.locator(`[data-project-card="${a.slug}"]`)).toBeVisible();
    await expect(page.locator(`[data-project-card="${b.slug}"]`)).toBeVisible();
    // Sidebar: Projects is the active global item on the landing.
    await expect(page.locator('[data-nav="projects"]')).toHaveAttribute('aria-current', 'page');

    const search = page.locator('[data-projects-page]').getByRole('searchbox', { name: 'Search projects' });
    await search.fill(b.slug);
    await expect(page.locator(`[data-project-card="${b.slug}"]`)).toBeVisible();
    await expect(page.locator(`[data-project-card="${a.slug}"]`)).toHaveCount(0);
    await search.fill('zzz-nothing-matches');
    await expect(page.getByText('No matching projects')).toBeVisible();
    await search.fill('');
    await expect(page.locator(`[data-project-card="${a.slug}"]`)).toBeVisible();
  });

  test('project card navigates in-app to the runs page', async ({ page, request }) => {
    const p = await createProject(request, 'Card Nav', uniqueSlug('cardnav'));
    await gotoApp(page, '/');
    const loads = trackPageLoads(page);
    await page.locator(`[data-project-card="${p.slug}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${p.slug}$`));
    await expect(page.locator('[data-project-switcher]')).toContainText(p.name);
    await expect(page.locator('[data-nav="runs"]')).toHaveAttribute('aria-current', 'page');
    expect(loads.count()).toBe(0);
  });

  test('New project: dialog opens with Name focused, slug derives from the name, success navigates without reload', async ({
    page,
  }) => {
    await gotoApp(page, '/');
    const loads = trackPageLoads(page);
    await page.locator('[data-new-project]').click();
    const dialog = page.getByRole('dialog', { name: 'Create project' });
    await expect(dialog).toBeVisible();
    const name = dialog.getByRole('textbox', { name: /^Name/ });
    await expect(name).toBeFocused();
    const slug = uniqueSlug('created');
    await name.fill(`Created ${slug}`);
    // slug is derived from the name until edited
    await expect(dialog.getByRole('textbox', { name: /^Slug/ })).toHaveValue(`created-${slug}`);
    await dialog.getByRole('textbox', { name: /^Slug/ }).fill(slug);
    await name.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/app/projects/${slug}$`));
    await expect(page.locator('[data-project-switcher]')).toContainText(`Created ${slug}`);
    expect(loads.count()).toBe(0);
    // the new project is in the switcher list without a reload
    await page.locator('[data-project-switcher]').click();
    await expect(page.locator(`[data-switch-to="${slug}"]`)).toBeVisible();
  });

  test('duplicate slug shows the server detail inline and keeps the dialog open', async ({
    page,
    request,
  }) => {
    const existing = await createProject(request, 'Taken Slug', uniqueSlug('taken'));
    await gotoApp(page, '/');
    await page.locator('[data-new-project]').click();
    const dialog = page.getByRole('dialog', { name: 'Create project' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Another name');
    await dialog.getByRole('textbox', { name: /^Slug/ }).fill(existing.slug);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('alert')).not.toHaveText('');
    await expect(page).toHaveURL(/\/app\/?$/);
  });
});

test.describe('project switcher (§8.7 scenario 5)', () => {
  test('search filters, selecting navigates without a full load, remembers the slug, breadcrumb and nav update', async ({
    page,
    request,
  }) => {
    const from = await createProject(request, 'Switch From', uniqueSlug('from'));
    const to = await createProject(request, 'Switch Target', uniqueSlug('target'));
    await gotoApp(page, `/projects/${from.slug}/charts`);
    await expect(page.locator('[data-nav="charts"]')).toHaveAttribute('aria-current', 'page');
    const loads = trackPageLoads(page);

    const trigger = page.locator('[data-project-switcher]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const popover = page.getByRole('dialog', { name: 'Switch project' });
    const search = popover.getByRole('searchbox', { name: 'Search projects' });
    await expect(search).toBeFocused();
    await search.fill(to.slug);
    await expect(popover.locator('[data-switch-to]')).toHaveCount(1);
    await expect(popover.locator(`[data-switch-to="${to.slug}"]`)).toBeVisible();
    await popover.locator(`[data-switch-to="${to.slug}"]`).click();

    await expect(page).toHaveURL(new RegExp(`/app/projects/${to.slug}$`));
    await expect(trigger).toContainText(to.name);
    await expect(page.locator('[data-nav="runs"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-nav="charts"]')).not.toHaveAttribute('aria-current', 'page');
    expect(loads.count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('qym:last-project-slug'))).toBe(to.slug);
  });

  test('current project is marked selected; "No matching projects" for a miss', async ({ page, request }) => {
    const p = await createProject(request, 'Selected Marker', uniqueSlug('selmark'));
    await gotoApp(page, `/projects/${p.slug}`);
    await page.locator('[data-project-switcher]').click();
    const popover = page.getByRole('dialog', { name: 'Switch project' });
    await expect(popover.getByRole('option', { selected: true })).toContainText(p.name);
    await popover.getByRole('searchbox').fill('nothing-here-xyz');
    await expect(popover.getByText('No matching projects')).toBeVisible();
  });

  test('Create project from the popover footer (§8.7 scenario 6)', async ({ page, request }) => {
    const p = await createProject(request, 'Popover Create', uniqueSlug('popcreate'));
    await gotoApp(page, `/projects/${p.slug}`);
    const loads = trackPageLoads(page);
    await page.locator('[data-project-switcher]').click();
    await page.locator('[data-create-project]').click();
    const dialog = page.getByRole('dialog', { name: 'Create project' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    const slug = uniqueSlug('viapop');
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Via Popover');
    await dialog.getByRole('textbox', { name: /^Slug/ }).fill(slug);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${slug}$`));
    await expect(page.locator('[data-project-switcher]')).toContainText('Via Popover');
    expect(loads.count()).toBe(0);
  });
});
