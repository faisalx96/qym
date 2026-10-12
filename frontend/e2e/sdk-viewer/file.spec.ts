/** Journey 2 (open a saved file, edit a score) and scenario 3. */
import { readFileSync } from 'node:fs';
import {
  control,
  detail,
  ERROR_TEXT,
  expect,
  FILE,
  freshFile,
  INPUT,
  parseCsv,
  rowByInput,
  rows,
  test,
} from './support';

test.describe('saved file', () => {
  test('renders the rows with the Saved file badge and title', async ({ page, request }) => {
    const { url, path } = await freshFile(request);
    await page.goto(url);
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByText('Saved file', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/\(Saved\)$/);
    await expect(page).toHaveTitle(/saved-run/);
    // the file name chip carries the full path in its title
    await expect(page.locator('header').getByTitle(path)).toBeVisible();
    // a finished file has no Live/Reconnecting chrome and nothing is running
    await expect(page.locator('tbody tr[data-status="in_progress"]')).toHaveCount(0);
    await expect(page.getByText(/Lost the connection/)).toHaveCount(0);
  });

  test('a missing file shows a visible error with the path', async ({ page, request, consoleIssues }) => {
    const { path } = await control<{ path: string }>(request, 'GET', '/file/missing');
    test.info().annotations.push({ type: 'path', description: path });
    await page.goto(`${FILE}/run/${encodeURIComponent(path)}`);
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Results file not found' })).toBeVisible();
    await expect(alert).toContainText(path);
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
    // the browser logs the 404 itself; nothing else may be logged
    expect(consoleIssues.every((m) => /status of 404/.test(m))).toBe(true);
    consoleIssues.length = 0;
  });

  test.describe('a non-results path', () => {
    test.use({ allowConsoleIssues: true });
    test('is refused with the server message, not a blank page', async ({ page }) => {
      await page.goto(`${FILE}/run/${encodeURIComponent('/etc/passwd')}`);
      await expect(page.getByRole('alert')).toContainText('Only .csv and .xlsx');
    });
  });

  test('edits a score inline, writes it into the file and keeps it after a reload', async ({
    page,
    request,
  }) => {
    const { url, path } = await freshFile(request);
    await page.goto(url);
    await rowByInput(page, INPUT.wrong).click();
    await expect(detail(page)).toBeVisible();

    const input = page.getByLabel('New exact_match score');
    const save = detail(page).getByRole('button', { name: 'Save' }).first();
    await expect(input).toHaveValue('0');
    await expect(save).toBeDisabled();

    await input.fill('abc');
    await expect(page.getByText('Enter a number')).toBeVisible();
    await expect(save).toBeDisabled();

    await input.fill('1');
    await expect(detail(page).getByRole('button', { name: 'Cancel' }).first()).toBeVisible();
    await save.click();
    await expect(page.getByText('Saved to the results file')).toBeVisible();
    await expect(rowByInput(page, INPUT.wrong).locator('td').nth(4)).toHaveText('1');

    // on disk: the new score plus the audit trail of the original
    const [header, ...body] = parseCsv(readFileSync(path, 'utf8'));
    const col = (name: string) => header.indexOf(name);
    const edited = body.find((r) => r[col('input')] === INPUT.wrong);
    expect(edited?.[col('exact_match_score')]).toBe('1');
    expect(edited?.[col('exact_match__meta__original_score')]).toBe('0.0');
    expect(edited?.[col('exact_match__meta__modified')]).toBeTruthy();

    await page.reload();
    await expect(rows(page)).toHaveCount(8);
    await expect(rowByInput(page, INPUT.wrong).locator('td').nth(4)).toHaveText('1');
    await rowByInput(page, INPUT.wrong).click();
    await expect(page.getByLabel('New exact_match score')).toHaveValue('1');
  });

  test('cancel restores the stored score without saving', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await rowByInput(page, INPUT.wrong).click();
    const input = page.getByLabel('New length_ratio score');
    await input.fill('0.9');
    await detail(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(input).toHaveValue('0.25');
  });

  test('an error row has no score inputs and shows its message', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await page.locator('tbody tr[data-status="error"]').click();
    await expect(page.getByRole('alert').filter({ hasText: ERROR_TEXT })).toBeVisible();
    await expect(page.getByLabel(/^New .* score$/)).toHaveCount(0);
    await expect(detail(page).getByRole('button', { name: 'Save' })).toHaveCount(0);
    // a healthy row of the same file does have them (one per metric)
    await rowByInput(page, INPUT.arabic).click();
    await expect(page.getByLabel(/^New .* score$/)).toHaveCount(2);
  });
});
