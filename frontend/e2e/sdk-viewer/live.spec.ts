/** Journey 1 (watch a live run) and scenarios 1-2, plus the error/reconnect states. */
import { control, countText, expect, finishLive, rows, startLive, test, LIVE } from './support';

test.describe('live run', () => {
  test('empty state, then the first snapshot renders rows and stat counts', async ({ page, request }) => {
    await control(request, 'POST', '/ui/bare');
    await page.goto(LIVE);
    await expect(page.getByRole('heading', { name: 'Waiting for the first row' })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await control(request, 'POST', '/ui/tracker');
    await expect(rows(page)).toHaveCount(3);
    // the run block was registered after the page loaded: the header catches up by itself
    await expect(page.getByText('pushed-set', { exact: true })).toBeVisible();
    await expect(page.getByText('0 / 3 finished')).toBeVisible();
    await expect(page.locator('section[aria-label="Run progress"]')).toContainText('3 pending');
    await expect(page).toHaveTitle(/pushed-set \/ pushed-run/);

    await control(request, 'POST', '/ui/complete');
    await expect(page.getByText('1 / 3 finished')).toBeVisible();
    await expect(page.locator('tbody tr[data-row="0"]')).toHaveAttribute('data-status', 'completed');
  });

  test('a running evaluation shows every state, then done freezes the timer and replaces in_progress rows', async ({
    page,
    request,
  }) => {
    await startLive(request);
    await page.clock.install({ time: Date.now() });
    await page.goto(LIVE);

    await expect(rows(page)).toHaveCount(8);
    const progress = page.locator('section[aria-label="Run progress"]');
    await expect(page.getByText('5 / 8 finished')).toBeVisible();
    await expect(progress).toContainText('4 done');
    await expect(progress).toContainText('1 failed');
    await expect(progress).toContainText('2 running');
    await expect(progress).toContainText('1 pending');
    await expect(page.locator('tbody tr[data-status="in_progress"]')).toHaveCount(2);
    await expect(page.locator('tbody tr[data-status="pending"]')).toHaveCount(1);
    await expect(page.locator('tbody tr[data-status="error"]')).toHaveCount(1);
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/dataset\.csv \/ live-run/);

    // while running the elapsed timer advances
    const elapsed = progress.getByText(/^Elapsed\s*\d/);
    const before = await elapsed.textContent();
    await page.clock.fastForward(65_000);
    await expect(elapsed).not.toHaveText(before ?? '');

    await finishLive(request);
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.locator('tbody tr[data-status="in_progress"]')).toHaveCount(0);
    await expect(page.locator('tbody tr[data-status="pending"]')).toHaveCount(0);
    await expect(page.locator('tbody tr[data-row="5"]')).toHaveAttribute('data-status', 'completed');
    await expect(progress).toContainText('7 done');
    await expect(progress).toContainText('0 running');
    await expect(page.getByText('8 / 8 finished')).toBeVisible();

    // frozen: a minute later it reads the same
    const frozen = await elapsed.textContent();
    await page.clock.fastForward(60_000);
    await expect(elapsed).toHaveText(frozen ?? '');
    // and it is the real run duration, not a negative or hours-long timezone artefact
    expect(frozen).toMatch(/Elapsed\s*0:\d\d/);
  });

  test('a live run offers no score editing', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await rows(page).first().click();
    await expect(page.getByRole('heading', { name: 'Row 1' })).toBeVisible();
    await expect(page.getByLabel(/^New .* score$/)).toHaveCount(0);
    await finishLive(request);
  });

  test('the ribbon cell of a failure opens it in one step', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await page.getByRole('button', { name: 'Row 4: Error' }).click();
    await expect(page.getByRole('heading', { name: 'Row 4' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'boom: the task exploded' })).toBeVisible();
    await finishLive(request);
  });

  test('when the server goes away mid-run a reconnect banner appears', async ({ page, request }) => {
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await control(request, 'POST', '/ui/kill');
    await expect(page.getByText(/Lost the connection to the evaluation/)).toBeVisible();
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
    // the rows stay readable
    await expect(rows(page)).toHaveCount(8);
    await expect(countText(page)).toHaveText('8 of 8 rows');
  });
});

test.describe('unreachable server', () => {
  test.use({ allowConsoleIssues: true }); // the aborted requests are logged by the browser

  test('shows a visible error and recovers with Try again', async ({ page, request }) => {
    await startLive(request);
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await page.goto(LIVE);
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Cannot load this evaluation' })).toBeVisible();
    await expect(alert).toContainText('Could not reach the qym server');
    await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();

    await page.unroute('**/api/**');
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(rows(page)).toHaveCount(8);
    await finishLive(request);
  });
});
