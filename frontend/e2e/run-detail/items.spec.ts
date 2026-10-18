/** J6, J8, scenarios 6, 7, 9: open an item, deep link, copy link, edit scores, locked/read-only runs, root-cause issues. */
import { test, expect, type Page } from '@playwright/test';
import {
  showItems,
  itemButton,
  openRootCause,
  openRun,
  params,
  scrollTop,
  seedClassic,
  seedLocked,
  seedProject,
  seedRepeat,
  type Seeded,
  metricRow,
  openMetric,
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

const card = (page: Page, id: string) => page.locator(`[data-testid=item-card][data-item-id="${id}"]`);

test.describe('open an item (scenario 6, J6)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('bodies load through ONE items/details POST, ?item= is set, the body shows input/expected/output/metrics', async ({
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
    await expect(
      c.getByText('Question 2: what does clause 1 of the finance policy require?').first(),
    ).toBeVisible();
    await expect(c.getByText('Clause 1 requires written approval.')).toBeVisible();
    await expect(c.locator('[data-kind=output]')).toContainText(
      'Clause 1 requires written approval from the finance lead',
    );
    for (const m of ['exact_match', 'quality', 'hallucination', 'tokens_used']) {
      await expect(metricRow(c, m)).toBeVisible();
    }
    await expect.poll(() => params(page).get('item')).toBe('item-0002');
    expect(details).toHaveLength(1);
    expect(details[0]).toContain('item-0002');
    // the row button reports expanded state and collapses again
    const close = page.getByRole('button', { name: 'Close item #2', exact: true });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    await close.click();
    await expect(c).toHaveCount(0);
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

  test('a dict input is shown as structured JSON', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 1).click();
    const c = card(page, 'item-0001');
    await expect(c).toBeVisible();
    await expect(c.locator('[data-kind=input]')).toContainText('prompt');
    await expect(c.locator('[data-kind=input]')).toContainText('context');
  });

  test('reload with ?item= reopens that item on its page and scrolls it into view', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0100');
    const c = card(page, 'item-0100');
    await expect(c).toBeVisible();
    await expect(page.getByText(/81–100 of 240 items/)).toBeVisible();
    await expect(c).toBeInViewport();
    // reload keeps it open and in view
    await page.reload();
    await expect(c).toBeVisible();
    await expect(c).toBeInViewport();
    expect(params(page).get('item')).toBe('item-0100');
  });

  test('the deep-link highlight clears even when the page changes under it, and a click does not highlight', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, 'item=item-0100');
    const row = page.locator('[data-item-id="item-0100"][data-open]');
    await expect(row).toHaveAttribute('data-highlight', 'true');
    await expect(row).not.toHaveAttribute('data-highlight', 'true', { timeout: 6000 });
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    await expect(card(page, 'item-0004')).toBeVisible();
    await expect(page.locator('[data-item-id="item-0004"][data-highlight]')).toHaveCount(0);
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

  test('Copy link copies the deep link of the item', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await c.getByRole('button', { name: 'Copy link' }).click();
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

  test('opening a second item keeps the first open and the scroll settles', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 3).click();
    await expect(card(page, 'item-0003')).toBeVisible();
    await itemButton(page, 5).click();
    await expect(card(page, 'item-0005')).toBeVisible();
    // both may stay open
    await expect(card(page, 'item-0003')).toBeVisible();
    // once the bodies are in, the scroll position settles and stays put
    await expect(card(page, 'item-0005').locator('[data-kind=output]')).toBeVisible();
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

  test('item bodies that fail to load show an inline Retry', async ({ page }) => {
    let fail = true;
    await page.route(/\/items\/details/, (route) =>
      fail ? route.fulfill({ status: 500, json: { detail: 'nope' } }) : route.continue(),
    );
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    await expect(page.getByText('Item details could not be loaded.')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(card(page, 'item-0004')).toBeVisible();
  });
});

test.describe('score edits (scenario 7, J8)', () => {
  test('edit a score to 0.5: chip updates and the edited tag appears; reset restores', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 5).click();
    const c = card(page, 'item-0005');
    const chip = metricRow(c, 'quality');
    await expect(chip).toBeVisible();
    const panel = await openMetric(c, 'quality');
    await expect(panel).not.toContainText('edited');
    await panel.getByRole('button', { name: 'Edit score', exact: true }).click();
    const input = panel.getByRole('textbox', { name: 'New quality score' });
    await input.fill('0.5');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(chip).toContainText('50');
    await expect(panel).toContainText('edited');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    // persisted: survives a reload
    await page.reload();
    const again = card(page, 'item-0005');
    await expect(again.getByRole('button', { name: /^quality, pass 1: .*\(edited\)$/ })).toBeVisible();
    // reset to the scorer value
    const panel2 = await openMetric(again, 'quality');
    await expect(panel2).toContainText('edited');
    await panel2.getByRole('button', { name: 'Edit score', exact: true }).click();
    await panel2.getByRole('button', { name: 'Reset to scorer value' }).click();
    await expect(again.getByRole('button', { name: /^quality, pass 1: .*\(edited\)$/ })).toHaveCount(0);
  });

  test('an invalid score keeps the editor open with a message; Escape cancels', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 6).click();
    const panel = await openMetric(card(page, 'item-0006'), 'quality');
    await panel.getByRole('button', { name: 'Edit score', exact: true }).click();
    await panel.getByRole('textbox', { name: 'New quality score' }).fill('banana');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('textbox')).toBeVisible();
    await panel.getByRole('textbox').press('Escape');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
  });

  test('a 409 keeps the editor open and shows the message', async ({ page }) => {
    await page.route(/\/api\/runs\/update_metric/, (route) =>
      route.fulfill({ status: 409, json: { detail: 'The scores changed elsewhere. Reload and retry.' } }),
    );
    await openRun(page, s.slug, classic);
    await itemButton(page, 7).click();
    const chip = metricRow(card(page, 'item-0007'), 'quality');
    const panel = await openMetric(card(page, 'item-0007'), 'quality');
    await panel.getByRole('button', { name: 'Edit score', exact: true }).click();
    await panel.getByRole('textbox', { name: 'New quality score' }).fill('0.5');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('alert')).toContainText('changed elsewhere');
    await expect(panel.getByRole('textbox')).toBeVisible();
    await expect(chip).not.toContainText('edited');
  });

  test('a submitted run locks scores: no pencil, lock notice, review history', async ({ page }) => {
    await openRun(page, s.slug, locked);
    await expect(page.getByTestId('scores-locked-notice')).toBeVisible();
    await expect(page.getByTestId('scores-locked-notice')).toContainText(/locked/i);
    await itemButton(page, 2).click();
    const c = card(page, 'item-0002');
    await expect(c).toBeVisible();
    const lockedPanel = await openMetric(c, 'quality');
    await expect(lockedPanel).toBeVisible();
    await expect(c.getByRole('button', { name: /^Edit score$/ })).toHaveCount(0);
    // the submit event shows in the review history under the hero, with a Reviews link in the nav
    await expect(page.getByTestId('review-history')).toContainText(/Submitted/i);
    await expect(
      page.getByRole('navigation', { name: 'Run sections' }).getByRole('link', { name: /Reviews/ }),
    ).toBeVisible();
  });

  test('an unsubmitted run shows no lock notice', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(page.getByTestId('scores-locked-notice')).toHaveCount(0);
    await expect(page.getByTestId('read-only-notice')).toHaveCount(0);
    await expect(page.getByTestId('review-history')).toHaveCount(0);
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
    await expect(card(page, 'item-0002')).toBeVisible();
    await expect(card(page, 'item-0002').getByRole('button', { name: /^Edit score$/ })).toHaveCount(0);
    await expect(card(page, 'item-0002').getByRole('button', { name: '+ Add issue' })).toHaveCount(0);
  });
});

test.describe('root-cause issues (scenario 9)', () => {
  test('add an issue through the dialog: "Pending review"; Approve: "Approved"', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 3).click(); // item-0003: quality 60.5% < 70% => failing
    const c = card(page, 'item-0003');
    await openRootCause(c);
    const rc = c.locator('[data-testid=metric-analysis-card][data-metric=quality]');
    await expect(rc).toBeVisible();
    await expect(rc).toContainText('No issues recorded');
    await rc.getByRole('button', { name: '+ Add issue' }).click();
    const dlg = page.getByTestId('issue-dialog');
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
    await expect(issue).toContainText('Pending review');
    await expect(issue).toContainText('The answer cites the wrong clause.');
    await expect(issue).toContainText('Improve retrieval ranking');
    await issue.getByRole('button', { name: /Approve issue/ }).click();
    await expect(issue).toContainText('Approved');
    await expect(issue.getByRole('button', { name: /Approve issue/ })).toHaveCount(0);
    // persisted
    await page.reload();
    await expect(card(page, 'item-0003').locator('[data-testid=issue]')).toContainText('Approved');
    // the Root cause section now appears with a category card
    await page
      .getByRole('navigation', { name: 'Run sections' })
      .getByRole('link', { name: 'Root cause' })
      .click();
    await expect(page.getByTestId('root-cause-card').first()).toBeVisible();
  });

  test('an issue can be edited and deleted', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 4).click();
    await openRootCause(card(page, 'item-0004'));
    const rc = card(page, 'item-0004').locator('[data-testid=metric-analysis-card][data-metric=exact_match]');
    await rc.getByRole('button', { name: '+ Add issue' }).click();
    const dlg = page.getByTestId('issue-dialog');
    await dlg.getByRole('button', { name: /Category/ }).click();
    await page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: 'New category…' })
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
    await dlg.getByRole('button', { name: /Delete issue|Delete/ }).click();
    await expect(rc.getByTestId('issue')).toHaveCount(0);
  });

  test('saving without a category shows a validation message', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await itemButton(page, 9).click();
    await openRootCause(card(page, 'item-0009'));
    const rc = card(page, 'item-0009').locator('[data-testid=metric-analysis-card][data-metric=quality]');
    await rc.getByRole('button', { name: '+ Add issue' }).click();
    const dlg = page.getByTestId('issue-dialog');
    await dlg.getByTestId('issue-save').click();
    await expect(dlg).toContainText('Choose or type a category.');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
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
    await expect(c2.locator('[role=listitem][data-metric]')).toHaveCount(0);
    await expect(c2.getByTestId('metric-analysis-card')).toHaveCount(0);
    // sql-005 fails every pass on its score: its failing metric card offers an issue
    await openRun(page, s.slug, repeat, 'pass=2&item=sql-005');
    const c3 = card(page, 'sql-005');
    await openRootCause(c3);
    const rc = c3.locator('[data-testid=metric-analysis-card]').first();
    await expect(rc).toBeVisible();
    await rc.getByRole('button', { name: '+ Add issue' }).click();
    const dlg = page.getByTestId('issue-dialog');
    await dlg.getByRole('button', { name: /Category/ }).click();
    await page
      .getByRole('listbox', { name: /Category/ })
      .getByRole('option', { name: 'New category…' })
      .click();
    await dlg.getByRole('textbox', { name: 'New category' }).fill('SQL schema');
    await dlg.getByRole('textbox', { name: 'Finding' }).fill('Relation does not exist.');
    await dlg.getByTestId('issue-save').click();
    await expect(rc.getByTestId('issue')).toContainText('Pending review');
    await rc
      .getByTestId('issue')
      .getByRole('button', { name: /Approve issue/ })
      .click();
    await expect(rc.getByTestId('issue')).toContainText('Approved');
  });
});
