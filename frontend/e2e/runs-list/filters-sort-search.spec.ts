/** J2 / brief §8.1-2: deep links, the Filters popover, time/origin, sort, search, open + Back. */
import { test, expect } from '@playwright/test';
import {
  clickBox,
  capture,
  clearButton,
  dataRows,
  filterSummary,
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
  test('deep link with filters, sort and page 2: summary, aria-sort, pager, URL untouched', async ({
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
    const summary = filterSummary(page);
    await expect(summary).toContainText('task: rag-qa');
    await expect(summary).toContainText('status: Completed');
    await expect(summary).toContainText('local runs');
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
    await expect(filterSummary(page)).toContainText('task: summarize');
    await page.goto(runsUrl(s.project.slug));
    await expect(dataRows(page).first()).toBeVisible();
    await expect(clearButton(page)).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toContainText('13 runs');
  });

  test('filter bar: one trigger per facet, every value ticked by default, untick, Only, Select all / None, Escape returns focus', async ({
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
    // searchable even with two values, and no filter = every box ticked
    await expect(panel.getByRole('textbox', { name: 'Search Model' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Only / })).toHaveCount(2);
    await expect(panel.getByRole('checkbox', { name: /gpt-4o/ })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: /claude/ })).toBeChecked();
    await expect(panel).not.toContainText('Nothing ticked');
    // unticking one keeps the list open and applies at once: the other value is the filter
    await clickBox(panel.getByRole('checkbox', { name: /gpt-4o/ }));
    await expect(panel).toBeVisible();
    await expect(filterSummary(page)).toContainText('model: ');
    await expect.poll(() => urlParams(page).getAll('model')).toEqual([expect.stringContaining('claude')]);
    await expect(trigger).toContainText(/claude/);
    await expect
      .poll(() => listRequests(cap).at(-1)!.body.filters.models)
      .toEqual([expect.stringMatching(/claude.*\|\|\|plain$/)]);
    // ticking it again ticks every value: no filter
    await clickBox(panel.getByRole('checkbox', { name: /gpt-4o/ }));
    await expect.poll(() => urlParams(page).has('model')).toBe(false);
    await panel.getByRole('button', { name: /Only .*claude/ }).click();
    await expect.poll(() => urlParams(page).getAll('model')).toEqual([expect.stringContaining('claude')]);
    await expect(panel).toBeVisible();
    // Select all = no filter; None = no value ticked, which matches no run
    await panel.getByRole('button', { name: 'Select all' }).click();
    await expect.poll(() => urlParams(page).has('model')).toBe(false);
    await panel.getByRole('button', { name: 'None' }).click();
    await expect.poll(() => urlParams(page).getAll('model')).toEqual(['__none__']);
    await expect(trigger).toContainText('None');
    await expect(panel.getByRole('checkbox', { name: /claude/ })).not.toBeChecked();
    await panel.getByRole('button', { name: 'Select all' }).click();
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

  test('facet values narrow rows, Status facet writes status= and Clear removes it', async ({
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
    await clearButton(page).click();
    await expect(clearButton(page)).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toContainText('13 runs');
  });

  test('time range segmented and the custom Range fields open in place and validate', async ({
    page,
    request,
  }) => {
    // round 10: the date and time segments are typed key by key, which takes longer than a native date fill
    test.setTimeout(60_000);
    const s = await sharedProject(request, 12);
    const cap = capture(page, 'runs');
    await openRuns(page, s.project.slug);
    await openFilters(page);
    const time = page.getByRole('radiogroup', { name: 'Time range' });
    await time.getByText('7d', { exact: true }).click();
    await expect.poll(() => urlParams(page).get('range')).toBe('week');
    await expect.poll(() => !!listRequests(cap).at(-1)!.body.filters.since).toBe(true);
    await expect(filterSummary(page)).toContainText('last 7d');
    await time.getByText('All', { exact: true }).click();
    await expect.poll(() => urlParams(page).has('range')).toBe(false);
    // custom range: the date fields expand next to the control, no dialog
    await expect(time.getByText('Range', { exact: true })).toBeVisible();
    await time.getByText('Range', { exact: true }).click();
    const range = page.getByTestId('custom-range');
    await expect(range).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // round 10: a qym date and time field per side (typed segments: month, day, year, hour, minute)
    const from = range.getByRole('group', { name: 'From', exact: true });
    const to = range.getByRole('group', { name: 'To', exact: true });
    await expect(from.getByRole('spinbutton').first()).toBeFocused();
    await range.getByRole('button', { name: 'Apply' }).click();
    await expect(range.getByRole('alert')).toHaveText('Choose a start, an end or both.');
    await from.getByRole('spinbutton').first().click();
    await page.keyboard.type('100520260930');
    await to.getByRole('spinbutton').first().click();
    await page.keyboard.type('100120262359');
    await range.getByRole('button', { name: 'Apply' }).click();
    await expect(range.getByRole('alert')).toHaveText('The start must be on or before the end.');
    // open-ended is allowed; the applied range keeps its fields open so the dates can be changed
    await to.getByRole('spinbutton').last().click();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
    await range.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => urlParams(page).get('range')).toBe('custom');
    expect(urlParams(page).get('from')).toBe('2026-10-05T09:30');
    expect(urlParams(page).has('to')).toBe(false);
    await expect(range).toBeVisible();
    await expect(from.getByRole('spinbutton', { name: /hour/i })).toHaveText('09');
    await expect(filterSummary(page)).toContainText('from 2026-10-05 09:30');
    const f = listRequests(cap).at(-1)!.body.filters;
    expect(f.since).toBeTruthy();
    expect(f.until).toBeUndefined();
    // another range folds the fields
    await time.getByText('All', { exact: true }).click();
    await expect(range).toHaveCount(0);
    // Cancel folds an unapplied range
    await time.getByText('Range', { exact: true }).click();
    await page.getByRole('button', { name: 'Cancel custom range' }).click();
    await expect(page.getByTestId('custom-range')).toHaveCount(0);
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
    await page
      .getByTestId('filter-bar')
      .getByRole('button', { name: /^Clear \d/ })
      .click();
    await expect(clearButton(page)).toHaveCount(0);
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
    const summary = filterSummary(page);
    await expect(summary).toContainText('Prompt version: v2, v3');
    await expect(summary).toContainText('Agent: alpha');
    await expect(page.getByTestId('filters-trigger')).toContainText('More filters · 3');
    // the URL keeps the keys (sorted) and the values
    const sp = urlParams(page);
    expect(sp.getAll('v.prompt_version')).toEqual(['v2', 'v3']);
    expect(sp.getAll('v.agent')).toEqual(['alpha']);
    await page.reload();
    await expect(summary).toContainText('Agent: alpha');
    // Select all in the Agent list (More filters) drops that key from the URL
    await page.getByTestId('filters-trigger').click();
    const more = page.getByTestId('filters-panel');
    await more.getByRole('button', { name: /^Agent/ }).click();
    await more
      .getByRole('group', { name: 'Agent options' })
      .getByRole('button', { name: 'Select all' })
      .click();
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
    await expect(clearButton(page)).toHaveCount(0);
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
    await expect(filterSummary(page)).toContainText('search: "summarize"');
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
    await expect(filterSummary(page)).toContainText('task: summarize');
  });
});
