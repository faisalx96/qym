/**
 * WP-A feature 1 (spec A1-1 to A1-36): per-dataset access in the browser. The server rules
 * (levels, 403 texts, catalog filtering, run redaction) are pinned in tests/platform/test_dataset_access.py;
 * here the numbers of the spec are measured on the real pages at 1440, 1024 and 390 px.
 *
 * QYM_AUTH_MODE=none makes every browser user the dev admin, so the states of a person with less
 * access (view only, no access, a redacted run) are produced by rewriting the platform's answer
 * to that person's: the permissions object, the access payload, a 403, the run's restriction flag.
 */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import {
  DATASET_GET,
  asViewer,
  near,
  rewrite,
  seedProject,
  setAccess,
  size,
  WIDTHS,
  type JsonObject,
} from './access-support';
import {
  bulkItems,
  createApiKey,
  createDataset,
  createVersion,
  ingestRun,
  publishVersion,
  sampleItems,
} from './support';
import { runUrl } from '../run-detail/support';

test.describe('catalog card (A1-1 to A1-4)', () => {
  for (const width of WIDTHS) {
    test(`badge cluster, wrapped name and head height at ${width}px`, async ({ page, request }) => {
      const { project, publish, people } = await seedProject(request, 'cat');
      const plain = await publish('Support FAQ');
      const long = await publish('legal-clauses');
      const wordy = await publish('Ministry of Justice legal clauses reviewed by counsel');
      const secret = await publish('Pricing golden', { private_test_set: true });
      await setAccess(request, project.slug, long.slug, 'restricted', [
        { user_id: people[0]!.id, level: 'view' },
      ]);
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
    const viewOnly = page.locator(`[data-dataset-card="${d.slug}"]`).getByText('View only');
    await expect(viewOnly).toBeVisible();
    const vb = await size(viewOnly);
    near(vb.w, 91.5, 1); // F5: the same size as the page header badge
    expect(vb.h).toBe(20);
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
      for (const gone of [
        'add-item',
        'import-draft',
        'publish',
        'create-draft',
        'set-production',
        'create-first-draft',
      ]) {
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
    for (const [width, height] of [
      [1440, 40],
      [1024, 65],
    ] as const) {
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

  test('settings: General fields are read-only and the danger zone names the delete rule (A1-29)', async ({
    page,
    request,
  }) => {
    const { project, publish } = await seedProject(request, 'vset');
    const d = await publish('Legal clauses');
    await asViewer(page, false);
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=settings`);
    await expect(page.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByTestId('delete-dataset')).toHaveCount(0);
    await expect(
      page.getByText('Only the dataset creator or a project manager can delete a dataset.'),
    ).toBeVisible();
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
    for (const [width, height] of [
      [1440, 189],
      [1024, 189],
      [390, 244.4],
    ] as const) {
      datasetCalls.length = 0;
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}`);
      const view = page.getByTestId('da-403');
      await expect(view).toBeVisible();
      await expect(
        view.getByRole('heading', { name: 'You don’t have access to this dataset' }),
      ).toBeVisible();
      await expect(view).toContainText(
        'Ask a project manager to add you. Its runs stay listed with item contents hidden.',
      );
      await expect(view).toContainText("HTTP 403 · You don't have access to this dataset");
      await expect(view.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(view.getByRole('button', { name: 'Back to datasets' })).toBeVisible();
      near((await size(view.locator('[role="alert"]'))).h, height, 1); // amended at 390: 244.4 (the text wraps one more line)
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
    for (const [width, height] of [
      [1440, 55.5],
      [1024, 73.5],
      [390, 127.5],
    ] as const) {
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
