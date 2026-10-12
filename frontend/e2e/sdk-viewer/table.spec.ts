/** Journey 3 (filter / sort) and scenarios 4-6, URL state, journey 5 and scenario 9 (export). */
import { countText, expect, freshFile, INPUT, METRICS, parseCsv, rowByInput, rows, test } from './support';
import type { Page } from '@playwright/test';

const open = async (page: Page, request: Parameters<typeof freshFile>[0]) => {
  const { url } = await freshFile(request);
  await page.goto(url);
  await expect(rows(page)).toHaveCount(8);
  return url;
};

/** Numeric cells of one table column, in display order (non-numbers skipped). */
async function column(page: Page, nth: number): Promise<number[]> {
  const cells = await rows(page)
    .locator('td')
    .evaluateAll((tds, n) => {
      const per = tds[0]?.parentElement?.children.length ?? 1;
      return tds.filter((_, i) => i % per === n).map((td) => td.textContent ?? '');
    }, nth);
  return cells.map(Number).filter((n) => !Number.isNaN(n) && n === n);
}

test.describe('search, filter, sort', () => {
  test('search narrows the rows, the count updates, clearing restores', async ({ page, request }) => {
    await open(page, request);
    await expect(countText(page)).toHaveText('8 of 8 rows');
    const search = page.getByRole('searchbox', { name: /Search input, output and expected/ });
    await search.fill('FOX');
    await expect(rows(page)).toHaveCount(1);
    await expect(countText(page)).toHaveText('1 of 8 rows');
    await expect(rows(page).first()).toContainText(INPUT.diff);
    await expect(page).toHaveURL(/[?&]q=FOX/);

    await search.fill('zzz-no-such-text');
    await expect(page.getByRole('heading', { name: 'No rows match' })).toBeVisible();
    await expect(countText(page)).toHaveText('0 of 8 rows');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows(page)).toHaveCount(8);
    await expect(search).toHaveValue('');

    // Arabic text is searchable too
    await search.fill('الرياض');
    await expect(rows(page)).toHaveCount(1);
    await search.fill('');
    await expect(countText(page)).toHaveText('8 of 8 rows');
  });

  test('status filter shows only errors and survives a sort by Time', async ({ page, request }) => {
    await open(page, request);
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('error');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-status', 'error');
    await expect(rows(page).first().getByText('Error', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Time', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: /Time/ })).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/status=error/);
    await expect(page).toHaveURL(/sort=latency/);
    await expect(rows(page)).toHaveCount(1);
    await expect(countText(page)).toHaveText('1 of 8 rows');

    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(rows(page)).toHaveCount(8);
    await expect(page).not.toHaveURL(/status=|sort=/);
  });

  test('a metric header sorts ascending, then descending, with aria-sort', async ({ page, request }) => {
    await open(page, request);
    const header = page.getByRole('columnheader', { name: new RegExp(METRICS[1]) });
    await expect(header).toHaveAttribute('aria-sort', 'none');

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=metric%3A1/);
    await expect(page).toHaveURL(/dir=asc/);
    const asc = await column(page, 5);
    expect(asc.length).toBe(7); // the error row has no score and always sorts last
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(asc[0]).toBe(0);
    await expect(rows(page).last()).toHaveAttribute('data-status', 'error');

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    const desc = await column(page, 5);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(desc[0]).toBe(1);
    await expect(rows(page).last()).toHaveAttribute('data-status', 'error');
    // other headers stay unsorted
    await expect(page.getByRole('columnheader', { name: /exact_match/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  test('view state round-trips through the URL', async ({ page, request }) => {
    const base = await open(page, request);
    await page.goto(`${base}?q=the&status=completed&sort=metric%3A1&dir=desc&row=2`);
    await expect(page.getByRole('searchbox')).toHaveValue('the');
    await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('completed');
    await expect(page.getByRole('columnheader', { name: new RegExp(METRICS[1]) })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.getByRole('heading', { name: 'Row 3' })).toBeVisible();
    await expect(rows(page).filter({ hasText: INPUT.diff })).toHaveCount(1);
    // every shown row matches: search over input/output/expected and the status filter
    for (const status of await rows(page).evaluateAll((trs) =>
      trs.map((t) => t.getAttribute('data-status')),
    )) {
      expect(status).toBe('completed');
    }

    // changing a control rewrites the URL and keeps the selected row
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('all');
    await expect(page).toHaveURL(/row=2/);
    await expect(page).not.toHaveURL(/status=/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Row 3' })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveValue('the');
  });
});

test.describe('export CSV', () => {
  test('the header and the row count equal the filtered table', async ({ page, request }) => {
    await open(page, request);
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('completed');
    await expect(countText(page)).toHaveText('7 of 8 rows');
    await page.getByRole('searchbox').fill('o'); // narrows further, still several rows
    const shown = await rows(page).count();
    expect(shown).toBeGreaterThan(1);
    expect(shown).toBeLessThan(7);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^qym_dataset\.csv_saved-run.*\.csv$/);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const table = parseCsv(readFileSync(path, 'utf8'));
    expect(table[0]).toEqual(['index', 'status', 'input', 'output', 'expected', ...METRICS, 'latency_ms']);
    expect(table.length - 1).toBe(shown);
    // the exported rows are exactly the visible ones, in display order
    const visible = await rows(page).evaluateAll((trs) =>
      trs.map((t) => Number(t.getAttribute('data-row')) + 1),
    );
    expect(table.slice(1).map((r) => Number(r[0]))).toEqual(visible);
    expect(table.slice(1).every((r) => r[1] === 'completed')).toBe(true);
  });

  test('Arabic and long text survive the export, and Export is off with no rows', async ({
    page,
    request,
  }) => {
    await open(page, request);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(await download.path(), 'utf8');
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    expect(raw).toContain(INPUT.arabic);
    expect(parseCsv(raw).length - 1).toBe(8);
    expect(await rowByInput(page, INPUT.long).count()).toBe(1);

    await page.getByRole('searchbox').fill('zzz-no-such-text');
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});
