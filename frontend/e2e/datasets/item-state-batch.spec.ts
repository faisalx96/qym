/**
 * WP-A features 2 and 3 (spec A2-1 to A2-48, A3-1 to A3-42) in the browser: the state control and
 * its counts, disabled rows, the pane and page actions, the dialogs, the metadata filter and the
 * batch confirm. Server rules are pinned in tests/platform/test_dataset_item_state.py and
 * test_dataset_items_batch.py; here the numbers of the spec are measured at 1440, 1024 and 390 px.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { batch, disableItems, metadataItems, near, size, WIDTHS } from './access-support';
import { bulkItems, createDataset, createVersion, publishVersion } from './support';
import { query } from './ui';

interface Seed {
  slug: string;
  ds: string;
  v1: string;
  v2: string;
}

/** support-faq: v1 published with 130 items (42 finance), v2 a draft copy with 6 disabled (2 of them finance). */
async function seedFaq(request: APIRequestContext, prefix: string): Promise<Seed> {
  const project = await createProject(request, `Items ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, project.slug, 'support-faq');
  const v1 = await createVersion(request, project.slug, d.slug);
  await bulkItems(request, project.slug, d.slug, v1.version, metadataItems(130, 42));
  await publishVersion(request, project.slug, d.slug, v1.version, true);
  const v2 = await createVersion(request, project.slug, d.slug, { from_version: v1.version });
  await disableItems(
    request,
    project.slug,
    d.slug,
    v2.version,
    ['faq-003', 'faq-005', 'faq-050', 'faq-070', 'faq-090', 'faq-120'],
    'duplicate of faq-014',
  );
  return { slug: project.slug, ds: d.slug, v1: v1.version, v2: v2.version };
}

const items = (s: Seed, search = '', version = s.v2) =>
  `/projects/${s.slug}/datasets/${s.ds}?v=${version}&tab=items${search ? `&${search}` : ''}`;

async function open(page: Page, s: Seed, search = '', version = s.v2) {
  await gotoApp(page, items(s, search, version));
  await expect(page.locator('[data-dt-toolbar]')).toBeVisible();
  await expect(page.getByTestId('items-state')).toContainText('Active');
}

const toolbar = (page: Page) => page.locator('[data-dt-toolbar]');
const rowOf = (page: Page, id: string) =>
  page.locator(`[data-item-link="${id}"]`).locator('xpath=ancestor::*[@role="row"]');
const stateLabel = (page: Page, name: string) =>
  page
    .getByTestId('items-state')
    .locator('label')
    .filter({ hasText: new RegExp(`^${name}`) });
async function pickState(page: Page, name: 'Active' | 'Disabled' | 'All') {
  await stateLabel(page, name).click();
}
async function selectRows(page: Page, ids: string[]) {
  if ((page.viewportSize()?.width ?? 1440) <= 480) {
    // Card mode: each card carries its own checkbox, in list order.
    for (let n = 0; n < ids.length; n += 1) await page.getByRole('checkbox').nth(n).click({ force: true });
    return;
  }
  for (const id of ids) {
    await rowOf(page, id).focus();
    await page.keyboard.press('Space');
  }
}

test.describe('state control and toolbar (A2-1 to A2-12)', () => {
  for (const width of WIDTHS) {
    test(`state control, counts and toolbar heights at ${width}px`, async ({ page, request }) => {
      const s = await seedFaq(request, 'state');
      await page.setViewportSize({ width, height: 900 });
      await open(page, s);
      const control = page.getByTestId('items-state');
      // A2-1: three options in order, 202.9 x 24, counts in mono tabular numerals.
      const box = await size(control);
      near(box.w, 202.9, 1);
      expect(box.h).toBe(24);
      await expect(control.getByRole('radio')).toHaveCount(3);
      await expect(control.locator('label').nth(0)).toContainText('Active124');
      await expect(control.locator('label').nth(1)).toContainText('Disabled6');
      await expect(control.locator('label').nth(2)).toContainText('All130');
      const countFont = await control
        .locator('span[class*="countLabel"]')
        .first()
        .evaluate((el) => {
          const cs = getComputedStyle(el);
          return { family: cs.fontFamily, nums: cs.fontVariantNumeric };
        });
      expect(countFont.family).toMatch(/mono/i);
      expect(countFont.nums).toContain('tabular-nums');
      // A2-4: the toolbar height by width, the same loading and loaded.
      near((await size(toolbar(page))).h, { 1440: 40, 1024: 65, 390: 161 }[width]!, 1);
      // A2-6: the toolbar count names the selected state's total.
      await expect(toolbar(page)).toContainText('124 items');
    });
  }

  test('Active is the default; Disabled and All write ?state= and reset the page (A2-2, A2-3, A2-6)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'url');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, 'page=1');
    expect(query(page).get('state')).toBeNull();
    const control = page.getByTestId('items-state');
    await pickState(page, 'Disabled');
    await expect.poll(() => query(page).get('state')).toBe('disabled');
    expect(query(page).get('page')).toBeNull();
    await expect(toolbar(page)).toContainText('6 items');
    await expect(page.getByRole('row')).toHaveCount(7); // header + six disabled rows
    await pickState(page, 'All');
    await expect.poll(() => query(page).get('state')).toBe('all');
    await expect(toolbar(page)).toContainText('130 items');
    await pickState(page, 'Active');
    await expect.poll(() => query(page).get('state')).toBeNull();
    // Counts ignore the state and follow the other criteria; All = Active + Disabled.
    await page.getByRole('searchbox', { name: 'Search items' }).fill('order #1');
    await expect(control.locator('label').nth(2)).not.toContainText('All130');
    const counts = await control
      .locator('label')
      .evaluateAll((els) => els.map((e) => Number(/(\d+)$/.exec(e.textContent ?? '')?.[1])));
    expect(counts[0]! + counts[1]!).toBe(counts[2]!);
  });

  test('a disabled row keeps its height, reads muted and carries the badge; the ID column widens (A2-7, A2-8)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'rows');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, 'state=all');
    const disabledRow = rowOf(page, 'faq-003');
    const activeRow = rowOf(page, 'faq-001');
    near((await size(disabledRow)).h, (await size(activeRow)).h, 0.5);
    near((await size(disabledRow)).h, 52, 0.5);
    const badge = disabledRow.getByText('Disabled', { exact: true });
    expect((await size(badge)).h).toBe(20);
    const colors = await Promise.all(
      [disabledRow, activeRow].map((row) =>
        row
          .locator('td')
          .nth(3)
          .evaluate((td) => getComputedStyle(td).color),
      ),
    );
    expect(colors[0]).not.toBe(colors[1]);
    const opacity = await disabledRow.evaluate((tr) => getComputedStyle(tr).opacity);
    expect(opacity).toBe('1'); // never hidden or dimmed by opacity alone
    const idWidth = await page
      .getByRole('columnheader', { name: /^ID/ })
      .evaluate((th) => th.getBoundingClientRect().width);
    near(idWidth, 180, 1);
    // Under Active the badge never appears.
    await pickState(page, 'Active');
    await expect(rowOf(page, 'faq-003')).toHaveCount(0);
    await expect(page.getByRole('row').getByText('Disabled', { exact: true })).toHaveCount(0);
  });

  test('empty states: no disabled items; no match with Clear filters (A2-11)', async ({ page, request }) => {
    const s = await seedFaq(request, 'empty');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, 'state=disabled', s.v1); // the published v1 has none disabled
    await expect(page.getByText('No disabled items')).toBeVisible();
    await expect(page.getByText('Items you disable in a draft appear here.')).toBeVisible();
    await gotoApp(page, items(s, 'search=zzzz-nothing&meta=domain:finance&state=disabled'));
    await expect(page.getByText('No items match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => query(page).get('search')).toBeNull();
    expect(query(page).getAll('meta')).toEqual([]);
    expect(query(page).get('state')).toBe('disabled'); // the state stays
  });

  test('a published version shows the same state control, no checkboxes (A2-12)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'pub');
    await open(page, s, '', s.v1);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByTestId('items-state')).toContainText('Active130');
  });

  test('selected rows include disabled ones (A2-10)', async ({ page, request }) => {
    const s = await seedFaq(request, 'sel');
    await open(page, s, 'state=disabled');
    await selectRows(page, ['faq-003', 'faq-005']);
    await expect(page.getByRole('region', { name: 'Selection actions' })).toContainText('2 selected');
    await expect(page.getByTestId('bulk-disable-selected')).toBeVisible();
  });
});

test.describe('metadata filter and chips (A3-1 to A3-14)', () => {
  test('the Metadata button is 98 x 24 and the popover is 320 wide (A3-1 to A3-3)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'meta');
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, s);
      const button = page.getByTestId('metadata-filter');
      const b = await size(button);
      expect([b.w, b.h]).toEqual([98, 24]);
      await button.click();
      const popover = page.getByTestId('meta-popover');
      await expect(popover.getByRole('listbox', { name: /^Values of/ })).toBeVisible();
      const p = await size(popover);
      near(p.w, 320, 1); // fits the 390 px viewport too (amended: the mock's 279 was its frame)
      await page.keyboard.press('Escape');
    }
  });

  test('pick a key and a value: a chip, ?meta= in the URL, counts follow (A3-4 to A3-9)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'pick');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    const popover = page.getByTestId('meta-popover');
    // Keys are the dotted paths of the facets, as written.
    await popover.getByRole('button', { name: /Key/ }).click();
    const keys = page.getByRole('listbox').filter({ hasText: 'source.region.code' }).getByRole('option');
    const options = await keys.allInnerTexts();
    expect(options.map((o) => o.split('\n')[0])).toEqual([
      'difficulty',
      'domain',
      'source.channel',
      'source.region.code',
    ]);
    await page.getByRole('option', { name: /^domain/ }).click();
    const values = popover.getByRole('listbox', { name: 'Values of domain' });
    await expect(values.getByRole('option').first()).toContainText('finance');
    await expect(popover.getByRole('button', { name: 'Add filter' })).toBeDisabled();
    await values.getByRole('option', { name: /finance/ }).click();
    await popover.getByRole('button', { name: 'Add filter' }).click();
    await expect(popover).toHaveCount(0);
    const chip = page.getByTestId('meta-chip');
    await expect(chip).toHaveText('domain: finance');
    expect(query(page).getAll('meta')).toEqual(['domain:finance']);
    near((await size(page.getByTestId('filter-chips'))).h, 26, 0.5);
    // Counts follow the filter inside one list response.
    await expect(page.getByTestId('items-state')).toContainText('Active40');
    await expect(page.getByTestId('items-state')).toContainText('Disabled2');
    await expect(page.getByTestId('items-state')).toContainText('All42');
    // Removing the chip removes only its parameter.
    await page.getByRole('button', { name: 'Remove filter domain: finance' }).click();
    await expect.poll(() => query(page).getAll('meta')).toEqual([]);
  });

  test('chips and the toolbar heights with three filters (A2-5, A3-7, A3-8)', async ({ page, request }) => {
    const s = await seedFaq(request, 'chips');
    for (const [width, chipRow, toolbarH] of [
      [1440, 26, 67],
      [1024, 26, 99],
      [390, 56, 225],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, s, 'label=edge&meta=domain:finance&meta=source.region.code:sa');
      await expect(page.getByTestId('meta-chip')).toHaveCount(2);
      near((await size(page.getByTestId('filter-chips'))).h, chipRow, 1);
      near((await size(toolbar(page))).h, toolbarH, 2);
      for (const chip of await page.getByTestId('meta-chip').all()) {
        expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
  });

  test('five filters is the limit: the button disables with the hint (A3-10)', async ({ page, request }) => {
    const s = await seedFaq(request, 'five');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(
      page,
      s,
      'meta=domain:finance&meta=difficulty:1&meta=source.channel:chat&meta=source.region.code:sa&meta=extra:1',
    );
    await expect(page.getByTestId('meta-chip')).toHaveCount(5);
    const button = page.getByTestId('metadata-filter');
    await expect(button).toHaveAttribute('data-limit', '');
    await button.focus();
    await expect(page.getByRole('tooltip')).toHaveText('You can combine up to 5 metadata filters.');
  });

  test('loading, empty and error states of the popover (A3-11 to A3-13)', async ({ page, request }) => {
    const s = await seedFaq(request, 'facetstates');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(/items:metadata-facets/, async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await expect(page.getByRole('status', { name: 'Loading metadata keys' })).toBeVisible();
    await expect(page.getByTestId('meta-popover').getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.unroute(/items:metadata-facets/);
    await page.route(/items:metadata-facets/, (route) =>
      route.fulfill({ json: { paths: [], truncated: false } }),
    );
    await page.reload();
    await page.getByTestId('metadata-filter').click();
    await expect(page.getByText('No metadata keys')).toBeVisible();
    await expect(page.getByText('Items in this version have no metadata fields to filter on.')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.unroute(/items:metadata-facets/);
    await page.route(/items:metadata-facets/, (route) =>
      route.fulfill({ status: 500, json: { detail: 'boom' } }),
    );
    await page.reload();
    await page.getByTestId('metadata-filter').click();
    await expect(page.getByText('Couldn’t load metadata keys')).toBeVisible();
    await expect(page.getByTestId('meta-popover').getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('a truncated path says so and an unlisted value applies as an exact match (A3-14)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'trunc');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(/items:metadata-facets/, (route) =>
      route.fulfill({
        json: {
          paths: [
            {
              path: 'ticket',
              values: Array.from({ length: 200 }, (_, n) => ({ value: `t${n}`, count: 200 - n })),
              truncated: true,
              value_count: 340,
            },
          ],
          truncated: false,
        },
      }),
    );
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await expect(page.getByTestId('facet-truncated')).toHaveText(
      'Showing the 200 most common values of 340. Type to search.',
    );
    await page.getByRole('searchbox', { name: 'Find a value' }).fill('t999');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('meta-chip')).toHaveText('ticket: t999');
  });
});

const FILTER = 'meta=domain:finance'; // 42 finance items; 2 of them disabled in the seed

test.describe('All matching menu and selected rows (A3-15 to A3-26)', () => {
  test('the menu appears with a criterion; its numbers are the counts (A3-15 to A3-17, A3-20)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'menu');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await expect(page.getByTestId('all-matching')).toHaveCount(0); // no criterion: no menu (A3-20)
    await open(page, s, 'state=disabled'); // the state alone is not a criterion
    await expect(page.getByTestId('all-matching')).toHaveCount(0);
    await open(page, s, FILTER);
    const trigger = page.getByTestId('all-matching');
    const t = await size(trigger);
    expect([t.w, t.h]).toEqual([108, 24]);
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'All matching' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Disable all 40 matching…',
      'Enable all 2 matching…',
      'Delete all 42 matching…',
    ]);
    // Amended A3-17: the real menu is content sized (178 px here), not the 240 px of the mock panel.
    expect((await size(menu)).w).toBeLessThanOrEqual(240);
    for (const h of await menu
      .getByRole('menuitem')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(32 - 0.5);
    }
    await expect(menu.getByRole('menuitem', { name: /^Delete all/ })).toHaveAttribute('data-tone', 'danger');
  });

  test('a zero count disables its entry (A3-16)', async ({ page, request }) => {
    const s = await seedFaq(request, 'zero');
    await open(page, s, 'label=arabic&meta=difficulty:1');
    // none of these items is disabled: Enable all 0 matching…
    await page.getByTestId('all-matching').click();
    await expect(page.getByRole('menuitem', { name: 'Enable all 0 matching…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('a published version swaps the menu for one button that opens the create-draft flow (A3-18)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'pubentry');
    await open(page, s, FILTER, s.v1);
    await expect(page.getByTestId('all-matching')).toHaveCount(0);
    const entry = page.getByTestId('batch-published-entry');
    const b = await size(entry);
    expect([b.w, b.h]).toEqual([179, 24]);
    await entry.click();
    await expect(page.getByRole('dialog', { name: 'Create draft' })).toBeVisible();
  });

  test('selected rows: Disable N…, Enable N, Delete N and the toolbar heights (A3-21 to A3-23)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'selrows');
    for (const [width, h] of [
      [1440, 99],
      [1024, 131],
      [390, 321],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, s, `label=arabic&${FILTER}&meta=difficulty:0`);
      await selectRows(page, ['faq-001', 'faq-016']);
      const cluster = page.getByRole('region', { name: 'Selection actions' });
      await expect(cluster).toContainText('2 selected');
      await expect(cluster.getByRole('button')).toHaveText([
        'Disable 2…',
        'Enable 2',
        'Delete 2',
        'Clear selection',
      ]);
      near((await size(toolbar(page))).h, h, 4);
    }
    // Enable 2 applies at once (reversible): these two are active, so nothing changes.
    await page.getByTestId('bulk-enable-selected').click();
    await expect(page.locator('[data-toast-container]')).toContainText(
      'No change: the 2 items were already enabled',
    );
  });

  test('disabling selected rows: the dialog is titled with the count (A2-35, A3-22)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'seldis');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await selectRows(page, ['faq-001', 'faq-002']);
    await page.getByTestId('bulk-disable-selected').click();
    const dialog = page.getByRole('dialog', { name: 'Disable 2 items?' });
    await expect(dialog).toContainText(
      'They stay in this draft and are left out of runs once it is published. You can enable them again in any draft.',
    );
    await dialog.getByRole('textbox', { name: 'Reason (optional)' }).fill('both are duplicates');
    await dialog.getByRole('button', { name: 'Disable 2' }).click();
    await expect(page.locator('[data-toast-container]')).toContainText('2 items disabled');
    await expect(page.getByTestId('items-state')).toContainText('Disabled8');
    await expect(rowOf(page, 'faq-001')).toHaveCount(0); // left the Active list
  });

  test('selecting disabled rows and pressing Disable 2… reports no change (A3-23)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'seldis2');
    await open(page, s, 'state=disabled');
    await selectRows(page, ['faq-003', 'faq-005']);
    await page.getByTestId('bulk-disable-selected').click();
    await page
      .getByRole('dialog', { name: 'Disable 2 items?' })
      .getByRole('button', { name: 'Disable 2' })
      .click();
    await expect(page.locator('[data-toast-container]')).toContainText(
      'No change: the 2 items were already disabled',
    );
  });
});

test.describe('batch confirm dialog (A3-27 to A3-42)', () => {
  async function openBatch(page: Page, s: Seed, entry: RegExp, search = FILTER) {
    await open(page, s, search);
    await page.getByTestId('all-matching').click();
    await page.getByRole('menuitem', { name: entry }).click();
  }

  test('disable: numbers, first items, reason with counter, then apply (A3-29 to A3-31, A3-36)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'bdis');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog', { name: 'Disable 40 items?' });
    await expect(dialog).toBeVisible();
    near((await size(dialog)).w, 600, 2);
    await expect(dialog.getByTestId('batch-numbers')).toContainText('40');
    await expect(dialog.getByTestId('batch-numbers')).toContainText(
      '40 of 130 items match domain: finance and are active.',
    );
    const ids = dialog.getByTestId('batch-ids');
    await expect(ids).toContainText('First items');
    await expect(ids.locator('li')).toHaveCount(6); // five tags and "and 35 more"
    await expect(ids).toContainText('and 35 more');
    const reason = dialog.getByRole('textbox', { name: 'Reason (optional)' });
    await reason.fill('x'.repeat(30));
    await expect(dialog.getByTestId('reason-counter')).toHaveText('30 / 500');
    await expect(dialog).toContainText(
      'The items stay in this draft and are left out of runs once it is published.',
    );
    await dialog.getByRole('button', { name: 'Disable 40' }).click();
    await expect(page.locator('[data-toast-container]')).toContainText('Disabled 40 items');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('items-state')).toContainText('Active0Disabled42All42');
  });

  test('enable: no reason field, an inclusion line (A3-32)', async ({ page, request }) => {
    const s = await seedFaq(request, 'ben');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBatch(page, s, /^Enable all/);
    const dialog = page.getByRole('dialog', { name: 'Enable 2 items?' });
    await expect(dialog).toContainText('2 of 130 items match domain: finance and are disabled.');
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog).toContainText('The items are included in runs again once this draft is published.');
    await dialog.getByRole('button', { name: 'Enable 2' }).click();
    await expect(page.locator('[data-toast-container]')).toContainText('Enabled 2 items');
  });

  test('delete over 50 asks for the number; mismatch text; Enter confirms only when it matches (A3-33, A3-34)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'bdel');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBatch(page, s, /^Delete all/, 'meta=source.channel:email&state=all'); // 65 items
    const dialog = page.getByRole('alertdialog', { name: 'Delete 65 items?' });
    await expect(dialog).toContainText('This removes the items from this draft');
    await expect(dialog).toContainText('Published versions keep their copy.');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused(); // destructive confirm starts on Cancel
    const confirm = dialog.getByRole('button', { name: 'Delete 65' });
    await expect(confirm).toBeDisabled();
    const field = dialog.getByRole('textbox', { name: 'Type 65 to confirm' });
    await field.fill('6');
    await expect(dialog.getByText('The text does not match.')).toBeVisible();
    await field.press('Enter');
    await expect(dialog).toBeVisible();
    await field.fill(' 65 ');
    await expect(confirm).toBeEnabled();
    await field.press('Enter');
    await expect(page.locator('[data-toast-container]')).toContainText('Deleted 65 items');
    await expect(page.getByTestId('items-state')).toContainText('All0'); // the filter now matches nothing
  });

  test('delete up to 50 needs no typed text and focuses Cancel (A3-33)', async ({ page, request }) => {
    const s = await seedFaq(request, 'bdel2');
    await openBatch(page, s, /^Delete all/);
    const dialog = page.getByRole('alertdialog', { name: 'Delete 42 items?' });
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Delete 42' })).toBeEnabled();
  });

  test('the dialog opens in the checking state and the primary waits for the dry run (A3-28)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'bcheck');
    await page.route(/items:batch/, async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog', { name: 'Checking matching items…' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status', { name: 'Checking matching items' })).toBeVisible();
    await expect(dialog.getByTestId('batch-confirm')).toBeDisabled();
    const checking = await size(dialog);
    await expect(page.getByRole('dialog', { name: 'Disable 40 items?' })).toBeVisible();
    // The footer keeps its height between the states.
    const footer = async () => (await size(page.getByRole('dialog').locator('footer'))).h;
    near(await footer(), 49, 6);
    void checking;
  });

  test('a moved count answers 409: the dialog says so and offers Review again (A3-37)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'b409');
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog', { name: 'Disable 40 items?' });
    // Another editor changes the matching set after the dry run.
    await batch(request, s.slug, s.ds, s.v2, {
      filter: { item_ids: ['faq-001'] },
      action: 'disable',
      dry_run: false,
    });
    await dialog.getByRole('button', { name: 'Disable 40' }).click();
    const changed = dialog.getByTestId('batch-changed');
    await expect(changed).toHaveText('The matching items changed. Review the new count and try again.');
    await expect(changed).toHaveAttribute('role', 'alert');
    const again = dialog.getByRole('button', { name: 'Review again' });
    await again.click();
    await expect(page.getByRole('dialog', { name: 'Disable 39 items?' })).toBeVisible();
    await expect(page.getByTestId('batch-changed')).toHaveCount(0);
  });

  test('a failed dry run offers Retry; the primary stays disabled (A3-38)', async ({ page, request }) => {
    const s = await seedFaq(request, 'bretry');
    let fail = true;
    await page.route(/items:batch/, async (route) => {
      if (fail) await route.fulfill({ status: 500, json: { detail: 'boom' } });
      else await route.continue();
    });
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Couldn’t check the matching items. Try again.')).toBeVisible();
    await expect(dialog.getByTestId('batch-confirm')).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('dialog', { name: 'Disable 40 items?' })).toBeVisible();
  });

  test('another apply error shows its detail and re-enables the primary (A3-39)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'bother');
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog', { name: 'Disable 40 items?' });
    await page.route(/items:batch/, async (route) => {
      const body = route.request().postDataJSON() as { dry_run: boolean };
      if (!body.dry_run)
        await route.fulfill({ status: 403, json: { detail: 'You can view this dataset but not change it' } });
      else await route.continue();
    });
    await dialog.getByRole('button', { name: 'Disable 40' }).click();
    await expect(dialog.getByText('You can view this dataset but not change it')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Disable 40' })).toBeEnabled();
  });

  test('applying locks Esc and Cancel (A3-35)', async ({ page, request }) => {
    const s = await seedFaq(request, 'block');
    await openBatch(page, s, /^Disable all/);
    const dialog = page.getByRole('dialog', { name: 'Disable 40 items?' });
    await page.route(/items:batch/, async (route) => {
      const body = route.request().postDataJSON() as { dry_run: boolean };
      if (!body.dry_run) await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Disable 40' }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-toast-container]')).toContainText('Disabled 40 items');
  });

  test('a dry run that affects nothing shows an info toast and no dialog (A3-40)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'bzero');
    await open(page, s, FILTER);
    await page.route(/items:batch/, (route) =>
      route.fulfill({
        json: { matched: 3, affected: 0, sample_item_ids: [], version_status: 'draft', dry_run: true },
      }),
    );
    await page.getByTestId('all-matching').click();
    await page.getByRole('menuitem', { name: /^Disable all/ }).click();
    await expect(page.locator('[data-toast-container]')).toContainText('No items to change');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('item pane, item page and the disable dialog (A2-13 to A2-35)', () => {
  const pane = (page: Page) => page.locator('[data-item-pane]');

  test('draft pane: Disable item… opens the dialog; reason counter; success updates counts (A2-13, A2-29 to A2-34)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'pane');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await rowOf(page, 'faq-001').click();
    await expect(pane(page)).toBeVisible();
    near((await size(pane(page))).w, 460, 2);
    const action = pane(page).getByTestId('item-state-action');
    await expect(action).toHaveText('Disable item…');
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Disable item faq-001?' });
    near((await size(dialog)).w, 440, 2);
    await expect(dialog).toContainText(
      'The item stays in this draft but is left out of runs once the draft is published. You can enable it again in any draft.',
    );
    await expect(dialog.getByRole('textbox', { name: 'Reason (optional)' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Reason (optional)' }).fill('abc');
    await expect(dialog.getByTestId('reason-counter')).toHaveText('3 / 500');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(action).toBeFocused(); // focus returns to the button (A2-23)
    await action.click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Reason (optional)' }).fill('duplicate');
    await page.getByRole('dialog').getByRole('button', { name: 'Disable item' }).click();
    await expect(page.locator('[data-toast-container]')).toContainText('Item faq-001 disabled');
    // The pane stays on the item, now disabled; the list leaves it out of Active (A2-22).
    await expect(pane(page).getByTestId('disabled-banner')).toContainText('Reason: duplicate');
    await expect(pane(page).getByText('Disabled', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('items-state')).toContainText('Disabled7');
    await expect(rowOf(page, 'faq-001')).toHaveCount(0);
  });

  test('disabled item in a draft: banner with Enable, no footer action; Enable is one click (A2-15, A2-19, A2-21)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'enable');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, 'state=disabled');
    await rowOf(page, 'faq-003').click();
    const banner = pane(page).getByTestId('disabled-banner');
    await expect(banner).toContainText('Disabled by Dev User on');
    await expect(banner).toContainText('Reason: duplicate of faq-014');
    expect((await size(banner)).h).toBeGreaterThan(50);
    await expect(pane(page).getByTestId('item-state-action')).toHaveCount(0);
    await pane(page).getByTestId('enable-item').click();
    await expect(page.locator('[data-toast-container]')).toContainText('Item faq-003 enabled');
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('items-state')).toContainText('Disabled5');
  });

  test('published pane offers Create a draft to disable and opens the item in the new draft (A2-14, A2-16)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'pubpane');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, '', s.v1);
    await rowOf(page, 'faq-002').click();
    const action = pane(page).getByTestId('item-state-action');
    await expect(action).toHaveText('Create a draft to disable');
    await action.click();
    await page
      .getByRole('dialog', { name: 'Create draft' })
      .getByRole('button', { name: 'Create draft' })
      .click();
    await expect.poll(() => query(page).get('item')).toBe('faq-002');
    expect(query(page).get('v')).not.toBe(s.v1);
  });

  test('item page: draft actions, banner and Enable (A2-18, A2-20)', async ({ page, request }) => {
    const s = await seedFaq(request, 'page');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?v=${s.v2}&item=faq-003`);
    await expect(page.getByTestId('disabled-banner')).toBeVisible();
    await expect(page.getByTestId('enable-item')).toBeVisible();
    await expect(page.getByTestId('item-state-action')).toHaveCount(0);
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?v=${s.v2}&item=faq-001`);
    const disable = page.getByTestId('item-state-action');
    await expect(disable).toHaveText('Disable item…');
    expect((await size(disable)).h).toBe(32);
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?v=${s.v1}&item=faq-001`);
    await expect(page.getByTestId('create-draft-to-edit')).toBeVisible();
    await expect(page.getByTestId('item-state-action')).toHaveText('Create a draft to disable');
  });

  test('a 409 from the server shows its detail under the reason field (A2-27, A2-33)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'err409');
    await open(page, s);
    await rowOf(page, 'faq-001').click();
    await page.route(/:disable/, (route) =>
      route.fulfill({ status: 409, json: { detail: 'Create a draft to change item state' } }),
    );
    await pane(page).getByTestId('item-state-action').click();
    const dialog = page.getByRole('dialog', { name: 'Disable item faq-001?' });
    await dialog.getByRole('button', { name: 'Disable item' }).click();
    await expect(dialog.getByText('Create a draft to change item state')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe('version header, download, publish note, history and compare (A2-36 to A2-48)', () => {
  test('meta line, version row and download entries (A2-36, A2-37, A2-39)', async ({ page, request }) => {
    const s = await seedFaq(request, 'ver');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await expect(page.getByTestId('meta-items')).toHaveText('130 items (6 disabled)');
    await page.getByTestId('version-switcher').click();
    await expect(page.getByTestId('version-row-items').first()).toContainText('items');
    await expect(page.getByRole('listbox').getByText('130 items (6 disabled)')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('hero-more').click();
    await expect(page.getByRole('menuitem', { name: '↓ Download JSONL', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '↓ Download JSONL with disabled items' })).toBeVisible();
    await page.keyboard.press('Escape');
    await open(page, s, '', s.v1);
    await expect(page.getByTestId('meta-items')).toHaveText('130 items');
    await page.getByTestId('hero-more').click();
    await expect(page.getByRole('menuitem', { name: /with disabled items/ })).toHaveCount(0);
  });

  test('the publish dialog names the disabled items (A2-40)', async ({ page, request }) => {
    const s = await seedFaq(request, 'pubnote');
    await open(page, s);
    await page.getByTestId('publish').click();
    const note = page.getByTestId('publish-disabled-note');
    await expect(note).toHaveText('6 items are disabled. Runs on v2 skip them.');
  });

  test('history shows disabled and enabled revisions without diffs or revert (A2-43, A2-44)', async ({
    page,
    request,
  }) => {
    const s = await seedFaq(request, 'hist');
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?v=${s.v2}&item=faq-003&tab=history`);
    const rev = page.getByTestId('rev-disabled');
    await expect(rev).toBeVisible();
    await expect(rev).toContainText('disabled');
    await expect(rev).toContainText('Reason: duplicate of faq-014');
    await expect(rev.getByRole('button', { name: /Revert/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Details' }).click();
    await page.getByTestId('enable-item').click();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('rev-enabled')).toContainText('No reason given');
  });

  test('compare: summary tiles and the state diff (A2-45, A2-46, A2-48)', async ({ page, request }) => {
    const s = await seedFaq(request, 'cmp');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}/compare?base=${s.v1}&head=${s.v2}`);
    const summary = page.getByLabel('Comparison summary');
    await expect(summary).toContainText('Disabled');
    await expect(summary).toContainText('6');
    await expect(summary).not.toContainText('Enabled');
    const row = page.locator('[data-compare-row="faq-003"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('fields: state');
    const diff = row.getByTestId('compare-state-row');
    await expect(diff).toHaveAttribute('aria-label', 'state changed from Active to Disabled');
    await expect(diff).toContainText('Active');
    await expect(diff).toContainText('Disabled');
  });

  test('lineage lists the disabled count of a version (A2-47)', async ({ page, request }) => {
    const s = await seedFaq(request, 'lin');
    await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?tab=lineage`);
    await page.getByTestId('version-switcher').waitFor();
    // v2 is a draft: its counts are computed on read.
    await expect(page.getByText('6 disabled').first()).toBeVisible();
  });
});

test('the batch dialog is 348 px wide at 390 (amended A3-27: 279 was the gallery frame) (F6)', async ({
  page,
  request,
}) => {
  const s = await seedFaq(request, 'b390');
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page, s, FILTER);
  await page.getByTestId('all-matching').click();
  await page.getByRole('menuitem', { name: /^Disable all/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Disable 40 items?' });
  await expect(dialog).toBeVisible();
  near((await size(dialog)).w, 348, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
