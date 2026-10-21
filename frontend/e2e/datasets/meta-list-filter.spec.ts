/**
 * QA round, point 1 (spec QA1-1 to QA1-30): list-valued metadata keys in the filter, with Partial / Full match.
 * Server rules are pinned in tests/platform/test_dataset_meta_lists.py; here the numbers are measured at 1440, 1024 and 390.
 * Seed: a draft `support-faq` with the design seed's 130 items (list keys tags, source.labels, levels, mixed channels).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { listMetadataItems, near, size, WIDTHS } from './access-support';
import { bulkItems, createDataset, createVersion } from './support';
import { query } from './ui';

interface Seed {
  slug: string;
  ds: string;
}

async function seedList(request: APIRequestContext, prefix: string): Promise<Seed> {
  const project = await createProject(request, `Lists ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, project.slug, 'support-faq');
  const v = await createVersion(request, project.slug, d.slug);
  await bulkItems(request, project.slug, d.slug, v.version, listMetadataItems(130));
  return { slug: project.slug, ds: d.slug };
}

async function open(page: Page, s: Seed, search = '') {
  await gotoApp(page, `/projects/${s.slug}/datasets/${s.ds}?tab=items&v=v1${search ? `&${search}` : ''}`);
  await expect(page.locator('[data-dt-toolbar]')).toBeVisible();
  await expect(page.getByTestId('items-state')).toContainText('Active');
}

async function pickKey(page: Page, name: RegExp) {
  const popover = page.getByTestId('meta-popover');
  await popover.getByRole('button', { name: /Key/ }).click();
  await page.getByRole('option', { name }).click();
}

const choose = (page: Page, value: RegExp) =>
  page.getByTestId('facet-values').getByRole('option', { name: value }).click();
const modeLabel = (page: Page, text: string) =>
  page.getByTestId('meta-match').locator('label', { hasText: text });
const count = (page: Page, n: number) =>
  expect(page.locator('[data-dt-toolbar]')).toContainText(`${n} items`);

test.describe('keys and values (QA1-2 to QA1-8)', () => {
  test('list and mixed keys are listed with their descriptions; attachments and flags are not (QA1-2)', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'keys');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await page.getByTestId('meta-popover').getByRole('button', { name: /Key/ }).click();
    const options = page.getByRole('listbox').filter({ hasText: 'source.region.code' }).getByRole('option');
    expect((await options.allInnerTexts()).map((o) => o.replace(/\s+/g, ' ').trim())).toEqual([
      'channels 3 values · list or value',
      'difficulty 3 values',
      'domain 4 values',
      'levels 4 values · list',
      'source.channel 2 values',
      'source.labels 5 values · list',
      'source.region.code 4 values',
      'tags 8 values · list',
    ]);
  });

  test('Partial 46, Full match 6 for billing + refund; chip, URL, reload, remove (QA1-19 to QA1-23, QA1-29)', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'any');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^tags/);
    const values = page.getByTestId('facet-values');
    await expect(values).toHaveAttribute('aria-multiselectable', 'true');
    const rows = await values.getByRole('option').allInnerTexts();
    expect(rows.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual([
      'billing 26',
      'refund 26',
      'account 25',
      'arabic 25',
      'shipping 25',
      'vip 25',
      'fraud 24',
      'urgent 24',
    ]);
    await expect(page.getByTestId('facet-selected-count')).toHaveText('None selected');
    await expect(page.getByTestId('meta-match-help')).toHaveText(
      'Choose two or more values to pick a match mode.',
    );
    await expect(page.getByRole('button', { name: 'Add filter' })).toBeDisabled();
    await choose(page, /refund/);
    await choose(page, /billing/);
    await expect(page.getByTestId('facet-selected-count')).toHaveText('2 selected');
    await expect(page.getByTestId('meta-match-help')).toHaveText(
      'Items that have at least one of the chosen values.',
    );
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-popover')).toHaveCount(0);
    // QA1-19: values in facet order, the mode in the suffix; QA1-22: the URL.
    const chip = page.getByTestId('meta-chip');
    await expect(chip).toHaveText('tags: billing, refund (any)');
    const b = await size(chip.locator('xpath=..'));
    near(b.h, 26, 0.5);
    expect(query(page).getAll('meta')).toEqual(['tags:billing', 'tags:refund']);
    expect(query(page).getAll('meta_mode')).toEqual(['tags:any']);
    await count(page, 46);
    // QA1-29: focus lands on the new chip.
    await expect(chip).toBeFocused();
    // Reload restores the chip.
    await page.reload();
    await expect(page.getByTestId('meta-chip')).toHaveText('tags: billing, refund (any)');
    await count(page, 46);
    // Switch to Full match through a fresh popover on another path: one chip per path, the old one replaced.
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^tags/);
    await choose(page, /billing/);
    await choose(page, /refund/);
    await modeLabel(page, 'Full match').click();
    await expect(page.getByTestId('meta-match-help')).toHaveText(
      'Items that have every chosen value. An item may have more.',
    );
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveText('tags: billing, refund (all)');
    expect(query(page).getAll('meta_mode')).toEqual(['tags:all']);
    await expect(page.getByTestId('meta-chip')).toHaveCount(1);
    await count(page, 6);
    // QA1-23: the remove button's name and the URL clean-up; focus returns to Metadata.
    await page.getByRole('button', { name: 'Remove filter tags: billing, refund (all)' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveCount(0);
    expect(query(page).getAll('meta')).toEqual([]);
    expect(query(page).getAll('meta_mode')).toEqual([]);
    await count(page, 130);
    await expect(page.getByTestId('metadata-filter')).toBeFocused();
  });

  test('a single value writes no meta_mode and no suffix; the Match control needs two values (QA1-10, QA1-19)', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'single');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^tags/);
    await choose(page, /billing/);
    await expect(modeLabel(page, 'Partial').locator('input')).toBeDisabled();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveText('tags: billing');
    expect(query(page).getAll('meta')).toEqual(['tags:billing']);
    expect(query(page).getAll('meta_mode')).toEqual([]);
    await count(page, 26);
  });

  test('a mixed key counts both the lists and the plain values (QA1-14)', async ({ page, request }) => {
    const s = await seedList(request, 'mixed');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^channels/);
    const rows = await page.getByTestId('facet-values').getByRole('option').allInnerTexts();
    expect(rows.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual(['chat 87', 'email 87', 'phone 22']);
    await choose(page, /chat/);
    await choose(page, /phone/);
    await expect(modeLabel(page, 'Partial').locator('input')).toBeChecked();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveText('channels: chat, phone (any)');
    await count(page, 87);
    await expect(page.getByTestId('meta-chip')).toBeFocused();
  });

  test('scalar keys stay single choice (QA1-13) and combine with a list chip', async ({ page, request }) => {
    const s = await seedList(request, 'scalar');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^domain/);
    await expect(page.getByTestId('meta-match')).toHaveCount(0);
    await expect(page.getByTestId('facet-values')).not.toHaveAttribute('aria-multiselectable', 'true');
    await choose(page, /finance/);
    await choose(page, /health/);
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveText('domain: health');
    await page.getByTestId('metadata-filter').click();
    await pickKey(page, /^tags/);
    await choose(page, /billing/);
    await choose(page, /refund/);
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByTestId('meta-chip')).toHaveCount(2);
    const expected = listMetadataItems(130).filter((i) => {
      const m = i.metadata as { domain: string; tags: string[] };
      return m.domain === 'health' && (m.tags.includes('billing') || m.tags.includes('refund'));
    }).length;
    await count(page, expected);
  });

  test('the limit line appears at 20 chosen values (QA1-8)', async ({ page, request }) => {
    const project = await createProject(request, 'Lists limit', uniqueSlug('lim'));
    const d = await createDataset(request, project.slug, 'many');
    const v = await createVersion(request, project.slug, d.slug);
    await bulkItems(request, project.slug, d.slug, v.version, [
      {
        item_id: 'a',
        input: 'q',
        metadata: { k: Array.from({ length: 24 }, (_, n) => `v${String(n).padStart(2, '0')}`) },
      },
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoApp(page, `/projects/${project.slug}/datasets/${d.slug}?tab=items&v=v1`);
    await page.getByTestId('metadata-filter').click();
    const values = page.getByTestId('facet-values');
    for (let n = 0; n < 20; n += 1)
      await values.getByRole('option', { name: new RegExp(`^v${String(n).padStart(2, '0')}`) }).click();
    await expect(page.getByTestId('facet-selected-count')).toHaveText('20 selected');
    await expect(page.getByTestId('facet-limit')).toHaveText('You can choose up to 20 values.');
    await expect(values.getByRole('option', { name: /^v20/ })).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('typed values of a truncated list key (QA1-15)', () => {
  test('the same unlisted value typed twice is one choice and no meta_mode', async ({ page, request }) => {
    const s = await seedList(request, 'dup');
    await page.route(/items:metadata-facets/, (route) =>
      route.fulfill({
        json: {
          paths: [
            {
              path: 'els',
              kind: 'list',
              values: Array.from({ length: 200 }, (_, n) => ({ value: `k${n}`, count: 200 - n })),
              truncated: true,
              value_count: 340,
            },
          ],
          truncated: false,
        },
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s);
    await page.getByTestId('metadata-filter').click();
    const box = page.getByRole('searchbox', { name: 'Find a value' });
    await box.fill('k299');
    await box.press('Enter');
    await box.fill('k299');
    await box.press('Enter');
    await expect(page.getByTestId('facet-selected-count')).toHaveText('1 selected');
    await page.getByRole('button', { name: 'Add filter' }).click();
    expect(query(page).getAll('meta')).toEqual(['els:k299']);
    expect(query(page).getAll('meta_mode')).toEqual([]);
  });
});

test.describe('geometry (QA1-4, QA1-12, QA1-20, QA1-21)', () => {
  for (const width of WIDTHS) {
    test(`popover heights and chip sizes at ${width}px`, async ({ page, request }) => {
      const s = await seedList(request, `geo${width}`);
      // a tall viewport: the popover is height-limited by the room the viewport leaves (it scrolls inside then)
      await page.setViewportSize({ width, height: 1500 });
      await open(page, s);
      await page.getByTestId('metadata-filter').click();
      const popover = page.getByTestId('meta-popover');
      await pickKey(page, /^tags/);
      const empty = await size(popover);
      near(empty.w, 320, 0.5);
      near(empty.h, 519.7, 0.6);
      near((await size(page.getByTestId('facet-values'))).w, 290, 0.5);
      near((await size(page.getByTestId('facet-values'))).h, 266, 0.5);
      near((await size(page.getByTestId('meta-match'))).h, 58.8, 0.5);
      // QA1-12: the height does not change with two chosen values in either mode.
      await choose(page, /billing/);
      await choose(page, /refund/);
      near((await size(popover)).h, empty.h, 0.1);
      await modeLabel(page, 'Full match').click();
      near((await size(popover)).h, empty.h, 0.1);
      await pickKey(page, /^channels/);
      near((await size(popover)).h, 359.7, 0.6);
      await pickKey(page, /^domain/);
      near((await size(popover)).h, 318.9, 0.6);
      await page.keyboard.press('Escape');
      const button = await size(page.getByTestId('metadata-filter'));
      expect([button.w, button.h]).toEqual([98, 24]);
    });
  }

  for (const [width, long, rowThree, rowFive] of [
    [1440, [403, 26], 26, 26],
    [1024, [403, 26], 26, 56],
    [390, [261, 38.6], 86, 158.6], // amended: the chip row is 261 px wide in the page (the spec's 279 was the column)
  ] as const) {
    test(`chips wrap instead of overflowing at ${width}px (QA1-20, QA1-21)`, async ({ page, request }) => {
      const s = await seedList(request, `chips${width}`);
      await page.setViewportSize({ width, height: 900 });
      await open(
        page,
        s,
        'meta=domain:finance&meta=tags:billing&meta=tags:refund&meta_mode=tags:all&meta=channels:chat&meta=channels:phone&meta_mode=channels:any',
      );
      const chips = page.getByTestId('filter-chips');
      await expect(page.getByTestId('meta-chip')).toHaveCount(3);
      const sizes = await chips
        .locator('> *')
        .evaluateAll((els) =>
          els.map((e) => [
            e.textContent,
            +e.getBoundingClientRect().width.toFixed(1),
            +e.getBoundingClientRect().height.toFixed(1),
          ]),
        );
      expect(sizes).toEqual([
        ['domain: finance', 136, 26],
        ['tags: billing, refund (all)', 178, 26],
        ['channels: chat, phone (any)', 198, 26],
      ]);
      near((await size(chips)).h, rowThree, 0.6);
      await open(
        page,
        s,
        'meta=domain:finance&meta=tags:billing&meta=tags:refund&meta_mode=tags:all&meta=source.labels:gold&meta=source.labels:silver&meta=source.labels:reviewed&meta=source.labels:needs-review&meta=source.labels:synthetic&meta_mode=source.labels:all&meta=channels:chat&meta=source.region.code:sa',
      );
      await expect(page.getByTestId('meta-chip')).toHaveCount(5);
      const longChip = chips.locator('> *').nth(2);
      await expect(longChip).toContainText(
        'source.labels: gold, silver, reviewed, needs-review, synthetic (all)',
      );
      const lb = await size(longChip);
      near(lb.w, long[0], 0.6);
      near(lb.h, long[1], 0.6);
      near((await size(chips)).h, rowFive, 0.6);
      const fits = await chips.evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth }));
      expect(fits.fits).toBe(true);
      const chipButton = longChip.locator('button').first();
      expect(await chipButton.evaluate((el) => getComputedStyle(el).textOverflow)).not.toBe('ellipsis');
    });
  }
});

test.describe('URL rules and the five-path limit (QA1-22, QA1-24)', () => {
  test('a bad mode, a mode without meta and a duplicate are dropped by the page', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'url');
    await page.setViewportSize({ width: 1440, height: 900 });
    // bad mode -> all (the API default); a mode for a path without meta is ignored
    await open(
      page,
      s,
      'meta=tags:billing&meta=tags:refund&meta_mode=tags:bogus&meta_mode=levels:any&meta=tags:billing',
    );
    await expect(page.getByTestId('meta-chip')).toHaveText('tags: billing, refund (all)');
    await count(page, 6);
  });

  test('the Metadata button is disabled at five paths, not five values (QA1-1, QA1-24)', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'limit5');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(
      page,
      s,
      'meta=tags:billing&meta=tags:refund&meta_mode=tags:any&meta=domain:finance&meta=difficulty:0',
    );
    await expect(page.getByTestId('metadata-filter')).toBeEnabled();
    await open(
      page,
      s,
      'meta=tags:billing&meta=tags:refund&meta_mode=tags:any&meta=domain:finance&meta=difficulty:0&meta=channels:chat&meta=source.channel:chat',
    );
    await expect(page.getByTestId('metadata-filter')).toHaveAttribute('data-limit', '');
    await page.getByTestId('metadata-filter').focus();
    await expect(page.getByRole('tooltip')).toHaveText('You can combine up to 5 metadata filters.');
  });
});

test.describe('All matching on a list filter (QA1-25)', () => {
  test('the dialog names the filter with its values and the batch carries {values, mode}', async ({
    page,
    request,
  }) => {
    const s = await seedList(request, 'batch');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, s, 'meta=tags:billing&meta=tags:refund&meta_mode=tags:any');
    const bodies: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('items:batch')) bodies.push(r.postDataJSON());
    });
    await page.getByTestId('all-matching').click();
    await expect(page.getByRole('menuitem', { name: 'Disable all 46 matching…' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Disable all 46 matching…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('tags: billing, refund (any)');
    await expect(dialog).toContainText('46');
    expect(bodies[0]).toMatchObject({
      filter: { meta: { tags: { values: ['billing', 'refund'], mode: 'any' } } },
      action: 'disable',
      dry_run: true,
    });
  });
});
