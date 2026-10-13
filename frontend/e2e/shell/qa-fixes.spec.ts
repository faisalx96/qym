/// <reference lib="dom" />
/**
 * QA fix list for shell / auth / projects / profile / settings (docs/internal/ui-migration/qa/shell.md).
 * Role-dependent views answer GET /v1/me; server rules are covered by the pytest suites.
 */
import { test, expect, type Page } from '@playwright/test';
import { archiveProject, createProject, createRun, gotoApp, uniqueSlug } from '../helpers';
import { addMember, createApiKey, createUser } from './support';

async function actAs(page: Page, role: 'MEMBER' | 'MANAGER') {
  await page.route(/\/v1\/me$/, async (route) => {
    const res = await route.fetch();
    const me = (await res.json()) as { role: string; projects: { role: string }[] };
    me.role = 'MEMBER';
    me.projects = me.projects.map((p) => ({ ...p, role }));
    await route.fulfill({ response: res, json: me });
  });
}

test.describe('profile bootstrap token (D6, D7)', () => {
  test('is a password field and a second attempt is sent after a rejected first one', async ({ page }) => {
    await page.route('**/v1/me', async (route) => {
      const res = await route.fetch();
      const me = await res.json();
      await route.fulfill({ response: res, json: { ...me, role: 'MEMBER', can_bootstrap_admin: true } });
    });
    const posted: string[] = [];
    await page.route('**/v1/auth/bootstrap-admin', async (route) => {
      const token = route.request().postDataJSON().bootstrap_token as string;
      posted.push(token);
      if (token === 'wrong')
        await route.fulfill({ status: 403, json: { detail: 'Invalid bootstrap token' } });
      else await route.fulfill({ status: 409, json: { detail: 'An admin already exists.' } });
    });
    await gotoApp(page, '/profile');
    const panel = page.locator('[data-bootstrap-admin]');
    const field = panel.getByPlaceholder('Bootstrap token');
    await expect(field).toHaveAttribute('type', 'password');
    await field.fill('wrong');
    await field.press('Enter');
    await expect(panel.getByRole('alert')).toHaveText('Invalid bootstrap token');
    await field.fill('right');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await field.press('Enter');
    await expect.poll(() => posted).toEqual(['wrong', 'right']);
  });
});

test.describe('login (B5, B11, B14, B15, B19)', () => {
  test('provider buttons: one "Continue with", brand icon, description', async ({ page }) => {
    await page.route('**/v1/auth/providers', async (route) => {
      await route.fulfill({
        json: {
          providers: [
            { id: 'google', label: 'Continue with Google', enabled: true },
            { id: 'github', label: 'Continue with GitHub', enabled: true },
          ],
          local_auth: { enabled: true, signup_enabled: false },
        },
      });
    });
    await gotoApp(page, '/login');
    const google = page.locator('[data-provider="google"]');
    await expect(google).toContainText('Continue with Google');
    await expect(google).not.toContainText('Continue with Continue');
    await expect(google).toContainText('Use your Google identity to continue');
    await expect(google.locator('svg').first()).toBeVisible();
    await expect(page.locator('[data-provider="github"] svg').first()).toBeVisible();
  });

  test('sign-in hint and placeholders; the error clears as soon as the user types', async ({ page }) => {
    await page.route('**/v1/auth/providers', async (route) => {
      await route.fulfill({ json: { providers: [], local_auth: { enabled: true, signup_enabled: false } } });
    });
    await page.route('**/v1/auth/login/password**', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Invalid email or password' } });
    });
    await gotoApp(page, '/login');
    const form = page.locator('[data-password-form]');
    await expect(form.getByText('Forgot your password? Ask an admin to reset it.')).toBeVisible();
    await expect(form.getByPlaceholder('name@company.com')).toBeVisible();
    await form.getByPlaceholder('name@company.com').fill('a@b.co');
    await form.getByLabel(/^Password/).fill('nope-nope');
    await form.getByRole('button', { name: 'Sign in' }).click();
    await expect(form.getByRole('alert')).toHaveText('Invalid email or password');
    await form.getByLabel(/^Password/).pressSequentially('x');
    await expect(form.getByRole('alert')).toHaveCount(0);
  });

  test('the temporary password never reaches sessionStorage; a mismatch refocuses the confirm field', async ({
    page,
  }) => {
    await page.route('**/v1/auth/providers', async (route) => {
      await route.fulfill({ json: { providers: [], local_auth: { enabled: true, signup_enabled: false } } });
    });
    await page.route('**/v1/auth/login/password**', async (route) => {
      await route.fulfill({
        status: 403,
        json: { detail: 'Password change required', code: 'password_change_required' },
      });
    });
    await gotoApp(page, '/login');
    const form = page.locator('[data-password-form]');
    await form.getByPlaceholder('name@company.com').fill('t@e2e.local');
    await form.getByLabel(/^Password/).fill('temp-secret-1');
    await form.getByRole('button', { name: 'Sign in' }).click();
    const change = page.locator('[data-change-password-form]');
    await expect(change).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('temp-secret-1');
    await change.getByLabel(/^New password/).fill('longenough-1');
    const confirm = change.getByLabel(/^Confirm new password/);
    await confirm.fill('different-2');
    await change.getByRole('button', { name: 'Change password and sign in' }).click();
    await expect(change.getByRole('alert')).toHaveText('The passwords do not match.');
    await expect(confirm).toBeFocused();
    await confirm.pressSequentially('z');
    await expect(change.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('not-found pages (A25)', () => {
  test('"Back to projects" is a real link-button: Enter works from the keyboard', async ({ page }) => {
    await gotoApp(page, '/definitely-not-a-page');
    const back = page.getByRole('link', { name: 'Back to projects' });
    await expect(back).toBeVisible();
    await expect(page.locator('[data-not-found] button a')).toHaveCount(0);
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });

  test('"All projects" on a missing project is a link too', async ({ page }) => {
    await gotoApp(page, '/projects/no-such-project-xyz');
    const back = page.getByRole('link', { name: 'All projects' });
    await expect(back).toBeVisible();
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('project context on /compare and /reviews (A45)', () => {
  test('the sidebar and breadcrumb keep the last project', async ({ page, request }) => {
    const p = await createProject(request, 'Context Project', uniqueSlug('ctx'));
    await gotoApp(page, `/projects/${p.slug}`);
    await expect(page.locator('[data-nav="runs"]')).toBeVisible();
    for (const path of ['/compare', '/reviews']) {
      await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
      await gotoApp(page, path);
      await expect(page.locator('[data-project-switcher]')).toContainText('Context Project');
      await expect(page.locator('[data-nav="runs"]')).toBeVisible();
    }
    await gotoApp(page, '/compare');
    await expect(page.locator('[data-nav="runs"]')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('API keys revoke gating (E21)', () => {
  for (const role of ['MEMBER', 'MANAGER'] as const)
    test(`${role === 'MEMBER' ? 'a member sees no Revoke on keys others created' : 'a manager sees Revoke on any key'}`, async ({
      page,
      request,
    }) => {
      const p = await createProject(request, 'Revoke Gate', uniqueSlug('rg'));
      await createApiKey(request, p.id, 'ci-key');
      await page.route(`**/v1/projects/${p.id}/api-keys`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const body = (await res.json()) as { api_keys: object[] };
        await route.fulfill({
          response: res,
          json: {
            api_keys: body.api_keys.map((k) => ({
              ...k,
              creator: { id: 'someone-else', email: 'o@e2e', display_name: 'Other' },
            })),
          },
        });
      });
      await actAs(page, role);
      await gotoApp(page, `/projects/${p.slug}/settings?tab=apikeys`);
      const row = page.getByRole('row').filter({ hasText: 'ci-key' });
      await expect(row).toBeVisible();
      await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(role === 'MANAGER' ? 1 : 0);
    });
});

test.describe('LLM connection form (E31, E29)', () => {
  test('editing B after A shows B, not A', async ({ page, request }) => {
    test.skip(!process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY, 'needs QYM_LLM_CONFIG_ENCRYPTION_KEY');
    const p = await createProject(request, 'LLM Key', uniqueSlug('llmk'));
    for (const [name, model] of [
      ['first', 'm-one'],
      ['second', 'm-two'],
    ] as const) {
      const res = await request.post(`/v1/projects/${p.id}/llm-connections`, {
        data: {
          name,
          llm_base_url: 'https://api.example.com/v1',
          llm_model: model,
          llm_api_key: 'sk-test',
          available_for_experiments: true,
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    await gotoApp(page, `/projects/${p.slug}/settings?tab=llm`);
    const form = page.locator('[data-llm-form]');
    await page.getByRole('row').filter({ hasText: 'first' }).getByRole('button', { name: 'Edit' }).click();
    await expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue('first');
    await page.getByRole('row').filter({ hasText: 'second' }).getByRole('button', { name: 'Edit' }).click();
    await expect(form.getByText('Edit “second”')).toBeVisible();
    await expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue('second');
    await expect(form.getByRole('textbox', { name: /^Model/ })).toHaveValue('m-two');
  });

  test('a failing "Set default" shows a toast', async ({ page, request }) => {
    test.skip(!process.env.QYM_LLM_CONFIG_ENCRYPTION_KEY, 'needs QYM_LLM_CONFIG_ENCRYPTION_KEY');
    const p = await createProject(request, 'LLM Default', uniqueSlug('llmd'));
    for (const name of ['one', 'two']) {
      const res = await request.post(`/v1/projects/${p.id}/llm-connections`, {
        data: {
          name,
          llm_base_url: 'https://api.example.com/v1',
          llm_model: 'm',
          llm_api_key: 'sk-test',
          available_for_experiments: true,
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    await page.route('**/set-default', (route) =>
      route.fulfill({ status: 400, json: { detail: 'Cannot set default right now' } }),
    );
    await gotoApp(page, `/projects/${p.slug}/settings?tab=llm`);
    // Set default lives in the row's overflow menu (only non-default rows offer it).
    const second = page.getByRole('row').filter({ hasText: 'two' });
    await second.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: /^Set two as default/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Cannot set default right now' })).toBeVisible();
  });
});

test.describe('remove-member dialog (E17)', () => {
  test('counts deleted runs, lists the keys that go, offers the transfer', async ({ page, request }) => {
    const p = await createProject(request, 'Remove Dialog', uniqueSlug('rd'));
    const tag = uniqueSlug('u');
    const dana = await createUser(request, `dana-${tag}@e2e.local`, `Dana ${tag}`);
    const sam = await createUser(request, `sam-${tag}@e2e.local`, `Sam ${tag}`);
    await addMember(request, p.id, dana.id);
    await addMember(request, p.id, sam.id);
    await createApiKey(request, p.id, 'danas-key');
    await page.route(`**/v1/projects/${p.id}/api-keys`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { api_keys: object[] };
      await route.fulfill({
        response: res,
        json: {
          api_keys: body.api_keys.map((k) => ({
            ...k,
            creator: { id: dana.id, email: dana.email, display_name: 'Dana' },
          })),
        },
      });
    });
    await page.route(`**/members/${dana.id}/removal-preview`, (route) =>
      route.fulfill({
        json: { project_id: p.id, user_id: dana.id, owned_runs: 0, owned_deleted_runs: 2 },
      }),
    );
    await gotoApp(page, `/projects/${p.slug}/settings?tab=members`);
    await page
      .getByRole('row')
      .filter({ hasText: dana.email })
      .getByRole('button', { name: 'Remove' })
      .click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('owns 2 runs in this project, 2 of them in Deleted Runs.');
    await expect(dialog).toContainText('danas-key');
    await expect(dialog.getByRole('button', { name: 'Transfer their runs to' })).toBeVisible();
    await page.keyboard.press('Escape');
    // archived: no transfer offer
    await archiveProject(request, p.id);
    await gotoApp(page, `/projects/${p.slug}/settings?tab=members`);
    await page
      .getByRole('row')
      .filter({ hasText: dana.email })
      .getByRole('button', { name: 'Remove' })
      .click();
    const archived = page.getByRole('alertdialog');
    await expect(archived).toContainText('until then they stay owned by');
    await expect(archived.getByRole('button', { name: 'Transfer their runs to' })).toHaveCount(0);
  });
});

test.describe('projects, switcher and chrome', () => {
  test('cards say "1 run" / "1 member" in the singular', async ({ page, request }) => {
    const p = await createProject(request, 'Singular Card', uniqueSlug('sg'));
    const token = (
      await (await request.post(`/v1/projects/${p.id}/api-keys`, { data: { name: 'k' } })).json()
    ).token;
    await createRun(request, token, { name: 'only-run', items: 2 });
    await gotoApp(page, '/');
    const card = page.locator(`[data-project-card="${p.slug}"]`);
    await expect(card).toContainText(/1\s*run(?!s)/);
    await expect(card).toContainText(/1\s*member(?!s)/);
  });

  test('one Escape closes the project switcher even with text typed', async ({ page, request }) => {
    const p = await createProject(request, 'Switch Esc', uniqueSlug('esc'));
    await gotoApp(page, `/projects/${p.slug}`);
    await page.locator('[data-project-switcher]').click();
    const search = page.getByRole('searchbox', { name: 'Search projects' });
    await search.fill('sw');
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);
  });

  for (const width of [768, 900]) {
    test(`topbar breadcrumb and stats do not overlap at ${width}px`, async ({ page, request }) => {
      const p = await createProject(request, 'A Rather Long Project Name', uniqueSlug('tb'));
      await page.setViewportSize({ width, height: 800 });
      await gotoApp(page, `/projects/${p.slug}`);
      const crumb = await page.locator('nav[aria-label="Breadcrumb"]').boundingBox();
      const end = await page.locator('[data-topbar] > div').last().boundingBox();
      expect(crumb).not.toBeNull();
      expect(end).not.toBeNull();
      expect(crumb!.x + crumb!.width).toBeLessThanOrEqual(end!.x + 1);
    });
  }

  test('an archived project shows the banner and switcher tag, not a third topbar tag', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Archived Signals', uniqueSlug('as'));
    await archiveProject(request, p.id);
    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    await expect(page.locator('[data-topbar]').getByText('Read-only')).toHaveCount(0);
    await expect(page.locator('[data-archived-settings-note]')).toContainText(
      'read-only while the project is archived',
    );
  });

  test('the sidebar brand is the logo image', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.locator('[data-sidebar] a[title="Projects"] img').first()).toBeVisible();
  });
});

test.describe('create project dialog (C7)', () => {
  test('an Arabic name previews the slug the server will use', async ({ page }) => {
    await gotoApp(page, '/');
    await page
      .getByRole('button', { name: /Create project|New project/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Create project' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('مشروع');
    await expect(dialog.getByRole('textbox', { name: /^Slug/ })).toHaveValue('project');
  });
});

test.describe('review rules for plain members (E9)', () => {
  test('are shown read-only', async ({ page, request }) => {
    const p = await createProject(request, 'Rules RO', uniqueSlug('rro'));
    await actAs(page, 'MEMBER');
    await gotoApp(page, `/projects/${p.slug}/settings`);
    await expect(page.getByText('Correction review rules')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save rules' })).toHaveCount(0);
    await expect(page.getByText('Only project managers can change these rules.')).toBeVisible();
  });
});
