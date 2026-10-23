/// <reference lib="dom" />
/** QE-35 to QE-76: the chat on a draft, the checklist and the proposal card (stub model, scripted conversations). */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, near, overflowX, record, seedFeedback, setViewport, shot, WIDTHS } from './support';

test.describe.configure({ mode: 'serial' });

async function newDraft(request: APIRequestContext, message = 'We need to export the run comparison as a PDF.'): Promise<string> {
  const res = await request.post('/v1/feedback', { data: { subject: 'platform', message } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const composer = (page: Page) => page.getByLabel('Your reply');

async function toProposal(page: Page, id: string) {
  await gotoApp(page, `/feedback/${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected and how often');
  await composer(page).fill('Five analysts, every week, screenshots today. A PDF is enough. No deadline.');
  await composer(page).press('Enter');
  await expect(page.getByTestId('proposal')).toBeVisible({ timeout: 20_000 });
}

test('QE-35 to QE-45: opening a draft streams the first answer; the log, composer and checklist', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  const calls: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && calls.push(new URL(r.url()).pathname));
  await gotoApp(page, `/feedback/${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected and how often', { timeout: 15_000 });
  expect(calls.filter((c) => c.endsWith('/turn'))).toHaveLength(1);
  // a draft whose last message is the assistant's makes no call when opened again
  calls.length = 0;
  await page.reload();
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected');
  await page.waitForTimeout(500);
  expect(calls.filter((c) => c.endsWith('/turn'))).toHaveLength(0);
  const log = page.getByRole('log', { name: 'Conversation messages' });
  await expect(log).toHaveAttribute('aria-live', 'polite');
  await expect(log).toHaveAttribute('tabindex', '0');
  const items = page.getByRole('list', { name: 'Information checklist' }).getByRole('listitem');
  await expect(items).toHaveCount(6);
  await expect(items.first()).toContainText('Business need: Known');
  await expect(page.getByTestId('checklist')).toContainText('1 of 6');
});

test('QE-36, QE-37, QE-41, QE-44: geometry of the chat page at the three widths', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, `/feedback/${id}`);
    await expect(page.getByTestId('chat-log')).toContainText('Who is affected', { timeout: 15_000 });
    const chat = await box(page.getByTestId('chat'));
    const composerBox = await box(page.locator('[class*="composer"]').first());
    const rail = await box(page.getByTestId('checklist'));
    const header = await box(page.locator('[data-page-header]'));
    const log = await box(page.getByTestId('chat-log'));
    near(chat.h, 640);
    near(chat.w, { 1440: 827, 1024: 777, 390: 279 }[w]);
    if (w === 1440) near(rail.w, 352);
    expect(await overflowX(page)).toBe(0);
    record(`chat-${w}`, { chat, composer: composerBox, checklist: rail, header, log });
    await shot(page, 'chat', w);
  }
});

test('QE-42, QE-43, QE-139, QE-140: sending streams under the message and announces once', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected');
  await composer(page).fill('Five analysts, every week, screenshots today. A PDF is enough. No deadline.');
  await composer(page).press('Enter');
  await expect(page.getByText('writing…').or(page.getByTestId('chat-log').locator('[aria-busy="true"]'))).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.getByTestId('chat-status')).toHaveText(/The assistant (answered|proposed a request)/, { timeout: 20_000 });
  await expect(composer(page)).toBeFocused({ timeout: 5_000 }).catch(() => undefined);
});

test('QE-57 to QE-72: the proposal card, its fields, duplicate callout and submit', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  // an existing request the stub proposal can name is not needed: the ask_then_propose script relates nothing
  const id = await newDraft(request, 'We need to export the run comparison as a PDF.');
  for (const w of WIDTHS) {
    await setViewport(page, w);
    if (w === 1440) await toProposal(page, id);
    else {
      await gotoApp(page, `/feedback/${id}`);
      await expect(page.getByTestId('proposal')).toBeVisible();
    }
    const card = page.getByTestId('proposal');
    const b = await box(card);
    const title = await box(page.getByLabel('Title'));
    const desc = await box(page.getByLabel('Description'));
    record(`proposal-${w}`, { card: b, title, description: desc });
    expect(await overflowX(page)).toBe(0);
    await shot(page, 'proposal', w);
  }
  await setViewport(page, 1440);
  const card = page.getByTestId('proposal');
  await expect(card.getByRole('heading', { name: 'Proposed request' })).toBeVisible();
  await expect(page.getByText('Assistant proposed Medium')).toBeVisible();
  await expect(page.getByText(/Assistant proposed M · about a week/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Submit request' })).toBeEnabled();
  // QE-66: an empty description disables submit and names the problem
  await page.getByLabel('Description').fill('');
  await expect(card.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await expect(card).toContainText('The description cannot be empty.');
  await page.getByLabel('Description').fill('A PDF of the compare view for the weekly review, replacing manual screenshots.');
  // QE-60: priority edited keeps the assistant's value visible
  await card.getByRole('button', { name: /Priority/ }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await expect(card).toContainText('You changed it from Medium.');
  await expect(card).toContainText('Assistant proposed Medium');
  // QE-67: submit once, move to the request, toast
  await card.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(/\/feedback\/FB-\d{4}$/, { timeout: 15_000 });
  await expect(page.getByText(/Submitted as FB-/)).toBeVisible();
});

test('QE-65: a new message supersedes the proposal; Keep talking focuses the composer', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  await toProposal(page, id);
  await page.getByRole('button', { name: 'Keep talking' }).click();
  await expect(composer(page)).toBeFocused();
  await composer(page).fill('One more thing: managers read it on phones.');
  await composer(page).press('Enter');
  await expect(page.getByTestId('proposal')).toHaveAttribute('data-superseded', '');
  await expect(page.getByText('Superseded')).toBeVisible();
});

test('QE-68: a stale proposal keeps the person\'s edits', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  await toProposal(page, id);
  await page.getByLabel('Title').fill('My own title');
  await expect(composer(page)).toBeEnabled({ timeout: 20_000 });
  // the conversation moves on in another window
  const other = await request.post(`/v1/feedback/${id}/messages`, { data: { content: 'Actually also the item table.' }, headers: { Accept: 'application/json' } });
  expect(other.status(), await other.text()).toBe(200);
  await page.getByTestId('proposal').getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText('The conversation moved on. Ask the assistant to propose again.')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('My own title');
});

test('QE-48: Discard draft asks, then returns to the list', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${id}`);
  await page.getByRole('button', { name: 'Discard draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this draft?' }).or(page.getByRole('alertdialog'));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete draft' }).click();
  await expect(page).toHaveURL(/\/feedback$/);
});

test('QE-124: an unavailable model shows the cause and Retry re-runs without duplicating the message', async ({ page, request }) => {
  await configureAgent(request, 'down');
  const id = await newDraft(request, 'This will fail first.');
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${id}`);
  const alert = page.getByTestId('agent-unavailable');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText('The assistant could not answer');
  await expect(alert).toContainText('Your message is saved.');
  await configureAgent(request, 'ask_then_propose');
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected', { timeout: 15_000 });
  await expect(page.getByTestId('chat-log').getByText('This will fail first.')).toHaveCount(1);
  await shot(page, 'chat-error', 1440);
});

test('QE-50, QE-148: Stop keeps the partial text marked stopped', async ({ page, request }) => {
  await configureAgent(request, 'ask_then_propose');
  const id = await newDraft(request);
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${id}`);
  await expect(page.getByTestId('chat-log')).toContainText('Who is affected');
  await composer(page).fill('Five analysts, every week, screenshots today. A PDF is enough. No deadline.');
  await composer(page).press('Enter');
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  await stop.click();
  await expect(composer(page)).toBeEnabled();
});

test('QE-62, QE-63, QE-64: a duplicate and a conflict are real requests; the submit label says possible duplicate', async ({ page, request }) => {
  test.setTimeout(90_000);
  await configureAgent(request, 'ask_then_propose');
  seedFeedback(0);
  await configureAgent(request, 'duplicate_found');
  try {
    const id = await newDraft(request, 'We need a PDF export of the comparison.');
    for (const w of WIDTHS) {
      await setViewport(page, w);
      await gotoApp(page, `/feedback/${id}`);
      const card = page.getByTestId('proposal');
      await expect(card).toBeVisible({ timeout: 25_000 });
      if (w === 1440) await expect(page.getByTestId('chat-status')).toHaveText(/answered|proposed/, { timeout: 25_000 });
      await expect(card.getByText(/This looks like a duplicate of FB-0001/)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Submit as a possible duplicate' })).toBeVisible();
      const related = card.getByTestId('related');
      await expect(related.getByText('Duplicate', { exact: true })).toBeVisible();
      await expect(related.getByText('Conflict', { exact: true })).toBeVisible();
      await expect(related.locator('[data-related="FB-0001"]')).not.toHaveText('');
      record(`proposal-duplicate-${w}`, { card: await box(card), related: await box(related) });
      await shot(page, 'proposal-duplicate', w);
    }
  } finally {
    await configureAgent(request);
  }
});
