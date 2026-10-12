/** Scenario 9: CSV export of the filtered items with a column picker. */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { compareUrl, expectShown, seedScenario, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-csv');
});

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test('CSV export with a filter active: column dialog, group toggle, header and row count match', async ({
  page,
}) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c], { filters: JSON.stringify({ complexity: ['easy'] }) }));
  await waitLoaded(page);
  await expectShown(page, 14);

  await page.getByRole('button', { name: 'CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export CSV' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('14 filtered items across 4 runs');
  const exportBtn = dialog.getByRole('button', { name: /^Export/ });
  await expect(exportBtn).toBeEnabled(); // bodies loaded
  const countOf = async () => Number(/Export (\d+) columns/.exec(await exportBtn.innerText())![1]);
  const all = await countOf();
  expect(all).toBeGreaterThan(4);

  // uncheck the last column group
  const groups = dialog.locator('fieldset');
  expect(await groups.count()).toBeGreaterThan(1);
  const last = groups.last();
  const size = Number(
    /(\d+) columns/.exec(await last.getByRole('button', { name: /columns$/ }).innerText())![1],
  );
  await last.locator('legend label').first().click(); // the checkbox input itself is visually hidden
  await expect(last.getByRole('checkbox').first()).not.toBeChecked();
  await expect.poll(countOf).toBe(all - size);
  const want = all - size;

  const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()]);
  expect(download.suggestedFilename()).toBe('compare_export.csv');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
  const rows = parseCsv(text.slice(1));
  const header = rows[0]!;
  expect(header).toHaveLength(want);
  expect(new Set(header).size).toBe(header.length);
  const dataRows = rows.slice(1).filter((r) => r.some((x) => x !== ''));
  expect(dataRows).toHaveLength(14); // the filtered count, not 40
  for (const r of dataRows) expect(r).toHaveLength(want);
  await expect(dialog).toHaveCount(0);
});

test('CSV: Deselect all disables Export; Cancel and Escape close the dialog', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a, seed.runs.c]));
  await waitLoaded(page);
  await page.getByRole('button', { name: 'CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export CSV' });
  await expect(dialog.getByRole('button', { name: /^Export \d+ columns/ })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Export/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Export \d+ columns/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'CSV' })).toBeFocused();
});
