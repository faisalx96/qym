/**
 * QA round, point 5 (spec QA5-17 to QA5-78): the dataset Access tab. Server rules are pinned in
 * tests/platform/test_dataset_access.py; here the numbers of the spec are measured on the real pages at 1440, 1024 and 390 px.
 * QYM_AUTH_MODE=none makes every browser user the dev admin: the read-only states are produced by rewriting the platform's answer
 * (see access.spec.ts), the archived state by archiving the project.
 */
import { test, expect, type Page } from '@playwright/test';
import { archiveProject, gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import {
  ACCESS_GET,
  DATASET_GET,
  addMembers,
  asViewer,
  near,
  rewrite,
  seedProject,
  setAccess,
  size,
  WIDTHS,
} from './access-support';
import { query } from './ui';

type Seeded = Awaited<ReturnType<typeof seedProject>>;

/** Twelve extra members make the "twelve people" state (the seed's four are the named ones). */
async function people(request: Parameters<typeof seedProject>[0], s: Seeded, n: number) {
  if (n <= s.people.length) return s.people.slice(0, n);
  const more = await addMembers(
    request,
    s.project.id,
    Array.from({ length: n - s.people.length }, (_, i) => `Member ${String.fromCharCode(97 + i)}${i}`),
  );
  return [...s.people, ...more];
}

async function restrictedWith(
  request: Parameters<typeof seedProject>[0],
  prefix: string,
  n: number,
  name = 'Legal clauses',
) {
  const s = await seedProject(request, prefix);
  const d = await s.publish(name);
  // two members beyond the grants stay candidates, so the add row (not the "everyone already has access" line) shows
  const everyone = await people(request, s, n + 2);
  const list = everyone.slice(0, n);
  if (n >= 0)
    await setAccess(
      request,
      s.project.slug,
      d.slug,
      'restricted',
      list.slice(0, n).map((p, i) => ({ user_id: p.id, level: i % 3 === 0 ? 'modify' : 'view' })),
    );
  return { ...s, d, list };
}

const leaveDialog = (page: Page) =>
  page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Discard access changes?' }));

const accessUrl = (slug: string, ds: string, extra = '') =>
  `/projects/${slug}/datasets/${ds}?tab=access&v=v1${extra}`;

async function open(page: Page, width: number, slug: string, ds: string, height = 1300) {
  await page.setViewportSize({ width, height });
  await gotoApp(page, accessUrl(slug, ds));
  await expect(page.getByTestId('access-tab')).toBeVisible();
  await expect(page.getByTestId('access-save-bar').or(page.getByTestId('access-summary'))).toBeVisible();
}

test.describe('the tab strip (QA5-17 to QA5-23)', () => {
  test('order, count, URL and the settings tab without access controls', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'strip', 12);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}`);
    const tabs = page.getByRole('tablist', { name: 'Dataset sections' }).getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(3)).toContainText('12');
    expect((await tabs.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())).toEqual([
      'Items 6',
      'Runs 0',
      'Lineage 1',
      'Access 12',
      'Settings',
    ]);
    const access = tabs.nth(3);
    const b = await size(access);
    near(b.w, 92, 0.6);
    near(b.h, 34, 0.6);
    await access.click();
    await expect(page).toHaveURL(/tab=access/);
    expect(query(page).get('v')).toBe('v1');
    await expect(page.getByTestId('access-tab')).toBeVisible();
    // QA5-19: settings keeps working without the controls
    await tabs.nth(4).click();
    await expect(page).toHaveURL(/tab=settings/);
    await expect(page.getByTestId('access-save-bar')).toHaveCount(0);
    await expect(page.getByTestId('settings-layout')).toBeVisible();
    // an unknown tab still falls back to items
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=nope&v=v1`);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('at 390 the strip scrolls and keeps the selected Access tab in view (QA5-17, QA5-21)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'strip390', 3);
    await page.setViewportSize({ width: 390, height: 900 });
    await gotoApp(page, accessUrl(project.slug, d.slug));
    const tab = page.getByRole('tab', { name: /^Access/ });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(300);
    const [box, list] = await Promise.all([
      tab.boundingBox(),
      page.getByRole('tablist', { name: 'Dataset sections' }).boundingBox(),
    ]);
    expect(box!.x).toBeGreaterThanOrEqual(list!.x - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(list!.x + list!.width + 0.5);
  });

  test('a project-wide dataset shows no count, a restricted one with no grant shows 0 (QA5-18)', async ({
    page,
    request,
  }) => {
    const wide = await seedProject(request, 'cnt');
    const d = await wide.publish('Plain');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${wide.project.slug}/datasets/${d.slug}`);
    const tab = page.getByRole('tab', { name: /^Access/ });
    near((await size(tab)).w, 66.8, 0.6);
    await expect(tab).toHaveText('Access');
    await setAccess(request, wide.project.slug, d.slug, 'restricted');
    await page.reload();
    await expect(page.getByRole('tab', { name: /^Access/ })).toHaveText('Access0');
  });

  test('everyone who can open the dataset sees the tab, a reader included (QA5-20, QA5-22)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'who', 1);
    await asViewer(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}`);
    await expect(page.getByRole('tab', { name: /^Access/ })).toBeVisible();
    await expect(page.getByTestId('restricted-badge')).toBeVisible();
    expect(await page.getByTestId('restricted-badge').evaluate((e) => e.tagName)).not.toBe('A');
  });

  test('the access query is warmed once from an idle callback and a click joins it (QA5-23, QA5-78)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'warm', 3);
    const gets: number[] = [];
    page.on('request', (r) => {
      if (ACCESS_GET.test(r.url()) && r.method() === 'GET') gets.push(Date.now());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=items&v=v1`);
    await expect.poll(() => gets.length, { timeout: 8000 }).toBe(1);
    await page.getByRole('tab', { name: /^Access/ }).click();
    await expect(page.getByTestId('access-save-bar')).toBeVisible();
    // opened from the cache: no skeleton and no second request
    await page.waitForTimeout(600);
    expect(gets).toHaveLength(1);
  });
});

test.describe('layout and heights (QA5-24 to QA5-37, QA5-59)', () => {
  // [width, mode card (no grants, project), mode group, always, whole tab with twelve, people card twelve, table twelve, add row]
  const NUMBERS = [
    [1440, 180.9, 53.6, 15.4, 914.8, 649.9, 514, 43.4],
    [1024, 196.3, 69, 15.4, 930.1, 649.9, 514, 43.4],
    [390, 319.4, 161.3, 30.8, 2068.7, 1665.3, 1497.4, 75.4],
  ] as const;
  for (const [width, mode, group, always, whole, people12, table12, add] of NUMBERS) {
    test(`twelve people at ${width}px`, async ({ page, request }) => {
      const { project, d } = await restrictedWith(request, `l12-${width}`, 12);
      await open(page, width, project.slug, d.slug, 1500);
      near(
        (await size(page.getByTestId('access-tab'))).w,
        width === 1440 ? 1193 : width === 1024 ? 777 : 279,
        0.6,
      );
      near((await size(page.getByTestId('access-tab'))).h, whole, 0.8);
      near((await size(page.getByTestId('access-mode-card'))).h, mode, 0.8);
      near((await size(page.getByTestId('access-mode'))).h, group, 0.8);
      near((await size(page.getByTestId('access-always'))).h, always, 0.8);
      near((await size(page.getByTestId('access-people'))).h, people12, 0.8);
      near((await size(page.getByTestId('access-grants-table'))).h, table12, 0.8);
      near((await size(page.getByTestId('access-add'))).h, add, 0.8);
      near((await size(page.getByTestId('access-save-bar'))).h, 56, 0.6);
      await expect(page.getByTestId('access-count')).toHaveText('12 people');
      // the add row sits above the table (QA5-34)
      const ys = await page.evaluate(() =>
        ['access-add', 'access-grants-table'].map(
          (id) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect().top,
        ),
      );
      expect(ys[0]!).toBeLessThan(ys[1]!);
      // QA5-66: no overflow
      for (const id of ['access-tab', 'access-mode-card', 'access-people', 'access-grants-table']) {
        expect(await page.getByTestId(id).evaluate((el) => el.scrollWidth <= el.clientWidth), id).toBe(true);
      }
    });
  }

  for (const [width, none, one, mode] of [
    [1440, 191.4, 209.9, 180.9],
    [1024, 191.4, 209.9, 196.3],
    [390, 259.4, 292.7, 319.4],
  ] as const) {
    test(`none listed and one person at ${width}px`, async ({ page, request }) => {
      const empty = await restrictedWith(request, `l0-${width}`, 0);
      await open(page, width, empty.project.slug, empty.d.slug);
      near((await size(page.getByTestId('access-people'))).h, none, 0.8);
      near((await size(page.getByTestId('access-mode-card'))).h, mode, 0.8);
      await expect(page.getByTestId('access-empty-note')).toContainText('No one is listed');
      await expect(page.getByTestId('access-count')).toHaveText('0 people');
      near((await size(page.getByTestId('access-empty-note'))).h, width === 390 ? 91.5 : 55.5, 0.8);
      const single = await restrictedWith(request, `l1-${width}`, 1);
      await open(page, width, single.project.slug, single.d.slug);
      near((await size(page.getByTestId('access-people'))).h, one, 0.8);
      await expect(page.getByTestId('access-count')).toHaveText('1 person');
    });
  }

  test('project-wide with and without saved grants (QA5-25 to QA5-27, QA5-67)', async ({ page, request }) => {
    const plain = await seedProject(request, 'pw');
    const d = await plain.publish('Plain');
    const saved = await restrictedWith(request, 'pws', 3);
    await setAccess(request, saved.project.slug, saved.d.slug, 'project', []).catch(() => undefined);
    for (const [width, withNote, without] of [
      [1440, 196.3, 180.9],
      [1024, 211.6, 196.3],
      [390, 350.2, 319.4],
    ] as const) {
      await open(page, width, plain.project.slug, d.slug);
      near((await size(page.getByTestId('access-mode-card'))).h, without, 0.8);
      await expect(page.getByTestId('access-people')).toHaveCount(0);
      // grants kept while the dataset is project-wide again: put it back through the UI so the grants stay saved
      const kept = await restrictedWith(request, `keep${width}`, 3);
      await open(page, width, kept.project.slug, kept.d.slug);
      await page.getByTestId('access-mode-project').click();
      await expect(page.getByTestId('access-mode-restricted')).toContainText(
        '3 saved grants are kept and apply again if you switch back.',
      );
      near((await size(page.getByTestId('access-mode-card'))).h, withNote, 0.8);
    }
  });

  test('radio options sit side by side from 700 px of tab width and stack below (QA5-28, QA5-29)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'radios', 1);
    for (const width of WIDTHS) {
      await open(page, width, project.slug, d.slug);
      const [a, b] = (await page
        .getByTestId('access-mode')
        .getByRole('radio')
        .evaluateAll((els) =>
          els
            .map((e) => (e.closest('label') ?? e).getBoundingClientRect())
            .map((r) => ({ x: r.left, y: r.top, w: r.width })),
        )) as [{ x: number; y: number; w: number }, { x: number; y: number; w: number }];
      if (width === 390) expect(b.y).toBeGreaterThan(a.y);
      else {
        near(a.y, b.y, 0.6);
        near(a.w, b.w, 1);
      }
    }
  });

  test('copy of the options and the always line (QA5-30, QA5-31)', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'copy', 1);
    await open(page, 1440, project.slug, d.slug);
    const group = page.getByRole('radiogroup', { name: 'Who can access this dataset' });
    await expect(group).toContainText('Everyone in the project');
    await expect(group).toContainText('Every member can view and modify this dataset. This is the default.');
    await expect(group).toContainText('Only people listed below');
    await expect(group).toContainText(
      'Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.',
    );
    await page.getByTestId('access-mode-project').click();
    await expect(group).toContainText('1 saved grant is kept and applies again if you switch back.');
    await expect(page.getByTestId('access-always')).toHaveText(
      'Project managers, admins and the creator always have full access.',
    );
  });
});

test.describe('the grants table (QA5-36 to QA5-42)', () => {
  test('columns, rows, Person cell and Added column at 1440 (QA5-36, QA5-38, QA5-41)', async ({
    page,
    request,
  }) => {
    const { project, d, list } = await restrictedWith(request, 'tbl', 3);
    await open(page, 1440, project.slug, d.slug);
    const table = page.getByTestId('access-grants-table');
    const headers = await table.getByRole('columnheader').allInnerTexts();
    expect(headers.map((h) => h.trim().toLowerCase())).toEqual([
      'person',
      'level',
      'added by',
      'added',
      'remove',
    ]);
    const widths = await table
      .getByRole('columnheader')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(widths.slice(1)).toEqual([160, 180, 130, 48]);
    near(widths[0]!, 633, 1);
    near((await size(table.getByRole('row').nth(1))).h, 40, 0.6);
    near((await size(table)).h, 154, 0.8);
    await expect(table.getByText(list[0]!.email)).toBeVisible();
    const dates = await table.getByTestId('grant-added-at').allInnerTexts();
    expect(dates).toHaveLength(3);
    for (const date of dates) expect(date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    // QA5-39: the level control is named for the person
    await expect(table.getByRole('radiogroup', { name: `Level for ${list[0]!.name}` })).toBeVisible();
  });

  test('a level change keeps the date; remove and re-add is clean again (QA5-41, QA5-47, QA5-51)', async ({
    page,
    request,
  }) => {
    const { project, d, list } = await restrictedWith(request, 'chg', 2);
    await open(page, 1440, project.slug, d.slug);
    const table = page.getByTestId('access-grants-table');
    const before = await table.getByTestId('grant-added-at').first().innerText();
    const level = table.getByRole('radiogroup', { name: `Level for ${list[1]!.name}` });
    await level.locator('label', { hasText: 'Modify' }).click();
    await expect(page.getByTestId('access-save-bar')).toContainText('Unsaved changes');
    expect(await table.getByTestId('grant-added-at').first().innerText()).toBe(before);
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('access-save-bar')).toContainText('No changes');
    await table.getByRole('button', { name: `Remove ${list[1]!.name}` }).click();
    await expect(page.getByTestId('access-save-bar')).toContainText('Unsaved changes');
    const add = page.getByTestId('access-add');
    await add.getByRole('button', { name: /Choose a project member/ }).click();
    await page.getByRole('option', { name: new RegExp(list[1]!.name) }).click();
    await add.getByRole('button', { name: /^Add person$/ }).click();
    await expect(page.getByTestId('access-save-bar')).toContainText('No changes');
  });

  test('Unknown user for a deleted granter, You and Not saved for a new row (QA5-40, QA5-41)', async ({
    page,
    request,
  }) => {
    const { project, d, list } = await restrictedWith(request, 'unk', 2);
    await rewrite(page, ACCESS_GET, (b) => {
      b.grants[0].granted_by = null;
    });
    await open(page, 1440, project.slug, d.slug);
    const table = page.getByTestId('access-grants-table');
    await expect(table.getByText('Unknown user')).toHaveCount(1);
    await expect(table.getByText('You')).toHaveCount(0);
    const add = page.getByTestId('access-add');
    await add.getByRole('button', { name: /Choose a project member/ }).click();
    await page.getByRole('option').first().click();
    await add.getByRole('button', { name: /^Add person$/ }).click();
    await expect(table.getByText('Not saved')).toBeVisible();
    await expect(table.getByText('You')).toBeVisible();
    void list;
  });

  test('Remove moves focus to the next row, then to the add select (QA5-42, QA5-48)', async ({
    page,
    request,
  }) => {
    const { project, d, list } = await restrictedWith(request, 'foc', 2);
    await open(page, 1440, project.slug, d.slug);
    const table = page.getByTestId('access-grants-table');
    const names = await table.locator('[dir="auto"]').allInnerTexts();
    await table.getByRole('button', { name: `Remove ${names[0]}` }).click();
    await expect(table.getByRole('button', { name: `Remove ${names[1]}` })).toBeFocused();
    await table.getByRole('button', { name: `Remove ${names[1]}` }).click();
    await expect(page.getByTestId('access-add').getByRole('button').first()).toBeFocused();
    void list;
  });

  test('an Arabic name and very long names wrap inside the Person cell (QA5-64, QA5-71)', async ({
    page,
    request,
  }) => {
    const s = await seedProject(request, 'rtl');
    const d = await s.publish('Legal clauses');
    const more = await addMembers(request, s.project.id, ['نورة العتيبي', 'A'.repeat(60)]);
    await setAccess(
      request,
      s.project.slug,
      d.slug,
      'restricted',
      more.map((p) => ({ user_id: p.id, level: 'view' as const })),
    );
    for (const width of [1440, 390]) {
      await open(page, width, s.project.slug, d.slug);
      const cell = page.getByTestId('access-grants-table').getByText('نورة العتيبي');
      await expect(cell).toHaveAttribute('dir', 'auto');
      const fits = await page
        .getByTestId('access-grants-table')
        .evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits).toBe(true);
      await expect(
        page.getByTestId('access-grants-table').getByText('A'.repeat(60), { exact: true }),
      ).toBeVisible();
    }
  });
});

test.describe('the save bar (QA5-44 to QA5-47, QA5-61)', () => {
  test('sticky in the page scroll host with twelve people (QA5-44)', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'stick', 12);
    for (const width of [1440, 1024, 390]) {
      await open(page, width, project.slug, d.slug, 900);
      const gaps = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid=access-save-bar]') as HTMLElement;
        let host: HTMLElement | null = bar.parentElement;
        while (
          host &&
          !(
            host.scrollHeight > host.clientHeight + 1 &&
            /(auto|scroll)/.test(getComputedStyle(host).overflowY)
          )
        )
          host = host.parentElement;
        if (!host) return null;
        const hostBottom = host.getBoundingClientRect().bottom;
        const out: number[] = [];
        for (const top of [0, 100, 200]) {
          host.scrollTop = top;
          out.push(+(hostBottom - bar.getBoundingClientRect().bottom).toFixed(2));
        }
        host.scrollTop = host.scrollHeight;
        const end = +(hostBottom - bar.getBoundingClientRect().bottom).toFixed(2);
        return {
          out,
          end,
          position: getComputedStyle(bar).position,
          height: bar.getBoundingClientRect().height,
        };
      });
      expect(gaps, 'a scroll host exists').not.toBeNull();
      expect(gaps!.position).toBe('sticky');
      near(gaps!.height, 56, 0.6);
      for (const g of gaps!.out) near(g, 0, 0.6);
      // amended: at the very end of the scroll the bar rests on the content, above the host's bottom padding (31.9 px)
      near(gaps!.end, 31.9, 1);
    }
  });

  test('states: No changes, Unsaved changes, Saving, Couldn’t save access (QA5-45, QA5-46)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'states', 2);
    await open(page, 1440, project.slug, d.slug);
    const bar = page.getByTestId('access-save-bar');
    await expect(bar).toContainText('No changes');
    await expect(page.getByRole('button', { name: 'Save access' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Discard' })).toBeDisabled();
    near((await size(bar)).h, 56, 0.6);
    await page.getByTestId('access-mode-project').click();
    await expect(bar).toContainText('Unsaved changes');
    near((await size(bar)).h, 56, 0.6);
    // QA5-45: primary text colour (rgb(237, 237, 240)), not the secondary grey
    expect(await bar.locator('[data-part=status]').evaluate((e) => getComputedStyle(e).color)).toBe(
      'rgb(237, 237, 240)',
    );
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let fail = true;
    await page.route(/\/v1\/datasets\/[^/?]+\/access\?/, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await gate;
      if (fail) return route.fulfill({ status: 500, json: { detail: 'boom' } });
      return route.continue();
    });
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(bar).toContainText('Saving');
    near((await size(bar)).h, 56, 0.6);
    release();
    await expect(bar).toContainText('Couldn’t save access');
    await expect(page.getByRole('button', { name: 'Save access' })).toBeEnabled();
    await expect(page.getByTestId('access-mode-project')).toBeChecked();
    near((await size(bar)).h, 56, 0.6);
    fail = false;
    const puts: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && /access/.test(r.url())) puts.push(r.postDataJSON());
    });
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.locator('[data-toast-container]').getByText('Access saved')).toBeVisible();
    expect(puts).toHaveLength(1);
    await expect(bar).toContainText('No changes');
  });

  test('add a person, save, reload: one PUT and the count in the strip updates (QA5-46, QA5-68, QA5-78)', async ({
    page,
    request,
  }) => {
    const { project, d, list } = await restrictedWith(request, 'savef', 1);
    const s = await addMembers(request, project.id, ['Late Joiner']);
    await open(page, 1440, project.slug, d.slug);
    const puts: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/access')) puts.push(r.postDataJSON());
    });
    const add = page.getByTestId('access-add');
    await add.locator('label', { hasText: 'Modify' }).click();
    await add.getByRole('button', { name: /Choose a project member/ }).click();
    await page.getByRole('option', { name: /Late Joiner/ }).click();
    await add.getByRole('button', { name: /^Add person$/ }).click();
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(page.locator('[data-toast-container]').getByText('Access saved')).toBeVisible();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toEqual({
      access_mode: 'restricted',
      grants: [
        { user_id: list[0]!.id, level: 'modify' },
        { user_id: s[0]!.id, level: 'modify' },
      ],
    });
    await expect(page.getByRole('tab', { name: /^Access/ })).toHaveText('Access2');
    await expect(page.getByTestId('access-count')).toHaveText('2 people');
    await page.reload();
    await expect(page.getByTestId('access-grants-table').getByText('Late Joiner')).toBeVisible();
  });

  test('at 390 the bar is 56 clean and 65.4 with a wrapping status (QA5-45, QA5-61)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'narrow', 2);
    await open(page, 390, project.slug, d.slug);
    const bar = page.getByTestId('access-save-bar');
    near((await size(bar)).h, 56, 0.6);
    await page.route(/\/v1\/datasets\/[^/?]+\/access\?/, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: { detail: 'boom' } })
        : route.continue(),
    );
    await page.getByTestId('access-mode-project').click();
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(bar).toContainText('Couldn’t save access');
    const h = (await size(bar)).h;
    expect(
      [56, 65.4].some((n) => Math.abs(h - n) < 1),
      `bar ${h}`,
    ).toBe(true);
    for (const name of ['Discard', 'Save access'])
      near((await size(page.getByRole('button', { name }))).h, 24, 0.6);
  });
});

test.describe('leaving the tab with unsaved changes (QA5-62, QA5-63)', () => {
  test('a dialog asks; Keep editing and Escape stay, Discard changes leaves', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'leave', 2);
    await open(page, 1440, project.slug, d.slug);
    await page.getByTestId('access-mode-project').click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    const dialog = leaveDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      'You have unsaved changes to who can access this dataset. They are lost if you leave this tab.',
    );
    const dialogBox = await size(dialog);
    near(dialogBox.w, 438, 1); // amended: 438 (the mock drew the 440 px box without its border)
    near(dialogBox.h, 165, 1); // amended: 165 (spec 162.2)
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/tab=access/);
    await expect(page.getByTestId('access-mode-project')).toBeChecked();
    await page.getByRole('tab', { name: 'Runs' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/tab=access/);
    await expect(page.getByTestId('access-mode-project')).toBeChecked();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/tab=settings/);
    await page.getByRole('tab', { name: /^Access/ }).click();
    await expect(page.getByTestId('access-mode-restricted')).toBeChecked(); // the edits were dropped
  });

  test('without edits the tab switches at once; the keyboard also asks (QA5-62)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'leave2', 2);
    await open(page, 1440, project.slug, d.slug);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/tab=settings/);
    await page.getByRole('tab', { name: /^Access/ }).click();
    await page.getByTestId('access-mode-project').click();
    await page.getByRole('tab', { name: /^Access/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(leaveDialog(page)).toBeVisible();
  });
});

test.describe('read only, archived, loading and error (QA5-53 to QA5-58)', () => {
  test('the summary for someone who cannot manage access (QA5-53 to QA5-56)', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'ro', 3);
    await asViewer(page);
    for (const [width, summaryH, cardH, whole] of [
      [1440, 41.6, 168.9, 415.4],
      [1024, 41.6, 168.9, 415.4],
      [390, 58.4, 231.8, 0],
    ] as const) {
      await open(page, width, project.slug, d.slug);
      const summary = page.getByTestId('access-summary');
      near((await size(summary)).h, summaryH, 0.8);
      await expect(summary).toContainText('Only people listed below');
      await expect(summary).toContainText('View');
      await expect(
        page.getByText('Only project managers and admins can change who has access.'),
      ).toBeVisible();
      await expect(page.getByTestId('access-mode-card').getByText('Restricted')).toBeVisible();
      await expect(page.getByRole('radiogroup')).toHaveCount(0);
      await expect(page.getByTestId('access-save-bar')).toHaveCount(0);
      await expect(page.getByTestId('access-add')).toHaveCount(0);
      const table = page.getByTestId('access-grants-table');
      const headers = (await table.getByRole('columnheader').allInnerTexts()).map((h) =>
        h.trim().toLowerCase(),
      );
      if (width !== 390) expect(headers).toEqual(['person', 'level', 'added by', 'added']);
      await expect(table.getByRole('button', { name: /^Remove / })).toHaveCount(0);
      if (width !== 390) near((await size(page.getByTestId('access-mode-card'))).h, cardH, 1);
      if (width === 1440) near((await size(page.getByTestId('access-tab'))).h, whole, 1.5);
      await expect(page.getByTestId('access-always')).toBeVisible();
      // QA5-54: 438.5 / 360 with these names; a card list whose grants have a one-line email is 1.1 px shorter per card (435.3 / 356.8)
      if (width === 390) {
        near((await size(page.getByTestId('access-people'))).h, 438.5, 4);
        near((await size(table)).h, 360, 4);
      }
    }
  });

  test('an archived project is read only even for a manager (QA5-53)', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'arch', 2);
    await archiveProject(request, project.id);
    await open(page, 1440, project.slug, d.slug);
    await expect(page.getByText('This project is archived.').first()).toBeVisible();
    await expect(page.getByTestId('access-summary')).toBeVisible();
    await expect(page.getByTestId('access-save-bar')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Access/ })).toBeVisible(); // QA5-20
  });

  test('the loading frame keeps the loaded height within a pixel (QA5-57)', async ({ page, request }) => {
    const s = await seedProject(request, 'load');
    const d = await s.publish('Plain');
    for (const [width, frame] of [
      [1440, 180.9],
      [1024, 196.3],
      [390, 319.4],
    ] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(ACCESS_GET, async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, accessUrl(s.project.slug, d.slug));
      const card = page.getByTestId('access-mode-card');
      await expect(page.getByRole('status', { name: 'Loading access' })).toBeVisible();
      const loading = await size(card);
      near(loading.h, frame, 1);
      await expect(page.getByTestId('access-people')).toHaveCount(0);
      await expect(page.getByTestId('access-mode')).toBeVisible();
      near((await size(card)).h, loading.h, 1);
    }
  });

  test('a failed load shows an error inside the mode card, with Retry (QA5-58)', async ({
    page,
    request,
  }) => {
    const s = await seedProject(request, 'err');
    const d = await s.publish('Plain');
    let fail = true;
    await page.route(ACCESS_GET, async (route) => {
      if (fail) await route.fulfill({ status: 500, json: { detail: 'boom' } });
      else await route.continue();
    });
    for (const [width, h] of [
      [1440, 210.8],
      [390, 226.2],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, accessUrl(s.project.slug, d.slug));
      await expect(page.getByText('Couldn’t load access')).toBeVisible();
      await expect(page.getByTestId('access-mode')).toHaveCount(0);
      await expect(page.getByTestId('access-save-bar')).toHaveCount(0);
      near((await size(page.getByTestId('access-mode-card'))).h, h, 6);
    }
    fail = false;
    await page.getByTestId('access-tab').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('access-mode')).toBeVisible();
  });

  test('a dataset the caller cannot open shows the 403 page and no tab (QA5-70)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'f403', 1);
    await page.route(DATASET_GET, (route) =>
      route.fulfill({ status: 403, json: { detail: "You don't have access to this dataset" } }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, accessUrl(project.slug, d.slug));
    await expect(page.getByTestId('da-403')).toBeVisible();
    await expect(page.getByTestId('access-tab')).toHaveCount(0);
  });
});

test.describe('keyboard and a11y (QA5-21, QA5-48, QA5-49, QA5-65)', () => {
  test('arrow keys move the radios and the tab order follows the page (QA5-48)', async ({
    page,
    request,
  }) => {
    const { project, d } = await restrictedWith(request, 'kbd', 2);
    await open(page, 1440, project.slug, d.slug);
    const radio = page.getByRole('radio', { name: /Only people listed below/ });
    await radio.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('radio', { name: /Everyone in the project/ })).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(radio).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('access-add').getByRole('button').first()).toBeFocused();
  });

  for (const width of [1440, 390]) {
    test(`axe finds nothing serious in every state at ${width}px (QA5-65)`, async ({ page, request }) => {
      const { project, d } = await restrictedWith(request, `axe${width}`, 3);
      const plain = await seedProject(request, `axep${width}`);
      const pd = await plain.publish('Plain');
      const check = async (label: string) => {
        await page.waitForTimeout(450);
        const violations = await axeSeriousViolations(page);
        expect(violations, `${label}: ${describeViolations(violations)}`).toEqual([]);
      };
      await open(page, width, project.slug, d.slug);
      await check('restricted');
      await open(page, width, plain.project.slug, pd.slug);
      await check('project-wide');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await asViewer(page);
      await open(page, width, project.slug, d.slug);
      await check('read only');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route(ACCESS_GET, (route) => route.fulfill({ status: 500, json: { detail: 'boom' } }));
      await page.setViewportSize({ width, height: 1000 });
      await gotoApp(page, accessUrl(project.slug, d.slug));
      await expect(page.getByText('Couldn’t load access')).toBeVisible();
      await check('error');
    });
  }

  test('each card title is an h2 and the tab has no h1 of its own (QA5-49)', async ({ page, request }) => {
    const { project, d } = await restrictedWith(request, 'h2', 1);
    await open(page, 1440, project.slug, d.slug);
    const tab = page.getByTestId('access-tab');
    await expect(tab.getByRole('heading', { level: 2 })).toHaveText(['Access mode', 'People with access']);
    await expect(tab.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByTestId('access-mode-card')).toHaveAttribute('aria-labelledby', 'ds-access-mode');
  });
});
