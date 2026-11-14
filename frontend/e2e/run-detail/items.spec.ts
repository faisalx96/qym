/** J6, J8, scenarios 6, 7, 9: open an item in the pane, deep link, copy link, edit scores, locked/read-only runs, root-cause issues. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  showItems,
  clickItemRow,
  itemButton,
  itemPane,
  openRootCause,
  openRun,
  paneBlock,
  params,
  scrollTop,
  seedClassic,
  seedLocked,
  seedProject,
  seedRepeat,
  type Seeded,
  metricRow,
  goToSection,
} from './support';

let s: Seeded;
let classic: string;
let locked: string;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-items');
  classic = await seedClassic(s);
  locked = await seedLocked(s);
  repeat = await seedRepeat(s);
});

/** The item pane of one item (the item opens in a pane at the side of the items table). */
const card = (page: Page, id: string) => itemPane(page, id);
const tableRow = (page: Page, id: string) => page.locator(`tr[data-item-id="${id}"]`);
/** The pencil tile of a metric row; it opens the score editor in the Reason cell of the same row. */
const editTile = (pane: Locator, metric: string) =>
  pane.getByRole('button', { name: `Edit the ${metric} score`, exact: true });
/** The "edited" tag in the name cell of a metric row. */
const editedTag = (row: Locator) => row.getByText('edited', { exact: true });

test.describe('open an item (scenario 6, J6)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('bodies load through an items/details POST, ?item= is set, the pane shows input/expected/output/metrics', async ({
    page,
  }) => {
    const details: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/items\/details/.test(r.url())) details.push(r.postData() ?? '');
    });
    await openRun(page, s.slug, classic);
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await expect(c).toBeVisible();
    // the pane is a complementary landmark named after the item number
    await expect(page.getByRole('complementary', { name: 'Item #2' })).toBeVisible();
    await expect(
      c.getByText('Question 2: what does clause 1 of the finance policy require?').first(),
    ).toBeVisible();
    await expect(paneBlock(c, 'expected')).toContainText('Clause 1 requires written approval.');
    await expect(paneBlock(c, 'output')).toContainText(
      'Clause 1 requires written approval from the finance lead',
    );
    for (const m of ['exact_match', 'quality', 'hallucination', 'tokens_used']) {
      await expect(metricRow(c, m)).toBeVisible();
    }
    await expect.poll(() => params(page).get('item')).toBe('item-0002');
    // the first request asks for the open item. The pane then loads the two neighbour items in advance (Frame.tsx),
    // so the number of POSTs is not 1 any more.
    expect(details.length).toBeGreaterThanOrEqual(1);
    expect(details[0]).toContain('item-0002');
    // the open item is the current row of the table; the row has no expanded state
    const row = tableRow(page, 'item-0002');
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row).not.toHaveAttribute('aria-expanded');
    await c.getByRole('button', { name: 'Close item', exact: true }).click();
    await expect(c).toHaveCount(0);
    await expect(row).not.toHaveAttribute('aria-current');
    await expect.poll(() => params(page).get('item')).toBeNull();
  });

  test('Arabic input renders right-to-left', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await showItems(page);
    await itemButton(page, 15).click();
    const c = card(page, 'item-0015');
    await expect(c).toBeVisible();
    await expect(c.locator('[dir=rtl]').first()).toBeVisible();
  });

  test('a dict input is shown as structured fields', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 1).click();
    const c = card(page, 'item-0001');
    await expect(c).toBeVisible();
    const input = paneBlock(c, 'input');
    // each key of the JSON input is a term of the field list
    await expect(input.locator('[data-part="key"]', { hasText: 'prompt' })).toBeVisible();
    await expect(input.locator('[data-part="key"]', { hasText: 'context' })).toBeVisible();
    // the raw JSON switch changes its own block only
    await input.getByRole('button', { name: 'Show the raw JSON', exact: true }).click();
    await expect(input.getByLabel('Input, raw JSON')).toContainText('"prompt"');
    await expect(input.getByRole('button', { name: 'Show the fields', exact: true })).toBeVisible();
  });

  test('reload with ?item= reopens that item on its page and scrolls its row into view', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0100');
    const c = card(page, 'item-0100');
    const row = tableRow(page, 'item-0100');
    await expect(c).toBeVisible();
    await expect(page.getByText(/81–100 of 240 items/)).toBeVisible();
    await expect(row).toBeInViewport();
    await expect(row).toHaveAttribute('aria-current', 'true');
    // reload keeps it open and in view
    await page.reload();
    await expect(c).toBeVisible();
    await expect(row).toBeInViewport();
    expect(params(page).get('item')).toBe('item-0100');
  });

  test('the deep-link highlight clears even when the page changes under it, and a click does not highlight', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, 'item=item-0100');
    const row = page.locator('tr[data-item-id="item-0100"][data-open]');
    await expect(row).toHaveAttribute('data-highlight', 'true');
    await expect(row).not.toHaveAttribute('data-highlight', 'true', { timeout: 6000 });
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    await expect(card(page, 'item-0004')).toBeVisible();
    await expect(page.locator('tr[data-item-id="item-0004"][data-highlight]')).toHaveCount(0);
  });

  test('in-page URL changes (search, opening an item) keep the scroll position', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await showItems(page);
    const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
    const before = (await search.boundingBox())!.y;
    // a filter write (search) changes the URL in place; the scope bar appearing above must not jump the view
    await search.fill('item');
    await expect(page).toHaveURL(/q=item/);
    await expect.poll(async () => Math.abs((await search.boundingBox())!.y - before)).toBeLessThan(120);
    const settled = await scrollTop(page);
    await itemButton(page, 5).evaluate((el) => (el as HTMLElement).click());
    await expect(page).toHaveURL(/item=item-0005/);
    await expect(card(page, 'item-0005')).toBeVisible();
    expect(Math.abs((await scrollTop(page)) - settled)).toBeLessThan(5);
  });

  test('Escape closes the item pane, drops ?item and gives the focus to its row (C231)', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 3).click();
    await expect(card(page, 'item-0003')).toBeVisible();
    // from a control of the pane (its tooltip is open: the same press closes the pane)
    await card(page, 'item-0003').getByRole('button', { name: 'Copy link', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(card(page, 'item-0003')).toHaveCount(0);
    await expect.poll(() => params(page).get('item')).toBeNull();
    await expect(tableRow(page, 'item-0003')).toBeFocused();
    // Enter on the focused row opens the item again; Escape with focus on the row closes it too
    await page.keyboard.press('Enter');
    await expect(card(page, 'item-0003')).toBeVisible();
    await tableRow(page, 'item-0003').focus();
    await page.keyboard.press('Escape');
    await expect(card(page, 'item-0003')).toHaveCount(0);
  });

  test('Copy link copies the deep link of the item', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await c.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('item=item-0002');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`/runs/${classic}`);
    // opening the copied link lands on the same item
    const url = new URL(link);
    expect(url.searchParams.get('item')).toBe('item-0002');
    expect.soft(url.pathname, 'copied link is not a project run URL').toMatch(/^\/projects\//);
    await page.goto(`${url.pathname}${url.search}`);
    await expect(card(page, 'item-0002')).toBeVisible();
  });

  test('one item at a time: J and K step through the items, the pager shows the position, the scroll settles', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await showItems(page);
    await itemButton(page, 3).click();
    const pane = itemPane(page);
    await expect(pane).toHaveAttribute('data-item-id', 'item-0003');
    await expect(paneBlock(pane, 'output')).toBeVisible();
    const pager = pane.getByRole('navigation', { name: 'Previous and next item' });
    await expect(pager).toContainText('3 of 240');
    await page.keyboard.press('j');
    await expect(pane).toHaveCount(1);
    await expect(pane).toHaveAttribute('data-item-id', 'item-0004');
    await expect(tableRow(page, 'item-0004')).toHaveAttribute('aria-current', 'true');
    await expect(tableRow(page, 'item-0003')).not.toHaveAttribute('aria-current');
    await expect.poll(() => params(page).get('item')).toBe('item-0004');
    await page.keyboard.press('k');
    await expect(pane).toHaveAttribute('data-item-id', 'item-0003');
    // the pager buttons do the same as the keys
    await pager.getByRole('button', { name: 'Next item: #4', exact: true }).click();
    await expect(pane).toHaveAttribute('data-item-id', 'item-0004');
    await expect(pager).toContainText('4 of 240');
    // once the bodies are in, the scroll position settles and stays put
    await expect(paneBlock(pane, 'output')).toBeVisible();
    let last = -1;
    await expect
      .poll(
        async () => {
          const now = await scrollTop(page);
          const stable = now === last;
          last = now;
          return stable;
        },
        { intervals: [300] },
      )
      .toBe(true);
    const settled = await scrollTop(page);
    await page.waitForTimeout(800);
    expect(await scrollTop(page)).toBe(settled);
  });

  test('a click on a second row moves the pane to that item; a click on the open row closes the pane', async ({
    page,
  }) => {
    // Agent E, 2026-11-15, preview :5841 (Playwright library probe e1-probe3.mjs): with item A open and `?item=A` in
    // the URL, a click on the row of item B dropped `?item` from the URL, and one time in three the pane stayed on
    // item A. This test states the intended behaviour. Check the toggle in ItemsSection.tsx (stale `itemParam` when
    // the pane closes the other item) before you remove this fixme.
    test.fixme(
      true,
      'app defect seen in the preview: a click on a second row drops ?item and can keep the old item',
    );
    await openRun(page, s.slug, classic);
    await showItems(page);
    await itemButton(page, 3).click();
    const pane = itemPane(page);
    await expect(pane).toHaveAttribute('data-item-id', 'item-0003');
    // the pane lies over the table: click the start of the row
    await clickItemRow(page, 5);
    await expect(pane).toHaveCount(1);
    await expect(pane).toHaveAttribute('data-item-id', 'item-0005');
    await expect(tableRow(page, 'item-0005')).toHaveAttribute('aria-current', 'true');
    await expect(tableRow(page, 'item-0003')).not.toHaveAttribute('aria-current');
    await expect.poll(() => params(page).get('item')).toBe('item-0005');
    await clickItemRow(page, 5);
    await expect(pane).toHaveCount(0);
    await expect.poll(() => params(page).get('item')).toBeNull();
  });

  test('item bodies that fail to load show the error state with Retry in the pane', async ({ page }) => {
    let fail = true;
    await page.route(/\/items\/details/, (route) =>
      fail ? route.fulfill({ status: 500, json: { detail: 'nope' } }) : route.continue(),
    );
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    const c = card(page, 'item-0004');
    await expect(c.getByRole('alert')).toContainText('Couldn’t load this item');
    fail = false;
    await c.getByRole('button', { name: 'Retry' }).click();
    await expect(c.getByRole('alert')).toHaveCount(0);
    await expect(paneBlock(c, 'input')).toBeVisible();
  });
});

test.describe('score edits (scenario 7, J8)', () => {
  test('edit a score to 0.5: the row updates and the edited tag appears; reset restores', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 5).click();
    const c = card(page, 'item-0005');
    const row = metricRow(c, 'quality');
    await expect(row).toBeVisible();
    await expect(editedTag(row)).toHaveCount(0);
    await editTile(c, 'quality').click();
    await expect(row).toHaveAttribute('data-editing', '');
    const input = row.getByRole('textbox', { name: 'New quality score' });
    await input.fill('0.5');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('textbox')).toHaveCount(0);
    await expect(row).toContainText('50');
    await expect(editedTag(row)).toBeVisible();
    // persisted: survives a reload (?item= opens the pane again)
    await page.reload();
    const again = card(page, 'item-0005');
    const row2 = metricRow(again, 'quality');
    await expect(editedTag(row2)).toBeVisible();
    // reset to the scorer value
    await editTile(again, 'quality').click();
    await row2.getByRole('button', { name: 'Reset to scorer value' }).click();
    await expect(row2.getByRole('textbox')).toHaveCount(0);
    await expect(editedTag(row2)).toHaveCount(0);
  });

  test('an invalid score keeps the editor open with a message; Escape cancels and the pane stays', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 6).click();
    const c = card(page, 'item-0006');
    const row = metricRow(c, 'quality');
    await editTile(c, 'quality').click();
    await row.getByRole('textbox', { name: 'New quality score' }).fill('banana');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('alert')).toBeVisible();
    await expect(row.getByRole('textbox')).toBeVisible();
    await row.getByRole('textbox').press('Escape');
    await expect(row.getByRole('textbox')).toHaveCount(0);
    // Escape in the editor belongs to the editor: the pane does not close
    await expect(c).toBeVisible();
  });

  test('a 409 keeps the editor open and shows the message', async ({ page }) => {
    await page.route(/\/api\/runs\/update_metric/, (route) =>
      route.fulfill({ status: 409, json: { detail: 'The scores changed elsewhere. Reload and retry.' } }),
    );
    await openRun(page, s.slug, classic);
    await itemButton(page, 7).click();
    const c = card(page, 'item-0007');
    const row = metricRow(c, 'quality');
    await editTile(c, 'quality').click();
    await row.getByRole('textbox', { name: 'New quality score' }).fill('0.5');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('alert')).toContainText('changed elsewhere');
    await expect(row.getByRole('textbox')).toBeVisible();
    await expect(editedTag(row)).toHaveCount(0);
  });

  test('a submitted run locks scores: no pencil, lock notice, review history', async ({ page }) => {
    await openRun(page, s.slug, locked);
    await expect(page.getByTestId('scores-locked-notice')).toBeVisible();
    await expect(page.getByTestId('scores-locked-notice')).toContainText(/locked/i);
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await expect(c).toBeVisible();
    await expect(metricRow(c, 'quality')).toBeVisible();
    await expect(c.getByRole('button', { name: /^Edit the .+ score/ })).toHaveCount(0);
    // the pane has no Escape owner here; close it so that it does not lie over the hero buttons
    await c.getByRole('button', { name: 'Close item', exact: true }).click();
    // C027: the submit event shows in the review log behind the hero's History button; the nav has no Reviews link
    await page.getByTestId('review-history-button').click();
    await expect(page.getByTestId('review-history')).toContainText(/Submitted/i);
    await expect(
      page.getByRole('navigation', { name: 'Run sections' }).getByRole('link', { name: /Reviews/ }),
    ).toHaveCount(0);
  });

  test('an unsubmitted run shows no lock notice', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(page.getByTestId('scores-locked-notice')).toHaveCount(0);
    await expect(page.getByTestId('read-only-notice')).toHaveCount(0);
    await expect(page.getByTestId('review-history-button')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Run sections' }).getByRole('link', { name: /Reviews/ }),
    ).toHaveCount(0);
  });
});

test.describe('read-only (archived) project', () => {
  test('hides editors and shows the read-only notice', async ({ page, request }) => {
    const p = await seedProject('rd-archived');
    const id = await seedClassic(p, {
      items: 12,
      taskErrors: 1,
      scorerErrors: 1,
      retries: 0,
      notReceived: 0,
      traced: 1,
    });
    const res = await request.post(`/v1/admin/projects/${p.projectId}/archive`);
    expect(res.ok(), await res.text()).toBeTruthy();
    await openRun(page, p.slug, id);
    await expect(page.getByTestId('read-only-notice')).toBeVisible();
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await expect(c).toBeVisible();
    await expect(metricRow(c, 'quality')).toBeVisible();
    await expect(c.getByRole('button', { name: /^Edit the .+ score/ })).toHaveCount(0);
    await expect(c.getByRole('button', { name: 'Add issue' })).toHaveCount(0);
  });
});

test.describe('root-cause issues (scenario 9)', () => {
  test('add an issue in the inline form: "pending"; Approve: "Approved"', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 3).click(); // item-0003: quality 60.5% < 70% => failing
    const c = card(page, 'item-0003');
    await openRootCause(c);
    const rc = c.locator('[data-testid=metric-analysis-card][data-metric=quality]');
    await expect(rc).toBeVisible();
    await expect(rc).toContainText('No issues recorded');
    await rc.getByRole('button', { name: 'Add issue' }).click();
    const dlg = page.getByTestId('issue-form');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /Category/ }).click();
    await page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: 'Hallucination' })
      .click();
    await expect(dlg.getByRole('button', { name: /Hallucination/ })).toBeVisible();
    await dlg.getByRole('textbox', { name: 'Subcategory' }).fill('wrong clause');
    await dlg.getByRole('textbox', { name: 'Finding' }).fill('The answer cites the wrong clause.');
    await dlg.getByRole('textbox', { name: 'Solution', exact: true }).fill('Improve retrieval ranking');
    await dlg.getByTestId('issue-save').click();
    await expect(dlg).toHaveCount(0);
    const issue = rc.getByTestId('issue');
    await expect(issue).toHaveCount(1);
    await expect(issue).toContainText('pending');
    await expect(issue).toContainText('The answer cites the wrong clause.');
    await expect(issue).toContainText('Improve retrieval ranking');
    await issue.getByRole('button', { name: /Approve issue/ }).click();
    await expect(issue).toContainText('Approved');
    await expect(issue.getByRole('button', { name: /Approve issue/ })).toHaveCount(0);
    // persisted
    await page.reload();
    await openRootCause(card(page, 'item-0003'));
    await expect(card(page, 'item-0003').locator('[data-testid=issue]')).toContainText('Approved');
    // the Root cause section now appears with a category card (close the pane: it lies over the page)
    await card(page, 'item-0003').getByRole('button', { name: 'Close item', exact: true }).click();
    await goToSection(page, 'Root cause');
    await expect(page.getByTestId('root-cause-card').first()).toBeVisible();
  });

  test('an issue can be edited and deleted', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    await openRootCause(card(page, 'item-0004'));
    const rc = card(page, 'item-0004').locator('[data-testid=metric-analysis-card][data-metric=exact_match]');
    await rc.getByRole('button', { name: 'Add issue' }).click();
    const dlg = page.getByTestId('issue-form');
    await dlg.getByRole('button', { name: /Category/ }).click();
    await page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: 'New category' })
      .click();
    await dlg.getByRole('textbox', { name: 'New category' }).fill('Scoring quirk');
    await dlg.getByRole('textbox', { name: 'Finding' }).fill('Verbatim match too strict.');
    await dlg.getByTestId('issue-save').click();
    const issue = rc.getByTestId('issue');
    await expect(issue).toHaveCount(1);
    await issue.getByRole('button', { name: 'Edit' }).click();
    await expect(dlg).toBeVisible();
    await dlg.getByRole('textbox', { name: 'Finding' }).fill('Verbatim match is far too strict.');
    await dlg.getByTestId('issue-save').click();
    await expect(issue).toContainText('far too strict');
    await issue.getByRole('button', { name: 'Edit' }).click();
    await dlg.getByRole('button', { name: 'Delete issue' }).click();
    // C125: Delete asks first
    await page
      .getByRole('alertdialog', { name: 'Delete this issue?' })
      .getByRole('button', { name: 'Delete issue' })
      .click();
    await expect(rc.getByTestId('issue')).toHaveCount(0);
  });

  test('saving without a category shows a validation message', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 9).click();
    await openRootCause(card(page, 'item-0009'));
    const rc = card(page, 'item-0009').locator('[data-testid=metric-analysis-card][data-metric=quality]');
    await rc.getByRole('button', { name: 'Add issue' }).click();
    const dlg = page.getByTestId('issue-form');
    await dlg.getByTestId('issue-save').click();
    await expect(dlg).toContainText('Choose or type a category.');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('repeat run: a Pass N link keeps the filters, keeps the item open and its row in view (C127)', async ({
    page,
  }) => {
    await openRun(page, s.slug, repeat, 'q=sql-001');
    await itemButton(page, 1).click(); // sql-001
    await card(page, 'sql-001').getByRole('link', { name: 'Pass 2' }).click();
    await expect.poll(() => params(page).get('pass')).toBe('2');
    expect(params(page).get('q')).toBe('sql-001');
    expect(params(page).get('item')).toBe('sql-001');
    await expect(card(page, 'sql-001')).toBeVisible();
    await expect(tableRow(page, 'sql-001')).toBeInViewport();
  });

  test('repeat run: all-passes view links to ?pass=N, issues are added per pass', async ({ page }) => {
    await openRun(page, s.slug, repeat);
    await itemButton(page, 1).click(); // sql-001
    const c = card(page, 'sql-001');
    await expect(c.getByTestId('root-cause-pass-hint')).toBeVisible();
    await c.getByRole('link', { name: 'Pass 2' }).click();
    await expect.poll(() => params(page).get('pass')).toBe('2');
    expect(params(page).get('item')).toBe('sql-001');
    const c2 = card(page, 'sql-001');
    await expect(c2).toBeVisible();
    // sql-001 failed in pass 2 with a task error: the judges said nothing, so no root-cause cards
    await expect(c2.getByTestId('metric-analysis-card')).toHaveCount(0);
    // sql-005 fails every pass on its score: its failing metric card offers an issue
    await openRun(page, s.slug, repeat, 'pass=2&item=sql-005');
    const c3 = card(page, 'sql-005');
    await openRootCause(c3);
    const rc = c3.locator('[data-testid=metric-analysis-card]').first();
    await expect(rc).toBeVisible();
    await rc.getByRole('button', { name: 'Add issue' }).click();
    const dlg = page.getByTestId('issue-form');
    await dlg.getByRole('button', { name: /Category/ }).click();
    await page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: 'New category' })
      .click();
    await dlg.getByRole('textbox', { name: 'New category' }).fill('SQL schema');
    await dlg.getByRole('textbox', { name: 'Finding' }).fill('Relation does not exist.');
    await dlg.getByTestId('issue-save').click();
    await expect(rc.getByTestId('issue')).toContainText('pending');
    await rc
      .getByTestId('issue')
      .getByRole('button', { name: /Approve issue/ })
      .click();
    await expect(rc.getByTestId('issue')).toContainText('Approved');
  });
});
