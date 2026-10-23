/** Multi-dataset round, WP-C (QC-25, QC-U45): a union results file in the local viewer. */
import { control, expect, expectNoSeriousA11y, FILE, rows, test } from './support';

async function unionFile(request: Parameters<typeof control>[0]): Promise<string> {
  const { path } = await control<{ path: string }>(request, 'POST', '/file/union');
  return `${FILE}/run/${encodeURIComponent(path)}`;
}

test('a union file shows its datasets, a Dataset column and a Dataset filter, computed from the rows', async ({
  page,
  request,
}) => {
  await page.goto(await unionFile(request));
  await expect(rows(page)).toHaveCount(8);
  // the header names every dataset with its item count
  await expect(page.locator('header')).toContainText('alpha v1 · 5 items');
  await expect(page.locator('header')).toContainText('beta v2 · 3 items');
  // the breakdown: one row per dataset, the whole run last
  const breakdown = page.getByTestId('dataset-breakdown');
  await expect(breakdown).toContainText('alpha');
  await expect(breakdown).toContainText('beta');
  await expect(breakdown).toContainText('All datasets');
  await expect(breakdown).toContainText('8');
  // alpha echoes its expected value (mean 1), beta never matches (mean 0), the run is 5/8
  await expect(breakdown).toContainText('1');
  await expect(breakdown).toContainText('0.625');
  // the Dataset column carries the source and the raw id
  await expect(page.getByTestId('data-table').getByRole('columnheader', { name: 'Dataset' })).toBeVisible();
  await expect(rows(page).first()).toContainText('alpha v1 · i0');
  // the filter narrows the rows and the URL
  await page.getByTestId('dataset-filter').selectOption('beta@v2');
  await expect(rows(page)).toHaveCount(3);
  await expect(page).toHaveURL(/dataset=beta%40v2/);
  await expect(page.getByText('3 of 8 rows')).toBeVisible();
  // Show N in the breakdown does the same
  await page.getByTestId('dataset-filter').selectOption('');
  await expect(rows(page)).toHaveCount(8);
  await breakdown.getByTestId('show-rows').first().click();
  await expect(rows(page)).toHaveCount(5);
  await expectNoSeriousA11y(page, 'union file');
});

test('a file without the tags opens exactly as before', async ({ page, request }) => {
  const { path } = await control<{ path: string }>(request, 'POST', '/file/fresh');
  await page.goto(`${FILE}/run/${encodeURIComponent(path)}`);
  await expect(rows(page)).toHaveCount(8);
  await expect(page.getByTestId('dataset-breakdown')).toHaveCount(0);
  await expect(page.getByTestId('dataset-filter')).toHaveCount(0);
  await expect(page.getByTestId('data-table').getByRole('columnheader', { name: 'Dataset' })).toHaveCount(0);
});
