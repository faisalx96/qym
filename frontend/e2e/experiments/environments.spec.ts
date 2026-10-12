/**
 * Brief 06 §2.9 + scenario 10: environments list, add dialog (success + server error), the
 * environment page (slot editor, test connection, schema refresh, moved-URL rule, delete),
 * "Run default preset" and the settings Environments tab deep links.
 */
import { expect, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  createEnvironment,
  expPath,
  experimentSpec,
  launchExperiment,
  publishDefaultPreset,
  resetFakes, test,
  saveSavedPreset,
  seedProject,
  setFakeHealth,
  stopExperiment,
} from './support';
import { expectToast, pickSelect } from './ui';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

const envsPath = (slug: string, tail = '') => `/projects/${slug}/environments${tail}`;
const grid = (page: Page) => page.getByRole('grid', { name: 'Environments' });
const settingsPath = (slug: string, q: string) => `/projects/${slug}/settings?tab=environments${q}`;

test.describe('environments list', () => {
  test('rows show URL, health, schema, grouping, default preset and cap; Test reports health', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'envlist');
    const staging = await createEnvironment(request, project.id, 'staging');
    const loose = await createEnvironment(request, project.id, 'ungrouped', {
      confirmSlots: false,
      maxPriority: 'NORMAL',
    });
    await publishDefaultPreset(request, project.id, staging.id, experimentSpec(connectionId));

    await gotoApp(page, envsPath(project.slug));
    await expect(page).toHaveTitle(/Environments/);
    const row = (name: string) => grid(page).getByRole('row').filter({ hasText: name });
    await expect(row('staging')).toContainText(staging.url);
    await expect(row('staging')).toContainText('Grouped');
    await expect(row('staging')).toContainText('v1');
    await expect(row('staging')).toContainText('HIGH');
    await expect(row('ungrouped')).toContainText('Needs grouping');
    await expect(row('ungrouped')).toContainText('NORMAL');
    // only an environment with a default preset offers the one-click launch
    await expect(
      row('staging').getByRole('button', { name: /Run default preset v1 on staging/ }),
    ).toBeVisible();
    await expect(row('ungrouped').getByRole('button', { name: /Run default preset/ })).toHaveCount(0);

    await row('staging').getByRole('button', { name: 'Test staging' }).click();
    await expectToast(page, '“staging” is healthy');
    await setFakeHealth(request, true, FAKE_A);
    await row('ungrouped').getByRole('button', { name: 'Test ungrouped' }).click();
    await expectToast(page, /“ungrouped” failed/);
    await expect(row('ungrouped').getByText('Error')).toBeVisible();

    await row('ungrouped').getByRole('button', { name: 'Manage ungrouped' }).click();
    await expect(page).toHaveURL(new RegExp(`/environments/${loose.id}$`));
    await expect(page.locator('[data-environment-page]')).toBeVisible();
  });

  test('empty project: empty state with the add action', async ({ page, request }) => {
    const { project } = await seedProject(request, 'envempty');
    await gotoApp(page, envsPath(project.slug));
    await expect(page.getByText('No environments yet')).toBeVisible();
    await page.getByRole('button', { name: '+ Add environment' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Add environment' })).toBeVisible();
  });
});

test.describe('add environment', () => {
  test('a bad URL shows the server error on step 1 and nothing is created', async ({ page, request }) => {
    const { project } = await seedProject(request, 'envbad');
    await gotoApp(page, envsPath(project.slug));
    await page.getByRole('button', { name: '+ Add environment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add environment' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('broken');
    await dialog.getByRole('textbox', { name: /^Base URL/ }).fill('http://127.0.0.1:9/nothing-here');
    await dialog.getByLabel(/^API key/).fill('some-key');
    await dialog.getByRole('button', { name: 'Test & connect' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toBeEmpty();
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Connect' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const list = await (await request.get(`/v1/projects/${project.id}/eval-environments`)).json();
    expect(JSON.stringify(list)).not.toContain('broken');

    // required fields are checked before any request is made
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('');
    await dialog.getByRole('button', { name: 'Test & connect' }).click();
    await expect(dialog.getByText('Enter a name.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('aria-invalid', 'true');
  });

  test('connect, review the generated form, group the LLM settings, confirm', async ({ page, request }) => {
    const { project } = await seedProject(request, 'envadd');
    await gotoApp(page, envsPath(project.slug));
    await page.getByRole('button', { name: '+ Add environment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add environment' });
    const url = `http://127.0.0.1:${FAKE_A}/${uniqueSlug('added')}`;
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('added env');
    await dialog.getByRole('textbox', { name: /^Base URL/ }).fill(url);
    const key = dialog.getByLabel(/^API key/);
    await expect(key).toHaveAttribute('type', 'password');
    await key.fill('typed-secret-key-1');
    await dialog.getByRole('button', { name: 'Test & connect' }).click();

    await expectToast(page, 'Connected “added env”');
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Review settings' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(dialog.getByText('“added env” is saved.')).toBeVisible();
    // the read-only preview opens its first group
    await expect(dialog.locator('details').first()).toHaveAttribute('open', '');
    await expect(dialog.locator('details[open]')).toHaveCount(1);
    // the typed key is not kept anywhere in the page
    expect(await page.content()).not.toContain('typed-secret-key-1');
    const created = await (await request.get(`/v1/projects/${project.id}/eval-environments`)).json();
    expect(JSON.stringify(created)).toContain('added env');
    expect(JSON.stringify(created)).not.toContain('typed-secret-key-1');

    await dialog.getByRole('button', { name: 'Next: group LLM settings' }).click();
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Group LLM settings' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(dialog.locator('[data-slot-key]').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expectToast(page, 'LLM settings grouped for “added env”');
    await expect(dialog).toBeHidden();
    await expect(grid(page).getByRole('row').filter({ hasText: 'added env' })).toContainText('Grouped');
  });

  test('closing after the connect step keeps the saved environment; Skip says how to group later', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'envskip');
    await gotoApp(page, envsPath(project.slug));
    await page.getByRole('button', { name: '+ Add environment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add environment' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('skipper');
    await dialog
      .getByRole('textbox', { name: /^Base URL/ })
      .fill(`http://127.0.0.1:${FAKE_B}/${uniqueSlug('skip')}`);
    await dialog.getByLabel(/^API key/).fill('k-1');
    await dialog.getByRole('button', { name: 'Test & connect' }).click();
    await dialog.getByRole('button', { name: 'Next: group LLM settings' }).click();
    await dialog.getByRole('button', { name: 'Skip for now' }).click();
    await expectToast(page, /“skipper” saved\. Group its LLM settings from the environment page\./);
    await expect(grid(page).getByRole('row').filter({ hasText: 'skipper' })).toContainText('Needs grouping');
  });
});

test.describe('environment page', () => {
  test('sections, test connection, refresh schema, and a bad URL is mapped to its field', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'envpage');
    const env = await createEnvironment(request, project.id, 'staging');
    await gotoApp(page, envsPath(project.slug, `/${env.id}`));
    await expect(page.getByRole('heading', { name: 'staging', level: 1 })).toBeVisible();
    // Experiments / Environments / <name>
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Experiments' })).toBeVisible();
    await expect(trail.getByRole('link', { name: 'Environments' })).toBeVisible();
    await expect(trail.getByText('staging')).toHaveAttribute('aria-current', 'page');
    for (const title of [
      'Status',
      'Schema',
      'LLM model groups',
      'Presets',
      'Ranking',
      'Policies',
      'Connection',
    ]) {
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
    }
    const status = page.locator('[data-section="env-status"]');
    await expect(status).toContainText('Active');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expectToast(page, '“staging” is healthy');

    const schema = page.locator('[data-section="env-schema"]');
    await schema.getByRole('button', { name: 'Refresh schema' }).click();
    await expect(schema.getByText(/Schema unchanged/)).toBeVisible();

    await page.getByRole('textbox', { name: 'Base URL' }).fill('ftp://not-allowed.example.com');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    const saved = await (await request.get(`/v1/projects/${project.id}/eval-environments/${env.id}`)).json();
    expect(JSON.stringify(saved)).toContain(env.url);
    // the server's reason sits on the Base URL field, not in a generic banner
    await expect(page.getByRole('textbox', { name: 'Base URL' })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-section="env-connection"]').getByRole('alert')).toHaveCount(0);
  });

  test('editing policies saves; a moved URL turns connection keys off unless ticked again', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'envkeys');
    const env = await createEnvironment(request, project.id, 'staging');
    const other = `http://127.0.0.1:${FAKE_A}/${uniqueSlug('moved')}`;
    await gotoApp(page, envsPath(project.slug, `/${env.id}`));
    const keys = page.getByText('Allow connection keys');
    const box = page.getByRole('checkbox', { name: 'Allow connection keys' });
    await expect(box).toBeChecked();
    const base = page.getByRole('textbox', { name: 'Base URL' });

    await base.fill(other);
    await expect(box).not.toBeChecked();
    await expect(page.locator('[data-keys-help]')).toContainText('Turned off because the URL changed');
    await base.fill(env.url);
    await expect(box).toBeChecked();
    await base.fill(other);
    await keys.click(); // explicit re-opt-in for the new host
    await expect(box).toBeChecked();

    const bodies: Record<string, unknown>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith(`/eval-environments/${env.id}`))
        bodies.push(r.postDataJSON() as Record<string, unknown>);
    });
    await pickSelect(page, 'Default priority', 'LOW');
    await page.getByRole('textbox', { name: 'Ranking metric' }).fill('exact_match');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expectToast(page, 'Saved “staging”');
    expect(bodies[0]).toMatchObject({
      base_url: other,
      allow_connection_keys: true,
      default_priority: 'LOW',
      ranking_metric: 'exact_match',
    });
    const after = (await (
      await request.get(`/v1/projects/${project.id}/eval-environments/${env.id}`)
    ).json()) as Record<string, unknown>;
    expect(after.base_url).toBe(other);
    expect(after.allow_connection_keys).toBe(true);

    // moving again without touching the box omits the flag, so the backend turns keys off
    const third = `http://127.0.0.1:${FAKE_A}/${uniqueSlug('moved2')}`;
    bodies.length = 0;
    await base.fill(third);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expectToast(page, 'Saved “staging”');
    expect(bodies[0]).not.toHaveProperty('allow_connection_keys');
    const final = (await (
      await request.get(`/v1/projects/${project.id}/eval-environments/${env.id}`)
    ).json()) as Record<string, unknown>;
    expect(final.allow_connection_keys).toBe(false);
  });

  test('slot editor: rename a group and save; a 422 lands on the card', async ({ page, request }) => {
    const { project } = await seedProject(request, 'envslots');
    const env = await createEnvironment(request, project.id, 'staging');
    await gotoApp(page, envsPath(project.slug, `/${env.id}`));
    const section = page.locator('[data-section="env-slots"]');
    await expect(section).toContainText('endpoint:primary');
    await section.getByRole('button', { name: 'Edit groups' }).click();
    const dialog = page.getByRole('dialog', { name: /LLM model groups · staging/ });
    const name = dialog.getByRole('textbox', { name: 'Name of group endpoint:primary' });
    await name.fill('Primary model');

    // server-side validation errors are placed on the group they are about
    await page.route('**/model-slots', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({
              detail: { errors: [{ slot_key: 'endpoint:primary', message: 'Pointer belongs to two slots' }] },
            }),
          })
        : route.fallback(),
    );
    await dialog.getByRole('button', { name: 'Save groups' }).click();
    await expect(dialog.locator('[data-slot-key="endpoint:primary"]').getByRole('alert')).toContainText(
      'Pointer belongs to two slots',
    );
    await page.unroute('**/model-slots');

    await dialog.getByRole('button', { name: 'Save groups' }).click();
    await expectToast(page, 'LLM model groups saved for “staging”');
    await expect(dialog).toBeHidden();
    await expect(section.getByText('Primary model')).toBeVisible();
    const slots = await (
      await request.get(`/v1/projects/${project.id}/eval-environments/${env.id}/model-slots`)
    ).json();
    expect(JSON.stringify(slots)).toContain('Primary model');
  });

  test('delete: an unused environment goes away; one used by an experiment is only disabled', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'envdel');
    const unused = await createEnvironment(request, project.id, 'unused');
    const used = await createEnvironment(request, project.id, 'used');
    await launchExperiment(request, project.id, {
      name: 'uses env',
      environment_ids: [used.id],
      spec: experimentSpec(connectionId),
    });

    await gotoApp(page, envsPath(project.slug, `/${unused.id}`));
    await page.getByRole('button', { name: 'Delete environment' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading', { name: 'Delete environment?' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await page.getByRole('button', { name: 'Delete environment' }).click();
    await confirm.getByRole('button', { name: 'Delete environment' }).click();
    await expectToast(page, 'Deleted “unused”');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/environments$`));
    await expect(grid(page).getByRole('row').filter({ hasText: 'unused' })).toHaveCount(0);

    await grid(page).getByRole('button', { name: 'Manage used' }).click();
    await page.getByRole('button', { name: 'Delete environment' }).click();
    await confirm.getByRole('button', { name: 'Delete environment' }).click();
    await expectToast(page, '“used” is in use, so it was disabled');
    await expect(grid(page).getByRole('row').filter({ hasText: 'used' })).toContainText('Disabled');
  });
});

test.describe('run default preset', () => {
  test('one click launches the preset and opens the experiment', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'envrun');
    const env = await createEnvironment(request, project.id, 'staging');
    await publishDefaultPreset(request, project.id, env.id, experimentSpec(connectionId));
    await saveSavedPreset(request, project.id, env.id, 'Fast timeouts', experimentSpec(connectionId, 15));
    await gotoApp(page, envsPath(project.slug));
    await grid(page)
      .getByRole('button', { name: /Run default preset v1 on staging/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/experiments/[0-9a-f-]{36}$`));
    await expectToast(page, 'Launched default preset v1 on “staging”');
    await expect(page.getByRole('heading', { name: /staging · default preset v1/ })).toBeVisible();
    await expect(page.locator('[data-exp-matrix]')).toBeVisible();
  });

  test('a HIGH default asks for the preemption acknowledgement first', async ({ page, request }) => {
    const { project, connectionId } = await seedProject(request, 'envhigh');
    const env = await createEnvironment(request, project.id, 'staging');
    await publishDefaultPreset(request, project.id, env.id, experimentSpec(connectionId));
    const upd = await request.put(`/v1/projects/${project.id}/eval-environments/${env.id}`, {
      data: { default_priority: 'HIGH' },
    });
    expect(upd.ok()).toBeTruthy();
    const posts: Record<string, unknown>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/experiments'))
        posts.push(r.postDataJSON() as Record<string, unknown>);
    });
    await gotoApp(page, envsPath(project.slug));
    await grid(page)
      .getByRole('button', { name: /Run default preset/ })
      .click();
    const ask = page.getByRole('alertdialog');
    await expect(ask.getByRole('heading', { name: 'Launch at HIGH priority?' })).toBeVisible();
    await ask.getByRole('button', { name: 'Don’t launch' }).click();
    await expect(ask).toBeHidden();
    expect(posts).toHaveLength(0);
    await grid(page)
      .getByRole('button', { name: /Run default preset/ })
      .click();
    await ask.getByRole('button', { name: 'Launch at HIGH' }).click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
    expect(posts[0]).toMatchObject({ acknowledge_preemption: true });
    // a live HIGH job would block every other priority on the shared fake service
    await stopExperiment(request, project.id, page.url().split('/').pop()!);
  });

  test('a default preset that cannot launch as is opens the launch form with a reason', async ({
    page,
    request,
  }) => {
    const { project, connectionId } = await seedProject(request, 'envblock');
    const env = await createEnvironment(request, project.id, 'staging');
    // no dataset in the preset: the one-click launch has nothing to run on
    const noDataset = { ...experimentSpec(connectionId), evaluator: { config: { samples: 2 } } };
    const pub = await request.post(`/v1/projects/${project.id}/eval-environments/${env.id}/presets`, {
      data: { kind: 'official', name: 'Default', config: noDataset, notes: 'no dataset' },
    });
    test.skip(!pub.ok(), 'the platform refuses a default preset without a dataset');
    await gotoApp(page, envsPath(project.slug));
    await grid(page)
      .getByRole('button', { name: /Run default preset/ })
      .click();
    await expectToast(page, /does not name a dataset; pick one\. Opening the launch form\./);
    await expect(page).toHaveURL(new RegExp(`/experiments/new\\?env=${env.id}&base=default`));
  });
});

test.describe('settings Environments tab', () => {
  test('lists the same environments and opens the drawer from ?env=', async ({ page, request }) => {
    const { project } = await seedProject(request, 'envset');
    const env = await createEnvironment(request, project.id, 'staging');
    await gotoApp(page, settingsPath(project.slug, ''));
    await expect(page.locator('[data-environments-panel]')).toBeVisible();
    await grid(page).getByRole('button', { name: 'Manage staging' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('env')).toBe(env.id);
    const drawer = page.getByRole('dialog', { name: /staging/ });
    await expect(drawer.locator(`[data-env-body="${env.id}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('env')).toBeNull();

    // deep link straight to the drawer
    await gotoApp(page, settingsPath(project.slug, `&env=${env.id}`));
    await expect(page.locator(`[data-env-body="${env.id}"]`)).toBeVisible();
  });

  test('?env=&promote=&id= hands off to the default preset editor of that environment', async ({
    page,
    request,
  }) => {
    const { project } = await seedProject(request, 'envpromote');
    const env = await createEnvironment(request, project.id, 'staging');
    await gotoApp(page, settingsPath(project.slug, `&env=${env.id}&promote=run&id=some-run`));
    await expect(page).toHaveURL(
      new RegExp(`/environments/${env.id}/default-preset/edit\\?promote=run&id=some-run`),
    );
    // the handoff replaced the history entry: Back leaves the settings page instead of looping
    await page.goBack();
    await expect(page).not.toHaveURL(/default-preset/);
    void expPath;
  });
});
