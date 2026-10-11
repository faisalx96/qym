/** axe-core: no serious or critical violations in the live, file, error and empty states. */
import {
  control,
  detail,
  expectNoSeriousA11y,
  expect,
  finishLive,
  freshFile,
  INPUT,
  rowByInput,
  rows,
  startLive,
  test,
  LIVE,
} from './support';

test.describe('accessibility', () => {
  test('empty state', async ({ page, request }) => {
    await control(request, 'POST', '/ui/bare');
    await page.goto(LIVE);
    await expect(page.getByRole('heading', { name: 'Waiting for the first row' })).toBeVisible();
    await expectNoSeriousA11y(page, 'empty');
  });

  test('live run, with and without a row open', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await expectNoSeriousA11y(page, 'live list');
    await rowByInput(page, INPUT.diff).click();
    await expect(detail(page)).toBeVisible();
    await expectNoSeriousA11y(page, 'live detail');
    await finishLive(request);
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expectNoSeriousA11y(page, 'live finished');
  });

  test('saved file with an editable row and with an error row', async ({ page, request }) => {
    const { url } = await freshFile(request);
    await page.goto(url);
    await expect(rows(page)).toHaveCount(8);
    await expectNoSeriousA11y(page, 'file list');
    await rowByInput(page, INPUT.arabic).click();
    await page.getByLabel('New exact_match score').fill('0.5');
    await expectNoSeriousA11y(page, 'file detail, dirty editor');
    await page.locator('tbody tr[data-status="error"]').click();
    await expect(detail(page).getByRole('alert')).toBeVisible();
    await expectNoSeriousA11y(page, 'file error row');
    await rowByInput(page, INPUT.long).click();
    await expectNoSeriousA11y(page, 'file long row');
  });

  test.describe('load failures', () => {
    test.use({ allowConsoleIssues: true });
    test('missing file and unreachable server', async ({ page, request }) => {
      const { path } = await control<{ path: string }>(request, 'GET', '/file/missing');
      await page.goto(`http://127.0.0.1:8819/run/${encodeURIComponent(path)}`);
      await expect(page.getByRole('alert')).toContainText('Results file not found');
      await expectNoSeriousA11y(page, 'missing file');
      await page.route('**/api/**', (r) => r.abort('connectionrefused'));
      await page.reload();
      await expect(page.getByRole('alert')).toContainText('Could not reach');
      await expectNoSeriousA11y(page, 'unreachable');
    });
  });
});
