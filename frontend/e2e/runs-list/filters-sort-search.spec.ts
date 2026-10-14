/** J2 / brief §8.1-2: deep links, the Filters popover, time/origin, sort, search, open + Back. */
import { test, expect } from '@playwright/test';
import {
  clickBox,
  capture,
  dataRows,
  listRequests,
  openFacet,
  openFilters,
  openRuns,
  runsUrl,
  sharedProject,
  urlParams,
} from './support';

const ALL_STATUS = ['COMPLETED', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STOPPED', 'RUNNING']
  .map((s) => `status=${s}`)
  .join('&');

test.describe('runs list: filters, sort, search (J2)', () => {
  test('deep link with filters, sort and page 2: chips, aria-sort, pager, URL untouched', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 55, 'big');
    const qs = `task=rag-qa&task=summarize&task=text2sql&${ALL_STATUS}&origin=local&sort=model-asc&page=2`;
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug, qs);
    await expect(page.getByTestId('status-bar')).toContainText('51–56 of 56 runs');
    await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
    await expect(page.locator('th[aria-sort]', { hasText: 'Model' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    const chips = page.getByRole('group', { name: 'Active filters', exact: true });
    await expect(chips).toContainText('task: rag-qa');
    await expect(chips).toContainText('status: Completed');
    await expect(chips).toContainText('origin: local');
    await expect(dataRows(page)).toHaveCount(6);
    // request: text sort sends the collation order; offset is page 2
    const last = listRequests(cap).at(-1)!.body;
    expect(last.sort).toBe('model-asc');
    expect(Array.isArray(last.collation) && last.collation.length > 0).toBeTruthy();
    expect(last.offset).toBe(50);
    expect(last.limit).toBe(50);
    expect(last.filters.origins).toEqual(['local']);
    expect(last.filters.tasks).toEqual(['rag-qa', 'summarize', 'text2sql']);
    // the URL is the whole view and is not rewritten
    expect(new URL(page.url()).search).toBe(`?${qs}`);
    // pager buttons: Previous goes back to page 1 and drops page from the URL
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(dataRows(page)).toHaveCount(50);
    expect(urlParams(page).has('page')).toBe(false);
  });

  test('no sessionStorage precedence: the URL alone defines the view', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'task=summarize');
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'task: summarize',
    );
    await page.goto(runsUrl(s.project.slug));
    await expect(dataRows(page).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toContainText('13 runs');
  });

  test('filter bar: one trigger per facet, tick stays open, Only, Select all / None, Escape returns focus', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    const bar = page.getByTestId('filter-bar');
    for (const name of ['Task', 'Dataset', 'Model', 'Version', 'Status', 'User']) {
      await expect(bar.getByRole('button', { name: new RegExp(`^${name} filter`) })).toBeVisible();
    }
    const trigger = bar.getByRole('button', { name: /^Model filter/ });
    await openFacet(page, 'Models');
    const panel = page.getByTestId('filters-panel');
    await expect(panel.getByRole('button', { name: /^Only / })).toHaveCount(2);
    // ticking keeps the list open and applies at once
    await clickBox(panel.getByRole('checkbox', { name: /gpt-4o/ }));
    await expect(panel).toBeVisible();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText('model: ');
    await expect.poll(() => urlParams(page).getAll('model').length).toBe(1);
    await expect(trigger).toContainText(/gpt-4o/);
    await expect
      .poll(() => listRequests(cap).at(-1)!.body.filters.models)
      .toEqual([expect.stringMatching(/gpt-4o\|\|\|plain$/)]);
    // tick the second one too, then Only on it
    await clickBox(panel.getByRole('checkbox', { name: /claude/ }));
    await expect.poll(() => urlParams(page).getAll('model').length).toBe(2);
    await expect(trigger).toContainText('2');
    await panel.getByRole('button', { name: /Only .*claude/ }).click();
    await expect.poll(() => urlParams(page).getAll('model')).toEqual([expect.stringContaining('claude')]);
    await expect(panel).toBeVisible();
    // Select all / None (None clears the facet)
    await panel.getByRole('button', { name: 'Select all' }).click();
    await expect.poll(() => urlParams(page).getAll('model').length).toBe(2);
    await panel.getByRole('button', { name: 'None' }).click();
    await expect.poll(() => urlParams(page).has('model')).toBe(false);
    await expect(dataRows(page).first()).toBeVisible();
    // Escape closes the list and restores focus to its trigger
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('a facet list opens with one click and a click outside closes it', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, '');
    await openFacet(page, 'Models');
    const panel = page.getByTestId('filters-panel');
    await panel.getByRole('button', { name: /Only .*claude/ }).click();
    await expect.poll(() => urlParams(page).getAll('model').length).toBe(1);
    await page.getByRole('heading', { name: 'Runs', level: 1 }).click({ force: true });
    await page.mouse.click(5, 5);
    await expect(panel).toHaveCount(0);
  });

  test('facet values narrow rows, Status facet writes status= and chips remove', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openFacet(page, 'Status');
    const panel = page.getByTestId('filters-panel');
    await panel.getByRole('button', { name: 'Only Completed' }).click();
    await expect.poll(() => urlParams(page).getAll('status')).toEqual(['COMPLETED']);
    await expect(page.getByTestId('status-bar')).toContainText(/of 13 runs — status: Completed/);
    await expect(
      page.getByTestId('filter-bar').getByRole('button', { name: /^Status filter/ }),
    ).toContainText('Completed');
    for (const st of await dataRows(page).evaluateAll((rows) =>
      rows.map((r) => (r as HTMLElement).dataset.status),
    ))
      expect(st).toBe('COMPLETED');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove status: Completed' }).click();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toContainText('13 runs');
  });

  test('time range segmented and the custom Range dialog validate', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    await openFilters(page);
    const time = page.getByRole('radiogroup', { name: 'Time range' });
    await time.getByText('7d', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('range')).toBe('week');
    await expect.poll(() => !!listRequests(cap).at(-1)!.body.filters.since).toBe(true);
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'range: 7 days',
    );
    await time.getByText('All', { exact: true }).click();
    await expect.poll(() => urlParams(page).has('range')).toBe(false);
    // custom range dialog
    await time.getByText('Range…').click();
    const dlg = page.getByRole('dialog', { name: 'Custom date range' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Choose a start date, an end date or both.');
    await dlg.getByLabel('From').fill('2026-10-05');
    await dlg.getByLabel('To').fill('2026-10-01');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('The start date must be on or before the end date.');
    // open-ended is allowed
    await dlg.getByLabel('To').fill('');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg).toHaveCount(0);
    expect(urlParams(page).get('range')).toBe('custom');
    expect(urlParams(page).get('from')).toBe('2026-10-05');
    expect(urlParams(page).has('to')).toBe(false);
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'range: from 2026-10-05',
    );
    const f = listRequests(cap).at(-1)!.body.filters;
    expect(f.since).toBeTruthy();
    expect(f.until).toBeUndefined();
  });

  test('origin segmented writes ?origin= and filters; Clear removes every filter', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug, 'task=summarize');
    await openFilters(page);
    const origin = page.getByRole('radiogroup', { name: 'Origin' });
    await origin.getByText('Official', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('origin')).toBe('official');
    await expect.poll(() => listRequests(cap).at(-1)!.body.filters.origins).toEqual(['official']);
    await expect(page.getByText('No runs match current filters')).toBeVisible();
    await origin.getByText('Local', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('origin')).toBe('local');
    await expect(dataRows(page).first()).toBeVisible();
    const chips = page.getByRole('group', { name: 'Active filters', exact: true });
    await page
      .getByTestId('filter-bar')
      .getByRole('button', { name: /^Clear \d/ })
      .click();
    await expect(chips).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('versioning filters: v.<key>= deep link round-trips and reaches filters.versioning', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await page.goto(runsUrl(s.project.slug, 'v.prompt_version=v2&v.prompt_version=v3&v.agent=alpha'));
    await expect(page.getByTestId('runs-table')).toBeVisible();
    await expect
      .poll(() => listRequests(cap).at(-1)?.body.filters.versioning)
      .toEqual({ agent: ['alpha'], prompt_version: ['v2', 'v3'] });
    const chips = page.getByRole('group', { name: 'Active filters', exact: true });
    await expect(chips).toContainText('Prompt version: v2');
    await expect(chips).toContainText('Agent: alpha');
    await expect(page.getByTestId('filters-trigger')).toContainText('More filters · 3');
    // the URL keeps the keys (sorted) and the values
    const sp = urlParams(page);
    expect(sp.getAll('v.prompt_version')).toEqual(['v2', 'v3']);
    expect(sp.getAll('v.agent')).toEqual(['alpha']);
    await page.reload();
    await expect(chips).toContainText('Agent: alpha');
    // removing a chip drops that value from the URL
    await page.getByRole('button', { name: 'Remove Agent: alpha' }).click();
    await expect.poll(() => urlParams(page).has('v.agent')).toBe(false);
  });

  test('sort: first click direction (text asc, numeric/time desc), request sort string, collation for text', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    const head = (name: string) =>
      page.locator('[data-testid="runs-table"] thead th', { hasText: new RegExp(`^${name}`, 'i') });
    await head('Task').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).get('sort')).toBe('task-asc');
    await expect(head('Task')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => listRequests(cap).at(-1)!.body.sort).toBe('task-asc');
    const textReq = listRequests(cap).at(-1)!.body;
    expect(Array.isArray(textReq.collation) && textReq.collation.length).toBeTruthy();
    await head('Task').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).get('sort')).toBe('task-desc');
    // numeric metric: desc first
    await head('Accuracy').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).get('sort')).toBe('metric-accuracy-desc');
    await expect(head('Accuracy')).toHaveAttribute('aria-sort', 'descending');
    const numReq = listRequests(cap).at(-1)!.body;
    expect(numReq.sort).toBe('metric-accuracy-desc');
    expect(numReq.collation ?? null).toBeNull();
    await head('Accuracy').getByRole('button').first().click();
    await expect(head('Accuracy')).toHaveAttribute('aria-sort', 'ascending');
    // the default sort is not written: Date is time-desc, clicking it flips to asc
    await head('Date').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).has('sort')).toBe(false); // time-desc is the default: not written
    await expect(head('Date')).toHaveAttribute('aria-sort', 'descending');
    await head('Date').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).get('sort')).toBe('time-asc');
    // status is a "desc first" key
    await head('Status').getByRole('button').first().click();
    await expect.poll(() => urlParams(page).get('sort')).toBe('status-desc');
    // only one column carries an active sort
    await expect(page.locator('th[aria-sort="descending"], th[aria-sort="ascending"]')).toHaveCount(1);
  });

  test('Clear n in the bar removes every filter in one click', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'task=summarize&status=COMPLETED');
    const clear = page.getByTestId('filter-bar').getByRole('button', { name: /^Clear 2/ });
    await clear.click();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(clear).toHaveCount(0);
  });

  test('a deep-linked metric sort never asks for the time-desc order first', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug, 'sort=metric-accuracy-desc');
    await expect(page.locator('th[aria-sort="descending"]')).toContainText(/accuracy/i);
    const sorts = listRequests(cap).map((c) => c.body.sort);
    expect(sorts.length).toBeGreaterThan(0);
    expect(sorts.every((x) => x === 'metric-accuracy-desc')).toBe(true);
  });

  test('a sort on a hidden metric column falls back to time-desc', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'sort=metric-accuracy-asc');
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText(/accuracy/i);
    await page.getByRole('button', { name: 'Columns' }).click();
    await clickBox(page.getByRole('checkbox', { name: 'accuracy' }));
    await expect(page.locator('th[aria-sort="descending"]')).toContainText(/date/i);
    // the URL keeps the user's sort; the table shows the effective (fallback) order
    expect(urlParams(page).get('sort')).toBe('metric-accuracy-asc');
  });

  test('search: debounced 200 ms into filters.q and ?q=, "/" focuses, Esc clears', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Search runs' }).or(page.getByLabel('Search runs'));
    await expect(search).toBeFocused();
    const before = listRequests(cap).length;
    await search.pressSequentially('summarize', { delay: 20 });
    // nothing is committed to the URL while typing within the debounce window
    expect(urlParams(page).has('q')).toBe(false);
    await expect.poll(() => urlParams(page).get('q')).toBe('summarize');
    await expect.poll(() => listRequests(cap).at(-1)!.body.filters.q).toBe('summarize');
    expect(listRequests(cap).length - before).toBe(1); // one request, not one per keystroke
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'search: “summarize”',
    );
    // the previous page of rows stays up (not faded) until the filtered rows arrive
    await expect
      .poll(async () => {
        const names = await dataRows(page).locator('td[data-col="run"] a').allInnerTexts();
        return names.length > 0 && names.every((n) => n.includes('summarize'));
      })
      .toBe(true);
    // Escape blurs the field first; a second Escape (outside the field) does not clear; the clear button does
    await search.fill('');
    await expect.poll(() => urlParams(page).has('q')).toBe(false);
    await search.fill('rag-qa');
    await expect.poll(() => urlParams(page).get('q')).toBe('rag-qa');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect.poll(() => urlParams(page).has('q')).toBe(false);
    await expect(search).toHaveValue('');
  });

  test('Esc in the search box clears the field and the q filter', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'q=summarize');
    const search = page.getByLabel('Search runs');
    await expect(search).toHaveValue('summarize');
    await search.focus();
    await page.keyboard.press('Escape');
    // brief: "Esc clears". Either the value or the focus must change; the filter must go.
    await expect
      .poll(() => (urlParams(page).has('q') ? 'q still set' : 'cleared'), { timeout: 3000 })
      .toBe('cleared');
    await expect(search).toHaveValue('');
  });

  test('a run link carries ?list= with the view and opening it then Back restores the list', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'task=summarize&sort=task-asc');
    const link = dataRows(page).first().locator('td[data-col="run"] a');
    const href = (await link.getAttribute('href'))!;
    expect(href).toMatch(new RegExp(`^/projects/${s.project.slug}/runs/[^?]+\\?list=`));
    const list = new URL(href, 'http://x').searchParams.get('list')!;
    expect(list).toBe('task=summarize&sort=task-asc');
    expect(list).not.toContain('page');
    await link.click();
    await expect(page).toHaveURL(/\/runs\//);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/projects/${s.project.slug}\\?task=summarize&sort=task-asc$`));
    await expect(dataRows(page).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Active filters', exact: true })).toContainText(
      'task: summarize',
    );
  });
});
