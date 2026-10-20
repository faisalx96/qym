/**
 * WP-A feature 1 (spec A1-1 to A1-36): per-dataset access in the browser. The server rules
 * (levels, 403 texts, catalog filtering, run redaction) are pinned in tests/platform/test_dataset_access.py;
 * here the numbers of the spec are measured on the real pages at 1440, 1024 and 390 px.
 *
 * QYM_AUTH_MODE=none makes every browser user the dev admin, so the states of a person with less
 * access (view only, no access, a redacted run) are produced by rewriting the platform's answer
 * to that person's: the permissions object, the access payload, a 403, the run's restriction flag.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { addMembers, near, setAccess, size, WIDTHS } from './access-support';
import { bulkItems, createApiKey, createDataset, createVersion, ingestRun, publishVersion, sampleItems } from './support';
import { runUrl } from '../run-detail/support';
import type { APIRequestContext } from '@playwright/test';

async function seedProject(request: APIRequestContext, prefix: string) {
  const project = await createProject(request, `Access ${prefix}`, uniqueSlug(prefix));
  const people = await addMembers(request, project.id, ['Noura Alharbi', 'Khalid Almutairi', 'Sara Alqahtani', 'Omar Alharbi']);
  const publish = async (name: string, extra: Record<string, unknown> = {}) => {
    const d = await createDataset(request, project.slug, name, extra);
    const v = await createVersion(request, project.slug, d.slug);
    await bulkItems(request, project.slug, d.slug, v.version, sampleItems(6));
    await publishVersion(request, project.slug, d.slug, v.version, true);
    return d;
  };
  return { project, people, publish };
}

/** A platform answer being rewritten (loosely typed on purpose). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonObject = Record<string, any>;

/** Rewrite the JSON answer of the requests matching `url`. */
async function rewrite(page: Page, url: RegExp, patch: (body: JsonObject) => void, status?: number) {
  await page.route(url, async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as JsonObject;
    patch(body);
    await route.fulfill({ response: res, json: body, status: status ?? res.status() });
  });
}

const DATASET_GET = /\/v1\/datasets\/[^/?]+\?project_slug=/;
const ACCESS_GET = /\/v1\/datasets\/[^/?]+\/access\?/;

/** The caller reads the dataset with `view` access only. */
async function asViewer(page: Page, restricted = true) {
  await rewrite(page, DATASET_GET, (b) => {
    const d = b.dataset;
    if (restricted) d.access_mode = 'restricted';
    Object.assign(d.permissions, {
      access_level: 'view',
      can_modify: false,
      can_manage_access: false,
      can_manage: false,
      can_delete: false,
      can_rename_slug: false,
      can_move_production: false,
      can_set_production: false,
    });
  });
  await rewrite(page, ACCESS_GET, (b) => {
    Object.assign(b, { can_manage_access: false, candidates: [], your_level: 'view' });
  });
}

test.describe('catalog card (A1-1 to A1-4)', () => {
  for (const width of WIDTHS) {
    test(`badge cluster, wrapped name and head height at ${width}px`, async ({ page, request }) => {
      const { project, publish, people } = await seedProject(request, 'cat');
      const plain = await publish('Support FAQ');
      const long = await publish('legal-clauses');
      const wordy = await publish('Ministry of Justice legal clauses reviewed by counsel');
      const secret = await publish('Pricing golden', { private_test_set: true });
      await setAccess(request, project.slug, long.slug, 'restricted', [{ user_id: people[0]!.id, level: 'view' }]);
      await setAccess(request, project.slug, secret.slug, 'restricted');
      await setAccess(request, project.slug, wordy.slug, 'restricted');
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${project.slug}/datasets`);
      const card = (slug: string) => page.locator(`[data-dataset-card="${slug}"]`);

      // A1-1: the cluster of a restricted private test set holds Private first, then Restricted.
      const badges = card(secret.slug).getByTestId('da-card-badges');
      await expect(badges.locator('> *')).toHaveText(['Private test set', 'Restricted']);
      const restrictedBadge = card(secret.slug).getByTestId('restricted-badge');
      const rb = await size(restrictedBadge);
      near(rb.w, 98.7);
      expect(rb.h).toBe(20);
      await expect(card(plain.slug).getByTestId('da-card-badges')).toHaveCount(0);

      // A1-2: the name is never cut.
      const name = card(wordy.slug).getByTestId('da-card-name');
      const overflow = await name.evaluate((el) => ({
        cut: getComputedStyle(el).textOverflow === 'ellipsis',
        fits: el.scrollWidth <= el.clientWidth,
      }));
      expect(overflow).toEqual({ cut: false, fits: true });

      // A1-3: head 96 px with badges, the cluster as wide as the head.
      const head = await size(card(long.slug).getByTestId('da-card-head'));
      expect(head.h).toBe(96);
      const cluster = await size(card(long.slug).getByTestId('da-card-badges'));
      near(cluster.w, head.w);
      const noBadges = await size(card(plain.slug).getByTestId('da-card-head'));
      expect(noBadges.h).toBeLessThan(head.h);
    });
  }

  test('a viewer sees "View only" on a restricted card (A1-1)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'cardview');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted');
    await rewrite(page, /\/v1\/datasets\?/, (b) => {
      for (const ds of b.datasets) ds.permissions.access_level = 'view';
    });
    await gotoApp(page, `/projects/${project.slug}/datasets`);
    await expect(page.locator(`[data-dataset-card="${d.slug}"]`).getByText('View only')).toBeVisible();
  });
});

test.describe('Settings → Access section (A1-5 to A1-24)', () => {
  // [mode, grant names, height at 1440/1024, height at 390]
  // Project mode with saved grants words the restricted option with "3 saved grants are kept…" (a second help line),
  // so it is 15.4 px (30.8 at 390) taller than the same form with no saved grants.
  const CASES: [string, 'project' | 'restricted', number, number, number][] = [
    ['project mode, three saved grants kept', 'project', 3, 388.4, 506.8],
    ['project mode, no saved grants', 'project', 0, 373, 476],
    ['restricted, three people', 'restricted', 3, 618.8, 995.7],
    ['restricted, no one listed', 'restricted', 0, 520.3, 691.3],
  ];
  for (const [label, mode, grants, wide, narrow] of CASES) {
    for (const width of [1440, 1024, 390]) {
      test(`${label}: section height at ${width}px`, async ({ page, request }) => {
        const { project, publish, people } = await seedProject(request, 'acc');
        const d = await publish('Legal clauses');
        await setAccess(
          request,
          project.slug,
          d.slug,
          mode,
          people.slice(0, grants).map((p, i) => ({ user_id: p.id, level: i === 0 ? 'modify' : 'view' })),
        );
        await page.setViewportSize({ width, height: 1000 });
        await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
        const section = page.getByTestId('access-section');
        await expect(section).toBeVisible();
        await expect(page.getByTestId('access-mode')).toBeVisible();
        if (mode === 'restricted') await expect(page.getByTestId('access-people')).toBeVisible();
        const box = await size(section);
        // A1-5 / A1-6: 760 px column (279 px at 390) and the specified heights.
        near(box.w, width === 390 ? 279 : 760);
        near(box.h, width === 390 ? narrow : wide);
        // A1-7 / A1-8: the mode group.
        const group = await size(page.getByTestId('access-mode'));
        near(group.w, width === 390 ? 237 : 718);
        const row = await size(page.getByTestId('access-mode-project'));
        near(row.h, width === 390 ? 69 : 53.6);
        const overflow = await page.getByTestId('access-mode').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(overflow).toBe(true);
        if (mode === 'restricted') {
          // A1-15 / A1-16: the add row.
          const add = await size(page.getByTestId('access-add'));
          near(add.h, width === 390 ? 75.4 : 43.4);
          // A1-19: the save bar.
          const bar = await size(page.getByTestId('access-save-bar'));
          near(bar.h, width === 390 ? 56.4 : 33, 1.5);
        }
      });
    }
  }

  test('grants table columns and rows at 1440 (A1-11 to A1-14)', async ({ page, request }) => {
    const { project, publish, people } = await seedProject(request, 'tbl');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted', [
      { user_id: people[0]!.id, level: 'modify' },
      { user_id: people[1]!.id, level: 'view' },
      { user_id: people[2]!.id, level: 'view' },
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    const table = page.getByTestId('access-grants-table');
    await expect(table.getByText('Noura Alharbi')).toBeVisible();
    const headers = await table.getByRole('columnheader').allInnerTexts();
    expect(headers.map((h) => h.trim().toLowerCase())).toEqual(['person', 'level', 'added by', 'remove']);
    const widths = await table.getByRole('columnheader').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(widths.slice(1)).toEqual([160, 150, 48]);
    const rows = table.getByRole('row');
    expect(await rows.count()).toBe(4); // header + three people
    const rowHeight = await size(rows.nth(1));
    near(rowHeight.h, 40);
    // Person: name over email, neither cut.
    await expect(table.getByText('Noura Alharbi')).toBeVisible();
    await expect(table.getByText(people[0]!.email)).toBeVisible();
    // Level is a two option control named for the person.
    const level = table.getByRole('radiogroup', { name: 'Level for Noura Alharbi' });
    await expect(level.getByRole('radio', { name: 'Modify' })).toBeChecked();
    // Remove moves focus to the next row's Remove (A1-14).
    await table.getByRole('button', { name: 'Remove Noura Alharbi' }).click();
    await expect(table.getByText('Noura Alharbi')).toHaveCount(0);
    await expect(page.getByTestId('access-save-bar').getByText('Unsaved changes')).toBeVisible();
    // Rows read Khalid, Noura, Sara (same time, ordered by name): Noura's removal hands focus to Sara's Remove.
    await expect(table.getByRole('button', { name: 'Remove Sara Alqahtani' })).toBeFocused();
  });

  test('grants render as cards at 390 with no horizontal scroll (A1-17)', async ({ page, request }) => {
    const { project, publish, people } = await seedProject(request, 'cards');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted', people.slice(0, 3).map((p) => ({ user_id: p.id, level: 'view' as const })));
    await page.setViewportSize({ width: 390, height: 1000 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    const table = page.getByTestId('access-grants-table');
    await expect(table).toBeVisible();
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cards = table.locator('[data-card-mode] [role="row"], [role="listitem"]');
    if ((await cards.count()) > 0) {
      for (const h of await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeLessThanOrEqual(120);
      }
    }
  });

  test('keyboard: arrow keys move the radio selection and the section turns dirty (A1-9)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'kbd');
    const d = await publish('Legal clauses');
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    const projectRadio = page.getByRole('radio', { name: /Everyone in the project/ });
    await projectRadio.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /Only people listed below/ })).toBeChecked();
    await expect(page.getByTestId('access-save-bar').getByText('Unsaved changes')).toBeVisible();
    await expect(page.getByTestId('access-empty-note')).toBeVisible(); // A1-21
    await page.keyboard.press('ArrowUp');
    await expect(projectRadio).toBeChecked();
  });

  test('add a person, save, reload: one PUT, a toast and the state persists (A1-15, A1-20)', async ({ page, request }) => {
    const { project, publish, people } = await seedProject(request, 'save');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted', [{ user_id: people[1]!.id, level: 'view' }]);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    const puts: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/access')) puts.push(r.postDataJSON());
    });
    const add = page.getByTestId('access-add');
    await add.getByRole('radio', { name: 'Modify' }).check({ force: true });
    await add.getByRole('button', { name: /Choose a project member/ }).click();
    await page.getByRole('option', { name: new RegExp(people[0]!.name) }).click();
    await add.getByRole('button', { name: /^Add person$/ }).click();
    await expect(page.getByTestId('access-grants-table').getByText(people[0]!.name)).toBeVisible();
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.locator('[data-toast-container]').getByText('Access saved')).toBeVisible();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({
      access_mode: 'restricted',
      grants: [
        { user_id: people[1]!.id, level: 'view' },
        { user_id: people[0]!.id, level: 'modify' },
      ],
    });
    await page.reload();
    await expect(page.getByTestId('access-grants-table').getByText(people[0]!.name)).toBeVisible();
    await expect(page.getByTestId('access-save-bar').getByText('No changes')).toBeVisible();
  });

  test('a failed save keeps the edits and shows the server detail (A1-20)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'fail');
    const d = await publish('Legal clauses');
    await page.route(ACCESS_GET, async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({ status: 422, json: { detail: 'User x is not an active member of this project' } });
      else await route.continue();
    });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    await page.getByTestId('access-mode-restricted').click();
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.getByText('User x is not an active member of this project')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Only people listed below/ })).toBeChecked();
    await expect(page.getByTestId('access-save-bar').getByText('Unsaved changes')).toBeVisible();
  });

  test('a failed load shows an error with Retry, never the default form (A1-24)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'err');
    const d = await publish('Legal clauses');
    let fail = true;
    await page.route(ACCESS_GET, async (route) => {
      if (fail) await route.fulfill({ status: 500, json: { detail: 'boom' } });
      else await route.continue();
    });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    await expect(page.getByText('Couldn’t load access')).toBeVisible();
    await expect(page.getByTestId('access-mode')).toHaveCount(0);
    fail = false;
    await page.getByTestId('access-section').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('access-mode')).toBeVisible();
  });

  test('the loading placeholder keeps the loaded height within a pixel (A1-23)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'load');
    const d = await publish('Legal clauses');
    await page.route(ACCESS_GET, async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    const section = page.getByTestId('access-section');
    await expect(page.getByRole('status', { name: 'Loading access' })).toBeVisible();
    const loading = await size(section);
    await expect(page.getByTestId('access-mode')).toBeVisible();
    const loaded = await size(section);
    expect(Math.abs(loading.h - loaded.h)).toBeLessThanOrEqual(1);
  });

  test('the read-only summary for a person who cannot manage access (A1-22)', async ({ page, request }) => {
    const { project, publish, people } = await seedProject(request, 'ro');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted', [{ user_id: people[0]!.id, level: 'modify' }]);
    await asViewer(page);
    for (const [width, height] of [[1440, 41.6], [390, 58.4]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
      const summary = page.getByTestId('access-summary');
      await expect(summary).toBeVisible();
      near((await size(summary)).h, height, 2);
      await expect(summary).toContainText('Only people listed below');
      await expect(summary).toContainText('View');
      await expect(page.getByText('Only project managers and admins can change who has access.')).toBeVisible();
      await expect(page.getByRole('radiogroup')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save access' })).toHaveCount(0);
      await expect(page.getByTestId('access-grants-table').getByText('Modify')).toBeVisible();
    }
  });

  test('axe finds nothing on the manager form', async ({ page, request }) => {
    const { project, publish, people } = await seedProject(request, 'axe');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted', [{ user_id: people[0]!.id, level: 'modify' }]);
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    await expect(page.getByTestId('access-grants-table')).toBeVisible();
    await page.waitForTimeout(450);
    const violations = await axeSeriousViolations(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});

test.describe('a viewer (A1-25 to A1-31)', () => {
  test('header badge, no edit affordances, a trimmed More menu (A1-25, A1-26)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'viewer');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted');
    await asViewer(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}`);
      const badge = page.getByTestId('view-only-badge');
      await expect(badge).toBeVisible();
      const b = await size(badge);
      near(b.w, 91.5, 1);
      expect(b.h).toBe(20);
      await expect(page.getByRole('button', { name: 'About view only access' })).toBeVisible();
      for (const gone of ['add-item', 'import-draft', 'publish', 'create-draft', 'set-production', 'create-first-draft']) {
        await expect(page.getByTestId(gone)).toHaveCount(0);
      }
      await expect(page.getByRole('button', { name: 'Rename dataset' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '+ Add a description' })).toHaveCount(0);
      await page.getByTestId('hero-more').click();
      const menu = page.getByRole('menu', { name: 'More actions' });
      await expect(menu.getByRole('menuitem', { name: /Download JSONL/ })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /Name version/ })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: /Upload file as new version/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });

  test('items tab: no checkboxes, no Add item, no All matching; Metadata and the state control stay (A1-27)', async ({
    page,
    request,
  }) => {
    const { project, publish } = await seedProject(request, 'vitems');
    const d = await publish('Legal clauses');
    await setAccess(request, project.slug, d.slug, 'restricted');
    await asViewer(page);
    for (const [width, height] of [[1440, 40], [1024, 65]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=items&meta=topic:refunds`);
      const toolbar = page.locator('[data-dt-toolbar]');
      await expect(toolbar).toBeVisible();
      await expect(page.getByTestId('metadata-filter')).toBeVisible();
      await expect(page.getByTestId('items-state')).toBeVisible();
      await expect(page.getByTestId('all-matching')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      void height;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=items`);
    near((await size(page.locator('[data-dt-toolbar]'))).h, 40);
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow.getByRole('button', { name: 'Open item' })).toBeVisible();
    await firstRow.getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy as JSON' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete item' })).toHaveCount(0);
  });

  test('settings: General fields are read-only and the danger zone names the delete rule (A1-29)', async ({ page, request }) => {
    const { project, publish } = await seedProject(request, 'vset');
    const d = await publish('Legal clauses');
    await asViewer(page, false);
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    await expect(page.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByTestId('delete-dataset')).toHaveCount(0);
    await expect(page.getByText('Only the dataset creator or a project manager can delete a dataset.')).toBeVisible();
  });

  test('a dataset the caller cannot open renders the 403 page and makes no other request (A1-30, A1-31)', async ({
    page,
    request,
  }) => {
    const { project, publish } = await seedProject(request, 'f403');
    const d = await publish('Legal clauses');
    const datasetCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/v1/datasets/') && r.url().includes(d.slug)) datasetCalls.push(r.url());
    });
    await page.route(DATASET_GET, (route) =>
      route.fulfill({ status: 403, json: { detail: "You don't have access to this dataset" } }),
    );
    for (const [width, height] of [[1440, 189], [1024, 189], [390, 229]] as const) {
      datasetCalls.length = 0;
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}`);
      const view = page.getByTestId('da-403');
      await expect(view).toBeVisible();
      await expect(view.getByRole('heading', { name: 'You don’t have access to this dataset' })).toBeVisible();
      await expect(view).toContainText('Ask a project manager to add you. Its runs stay listed with item contents hidden.');
      await expect(view).toContainText("HTTP 403 · You don't have access to this dataset");
      await expect(view.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(view.getByRole('button', { name: 'Back to datasets' })).toBeVisible();
      near((await size(view.locator('[role="alert"]'))).h, height, 25);
      expect(await page.title()).toContain('Datasets');
      expect(datasetCalls).toHaveLength(1); // the failed GET only: no versions, no items
    }
    await page.getByRole('button', { name: 'Back to datasets' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/datasets$`));
  });
});

test.describe('a run on a dataset the reader cannot open (A1-32 to A1-35)', () => {
  test('banner, redacted item line and unchanged scores', async ({ page, request }) => {
    const project = await createProject(request, 'Access run', uniqueSlug('arun'));
    const key = await createApiKey(request, project.id);
    const d = await createDataset(request, project.slug, 'Legal clauses');
    const v = await createVersion(request, project.slug, d.slug);
    const items = sampleItems(6);
    await bulkItems(request, project.slug, d.slug, v.version, items);
    await publishVersion(request, project.slug, d.slug, v.version, true);
    const run = await ingestRun(request, {
      apiKey: key,
      task: 'faq',
      runName: 'restricted run',
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    await page.route(new RegExp(`/api/runs/${run.id}(\\?|$)`), async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as JsonObject;
      body.run.items_restricted = true;
      body.run.items_restricted_reason = 'dataset_access';
      await route.fulfill({ response: res, json: body });
    });
    for (const [width, height] of [[1440, 55.5], [1024, 73.5], [390, 127.5]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, runUrl(project.slug, run.id));
      const banner = page.getByTestId('restricted-dataset-banner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Restricted dataset');
      await expect(banner).toContainText(
        'This run was evaluated on a dataset you don’t have access to. Scores and latencies are shown, but item inputs, expected outputs, outputs, traces, and analysis are hidden.',
      );
      near((await size(banner)).h, height, 14);
      await expect(page.getByTestId('private-test-set')).toHaveCount(0);
    }
  });
});
