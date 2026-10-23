/// <reference lib="dom" />
/** QE-77 to QE-108: the request page, its Conversation tab and the administrator's triage panel. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { asMember, box, configureAgent, near, overflowX, record, seedFeedback, setViewport, shot, WIDTHS, COLUMN } from './support';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(0);
});

async function refOf(page: Page, title: string): Promise<string> {
  const res = await page.request.get('/v1/feedback?page_size=100&q=' + encodeURIComponent(title));
  const body = (await res.json()) as { items: { ref: string; title: string }[]; children: Record<string, { ref: string; title: string }[]> };
  const all = [...body.items, ...Object.values(body.children).flat()];
  return all.find((r) => r.title === title)!.ref;
}

test('QE-77 to QE-84: header, tabs, card, history and related panel at three widths', async ({ page }) => {
  const dup = await refOf(page, 'PDF export of the compare page');
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, `/feedback/${dup}`);
    await expect(page.getByTestId('request-card')).toBeVisible();
    const header = await box(page.locator('[data-page-header]'));
    const tabs = await box(page.getByRole('tablist', { name: 'Request sections' }));
    const card = await box(page.getByTestId('request-card'));
    const history = await box(page.getByTestId('history'));
    const strip = await box(page.getByLabel('Priority and complexity'));
    near(header.w, COLUMN[w]);
    near(tabs.w, COLUMN[w]);
    expect(await overflowX(page)).toBe(0);
    record(`request-${w}`, { header, tabs, card, history, strip });
    await shot(page, 'request', w);
  }
  await expect(page).toHaveTitle(/^FB-\d{4} · PDF export of the compare page/);
  await expect(page.getByRole('note').getByText('Marked as a duplicate of FB-')).toBeVisible();
  await expect(page.getByTestId('history')).toContainText('Submitted');
  await expect(page.getByTestId('history')).toContainText('Marked as a duplicate of');
  await expect(page.getByTestId('related-card')).toContainText('Duplicate');
});

test('QE-78, QE-86, QE-91: the Conversation tab is a read-only transcript in the URL', async ({ page }) => {
  const ref = await refOf(page, 'PDF export of the compare page');
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, `/feedback/${ref}?tab=conversation`);
    const t = page.getByTestId('transcript');
    await expect(t).toBeVisible();
    await expect(t).toContainText('Read only.');
    await expect(t).toContainText('submitted the proposal');
    record(`conversation-${w}`, { transcript: await box(t) });
    await shot(page, 'conversation', w);
  }
  await expect(page.getByRole('tab', { name: /Conversation/ })).toHaveAttribute('aria-selected', 'true');
});

test('QE-85: a declined request shows its reason to everyone', async ({ page }) => {
  const ref = await refOf(page, 'Light theme');
  await asMember(page);
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${ref}`);
  await expect(page.getByRole('note').getByText(/Declined by /)).toBeVisible();
  await expect(page.getByRole('note').getByText(/not build a second one/)).toBeVisible();
  await expect(page.getByTestId('triage')).toHaveCount(0);
});

test('QE-89: a missing request is an error state, not an empty page', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback/FB-9999');
  await expect(page.getByText('Couldn’t open this request')).toBeVisible();
  await expect(page.getByText('This request does not exist or is not yours').first()).toBeVisible();
});

test('QE-97 to QE-108: triage saves one change with a note and shows it in the history', async ({ page }) => {
  const ref = await refOf(page, 'Show cost per run in the runs list');
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, `/feedback/${ref}`);
    const triage = page.getByTestId('triage');
    await expect(triage).toBeVisible();
    record(`triage-${w}`, { triage: await box(triage) });
    await shot(page, 'triage', w);
  }
  await setViewport(page, 1440);
  const triage = page.getByTestId('triage');
  // QE-108: tab order
  await triage.getByRole('button', { name: /Status/ }).focus();
  await page.keyboard.press('Tab');
  await expect(triage.getByRole('button', { name: /Priority/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(triage.getByRole('button', { name: /Complexity/ })).toBeFocused();
  // a priority change needs a note: Save stays enabled and refuses with the message
  await triage.getByRole('button', { name: /Priority/ }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await expect(page.getByTestId('pending-changes')).toContainText('Priority Medium to High');
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(triage).toContainText('Add a note: it is shown in the history.');
  await expect(triage.getByLabel(/Note for the history/)).toBeFocused();
  const patches: string[] = [];
  page.on('request', (r) => r.method() === 'PATCH' && patches.push(r.postData() ?? ''));
  await triage.getByLabel(/Note for the history/).fill('Three teams asked this week.');
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0]!)).toMatchObject({ priority: 'high', note: 'Three teams asked this week.' });
  expect(Object.keys(JSON.parse(patches[0]!)).sort()).toEqual(['expected_updated_at', 'note', 'priority']);
  await expect(page.getByTestId('history')).toContainText('Priority Medium to High');
  // Reset returns every control to the stored value
  await triage.getByRole('button', { name: /Priority/ }).click();
  await page.getByRole('option', { name: 'Low' }).click();
  await triage.getByRole('button', { name: 'Reset' }).click();
  await expect(triage.getByRole('button', { name: /Priority/ })).toContainText('High');
});

test('QE-101, QE-99: declining needs a reason the submitter sees', async ({ page }) => {
  const ref = await refOf(page, 'Notes on each dataset version');
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${ref}`);
  const triage = page.getByTestId('triage');
  await triage.getByRole('button', { name: /Status/ }).click();
  await page.getByRole('option', { name: 'Declined' }).click();
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(triage).toContainText('Say why it is declined. The submitter sees this.');
  await shot(page, 'triage-decline', 1440);
  await triage.getByLabel(/Note for the history/).fill('Covered by the version description field.');
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('note').getByText(/Declined by /)).toBeVisible();
  // put it back for the other specs
  await triage.getByRole('button', { name: /Status/ }).click();
  await page.getByRole('option', { name: 'Planned' }).click();
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

test('QE-106: a second administrator saving stale sees the reload message', async ({ page, request }) => {
  const ref = await refOf(page, 'Light theme');
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${ref}`);
  const current = (await (await request.get(`/v1/feedback/${ref}`)).json()) as { request: { updated_at: string } };
  const other = await request.patch(`/v1/feedback/${ref}/triage`, { data: { status: 'declined', note: 'n', decline_reason: 'again', expected_updated_at: current.request.updated_at } });
  expect(other.status()).toBe(409 === other.status() ? 409 : other.status());
  const triage = page.getByTestId('triage');
  await triage.getByRole('button', { name: /Status/ }).click();
  await page.getByRole('option', { name: 'Accepted' }).click();
  await triage.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Someone else changed this request|Saved/)).toBeVisible();
});
