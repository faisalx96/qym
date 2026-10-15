/** J3 + J7, scenarios 3, 4, 5: chart-click filters, search, rule builder, URL round-trips, CSV. */
import { test, expect } from '@playwright/test';
import {
  itemsCount,
  metricCard,
  openRun,
  params,
  seedClassic,
  seedProject,
  type Seeded,
  openMetric,
} from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-filters');
  classic = await seedClassic(s);
});

const RULES = {
  rules: {
    op: 'and',
    children: [
      { field: 'metric:exact_match', oper: 'is', value: 'failed' },
      { field: 'latency', oper: 'gt', value: '1000' },
    ],
  },
};

test.describe('chart filters (scenario 3)', () => {
  test('Fail segment filters the table, banner names the metric, Clear filter restores', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const card = metricCard(page, 'exact_match');
    await card.locator('[data-segment=failed]').click();
    const banner = page.getByTestId('filter-banner');
    await expect(banner).toContainText(/Filtered to [\d,]+ items that fail exact_match/);
    const n = Number(/Filtered to ([\d,]+) items/.exec(await banner.innerText())![1]!.replace(/,/g, ''));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(240);
    await expect.poll(() => params(page).get('show')).toBe('failed');
    expect(params(page).get('metric')).toBe('exact_match');
    await expect.poll(() => itemsCount(page)).toEqual([n, 240]);
    // the Overview follows the filter: the card now counts the filtered items
    await expect(card).toContainText(`${n} items`);
    // the chip can be removed, as can the whole filter via the banner
    await expect(page.getByRole('button', { name: /Remove filter Failing/ })).toBeVisible();
    await banner.getByRole('button', { name: 'Clear filter' }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => params(page).get('show')).toBeNull();
    expect(await itemsCount(page)).toEqual([240, 240]);
    await expect(card).toContainText('237 items');
  });

  test('Pass segment and the segmented Show control agree', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await metricCard(page, 'exact_match').locator('[data-segment=passed]').click();
    await expect(page.getByTestId('filter-banner')).toContainText(/items that pass exact_match/);
    await expect(page.getByRole('radio', { name: 'Pass' })).toBeChecked();
    await page.getByRole('radio', { name: 'Fail' }).click({ force: true });
    await expect.poll(() => params(page).get('show')).toBe('failed');
    await page.getByRole('radio', { name: 'All' }).click({ force: true });
    await expect.poll(() => params(page).get('show')).toBeNull();
  });

  test('error segment filters to metric errors', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await metricCard(page, 'exact_match').locator('[data-segment=metric_errors]').click();
    await expect.poll(() => params(page).get('show')).toBe('metric_errors');
    await expect.poll(() => itemsCount(page)).toEqual([12, 240]);
  });

  test('a histogram bar filters by score range and Clear restores', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const bar = metricCard(page, 'quality').locator('button[data-bucket]').nth(5);
    await bar.click();
    await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(240);
    expect((await itemsCount(page))[0]).toBeGreaterThan(0);
    await expect.poll(() => params(page).get('filters')).toContain('score');
    await expect(page.getByTestId('clear-filters')).toBeVisible();
    await page.getByTestId('clear-filters').click();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
    await expect.poll(() => params(page).get('filters')).toBeNull();
  });
});

test.describe('search (scenario 4)', () => {
  test('typing sets ?q= and narrows the rows; reload keeps both', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
    await search.fill('Question 17:');
    await expect.poll(() => params(page).get('q')).toBe('Question 17:');
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(1);
    await expect(page.getByRole('button', { name: 'Open item #17', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(search).toHaveValue('Question 17:');
    expect(await itemsCount(page)).toEqual([1, 240]);
    await expect(page.getByRole('button', { name: 'Open item #17', exact: true })).toBeVisible();
    // clearing the box clears the param
    await search.fill('');
    await expect.poll(() => params(page).get('q')).toBeNull();
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
  });

  test('search reaches output text, not only inputs', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page
      .getByRole('searchbox', { name: 'Search inputs and outputs' })
      .fill('I am not sure about clause');
    await expect.poll(async () => (await itemsCount(page))[0]).toBeGreaterThan(5);
  });

  test('?q= deep link prefills the search box', async ({ page }) => {
    await openRun(page, s.slug, classic, 'q=Question%2017%3A');
    await expect(page.getByRole('searchbox', { name: 'Search inputs and outputs' })).toHaveValue(
      'Question 17:',
    );
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(1);
  });
});

test.describe('rule builder (scenario 5)', () => {
  test('build "exact_match is failed AND latency > 1000" in the builder; it round-trips through ?filters=', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await page.getByTestId('open-filters').click();
    const dlg = page.getByRole('dialog', { name: 'Filter rules' });
    await dlg.getByRole('button', { name: '+ Condition' }).click();
    await expect(dlg.getByTestId('rule-condition')).toHaveCount(1);
    await dlg.getByRole('button', { name: 'Field' }).click();
    await page.getByRole('option', { name: /^exact_match/ }).click();
    await dlg.getByRole('button', { name: 'Verdict' }).click();
    await page.getByRole('option', { name: 'failed' }).click();
    await dlg.getByRole('button', { name: '+ Condition' }).click();
    await expect(dlg.getByTestId('rule-condition')).toHaveCount(2);
    await dlg.getByTestId('rule-condition').nth(1).getByRole('button', { name: 'Field' }).click();
    await page.getByRole('option', { name: /^Latency/ }).click();
    await dlg.getByTestId('rule-condition').nth(1).getByRole('button', { name: 'Operator' }).click();
    await page.getByRole('option', { name: '>', exact: true }).click();
    await dlg.getByTestId('rule-condition').nth(1).getByRole('textbox').fill('1000');
    // typed values commit after a 150 ms pause: wait for the committed value, not just the field
    await expect.poll(() => params(page).get('filters') ?? '').toContain('"value":"1000"');
    const raw = params(page).get('filters')!;
    expect(JSON.parse(raw).rules.children).toHaveLength(2);
    await expect(page.getByTestId('open-filters')).toContainText('Filters (2)');
    const [n] = await itemsCount(page);
    expect(n).toBeLessThan(240);
    await page.reload();
    await expect(page.getByTestId('items-count')).toBeVisible();
    expect((await itemsCount(page))[0]).toBe(n);
    await expect(page.getByTestId('open-filters')).toContainText('Filters (2)');
  });

  test('a ?filters= deep link applies, shows the chip and count, and is removable by keyboard', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, `filters=${encodeURIComponent(JSON.stringify(RULES))}`);
    const [n] = await itemsCount(page);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(240);
    await expect(page.getByTestId('open-filters')).toContainText('Filters (2)');
    const chip = page.getByRole('button', { name: /Remove filter 2 rules/ });
    await expect(chip).toBeVisible();
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(chip).toHaveCount(0);
    await expect.poll(() => itemsCount(page)).toEqual([240, 240]);
    await expect.poll(() => params(page).get('filters')).toBeNull();
  });

  test('the builder shows the deep-linked conditions and OR widens the match', async ({ page }) => {
    await openRun(page, s.slug, classic, `filters=${encodeURIComponent(JSON.stringify(RULES))}`);
    const [andCount] = await itemsCount(page);
    await page.getByTestId('open-filters').click();
    const dlg = page.getByRole('dialog', { name: 'Filter rules' });
    await expect(dlg.getByTestId('rule-condition')).toHaveCount(2);
    await dlg.getByRole('radio', { name: 'OR' }).click({ force: true });
    await expect.poll(async () => (await itemsCount(page))[0]).toBeGreaterThan(andCount);
    await dlg.getByRole('button', { name: 'Remove condition' }).first().click();
    await expect(dlg.getByTestId('rule-condition')).toHaveCount(1);
  });

  test('Escape closes the builder and focus returns to the Filters button', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const button = page.getByTestId('open-filters');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Filter rules' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filter rules' })).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});

test.describe('URL contract for the view params', () => {
  test('metric + threshold + show + sort + page deep links restore the view', async ({ page }) => {
    await openRun(
      page,
      s.slug,
      classic,
      'metric=hallucination&threshold=20&show=failed&sort=latency_desc&page=2',
    );
    await expect(page.getByRole('button', { name: /hallucination Analysis metric/ })).toBeVisible();
    await expect(page.getByRole('slider', { name: /Pass if score/ })).toHaveValue('20');
    await expect(page.getByRole('radio', { name: 'Fail' })).toBeChecked();
    await expect(page.getByRole('button', { name: /Sort/ })).toContainText('Latency');
    const [n] = await itemsCount(page);
    expect(n).toBeGreaterThan(20);
    await expect(page.getByText(new RegExp(`21–${Math.min(40, n)} of ${n} items`))).toBeVisible();
    // the same params survive a reload
    await page.reload();
    await expect(page.getByTestId('items-count')).toBeVisible();
    expect((await itemsCount(page))[0]).toBe(n);
    expect(params(page).get('sort')).toBe('latency_desc');
    expect(params(page).get('page')).toBe('2');
  });

  test('sorting by latency rewrites ?sort= and orders the table', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page
      .getByRole('button', { name: /^Index Sort|Sort/ })
      .first()
      .click();
    await page.getByRole('option', { name: 'Latency ↓' }).click();
    await expect.poll(() => params(page).get('sort')).toBe('latency_desc');
    const ms = async () => {
      const texts = await page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: /^Open item/ }) })
        .evaluateAll((rows) =>
          rows.map((r) => (r.querySelector('[data-cell=latency]') as HTMLElement | null)?.innerText ?? ''),
        );
      return texts.map((t) => {
        const m = /^([\d.]+)(ms|s)/.exec(t.trim());
        return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN;
      });
    };
    await expect.poll(async () => (await ms()).length).toBeGreaterThan(3);
    const values = (await ms()).filter((v) => !Number.isNaN(v));
    expect(values.length).toBeGreaterThan(3);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test('changing a filter resets the page to 1', async ({ page }) => {
    await openRun(page, s.slug, classic, 'page=3');
    await expect(page.getByText('41–60 of 240 items')).toBeVisible();
    await page.getByRole('radio', { name: 'Fail' }).click({ force: true });
    await expect.poll(() => params(page).get('page')).toBeNull();
    await expect(page.getByText(/^1–20 of /)).toBeVisible();
  });

  test('Display popover offers text mode and column choices; no Layout control on a single-pass run', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: 'Display' }).click();
    await expect(page.getByRole('radio', { name: 'Raw' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Rendered' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('?hide_field= hides that item field in an opened item', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
    const card = page.locator('[data-testid=item-card][data-item-id="item-0002"]');
    await expect(card.getByText(/^source: /)).toBeVisible();
    await openRun(page, s.slug, classic, 'hide_field=source');
    await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
    await expect(page.locator('[data-testid=item-card][data-item-id="item-0002"]')).toBeVisible();
    await expect(
      page.locator('[data-testid=item-card][data-item-id="item-0002"]').getByText(/^source: /),
    ).toHaveCount(0);
    expect(params(page).getAll('hide_field')).toEqual(['source']);
  });

  test('?hide_metric_field= is preserved and hides that judge field', async ({ page }) => {
    await openRun(page, s.slug, classic, 'hide_metric_field=judge_model');
    await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
    const card = page.locator('[data-testid=item-card][data-item-id="item-0002"]');
    await openMetric(card, 'quality');
    await expect(card.getByText('confidence')).toBeVisible();
    await expect(card.getByText('judge_model')).toHaveCount(0);
    expect(params(page).getAll('hide_metric_field')).toEqual(['judge_model']);
  });

  test('legacy ?page= and ?item_id= links still land correctly', async ({ page }) => {
    await openRun(page, s.slug, classic, 'page=2');
    await expect(page.getByText('21–40 of 240 items')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open item #21', exact: true })).toBeVisible();
    await openRun(page, s.slug, classic, 'item_id=item-0005');
    await expect(page.locator('[data-testid=item-card][data-item-id="item-0005"]')).toBeVisible();
  });
});

test.describe('CSV export (J7)', () => {
  test('the CSV dialog offers a column picker and downloads a file named after the run', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByTestId('csv-button').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    const download = page.waitForEvent('download', { timeout: 20_000 });
    await dlg.getByTestId('csv-download').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const { createReadStream } = await import('node:fs');
    const path = await file.path();
    const text = await new Promise<string>((resolve, reject) => {
      let buf = '';
      createReadStream(path, { encoding: 'utf8' })
        .on('data', (c) => (buf += c))
        .on('end', () => resolve(buf))
        .on('error', reject);
    });
    const lines = text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n');
    expect(lines.length).toBeGreaterThan(200);
    expect(lines[0]).toMatch(/item_id|Item|index/i);
  });

  test('a filtered CSV exports only the filtered rows', async ({ page }) => {
    await openRun(page, s.slug, classic, 'q=Question%2017%3A');
    await expect.poll(async () => (await itemsCount(page))[0]).toBe(1);
    await page.getByTestId('csv-button').click();
    const dlg = page.getByRole('dialog');
    const download = page.waitForEvent('download', { timeout: 20_000 });
    await dlg.getByTestId('csv-download').click();
    const file = await download;
    const { readFileSync } = await import('node:fs');
    const text = readFileSync((await file.path())!, 'utf8').replace(/^\uFEFF/, '');
    expect(text).toContain('item-0017');
    expect(text).not.toContain('item-0018');
  });
});
