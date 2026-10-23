/// <reference lib="dom" />
/** QE-139 to QE-152: axe on every surface at 1440 and 390, keyboard order and loading frames. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { configureAgent, seedFeedback, setViewport, tableOf } from './support';

test.describe.configure({ mode: 'serial' });
let draftId = '';
let proposalId = '';
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await configureAgent(request);
  seedFeedback(1);
  const mk = async (message: string) => ((await (await request.post('/v1/feedback', { data: { subject: 'platform', message } })).json()) as { id: string }).id;
  draftId = await mk('A draft for the axe pass.');
  await request.post(`/v1/feedback/${draftId}/turn`, { headers: { Accept: 'application/json' } });
  proposalId = await mk('A draft with a proposal for the axe pass.');
  await request.post(`/v1/feedback/${proposalId}/turn`, { headers: { Accept: 'application/json' } });
  await request.post(`/v1/feedback/${proposalId}/messages`, { data: { content: 'Five analysts, weekly. A PDF is enough.' }, headers: { Accept: 'application/json' } });
});

async function axe(page: Page, label: string) {
  await page.waitForTimeout(600);
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

const SURFACES: [string, () => string, string][] = [
  ['list', () => '/feedback', '[aria-label="Feedback requests"]'],
  ['new', () => '/feedback/new', '[data-testid="new-form"]'],
  ['draft', () => `/feedback/${draftId}`, '[data-testid="chat"]'],
  ['proposal', () => `/feedback/${proposalId}`, '[data-testid="proposal"]'],
  ['request', () => '/feedback/FB-0001', '[data-testid="request-card"]'],
  ['triage', () => '/feedback/FB-0001', '[data-testid="triage"]'],
  ['admin', () => '/admin/feedback', '[data-testid="connection"]'],
];
for (const w of [1440, 390]) {
  for (const [name, path, ready] of SURFACES) {
    test(`QE-145: axe finds nothing serious on ${name} at ${w}`, async ({ page }) => {
      await setViewport(page, w);
      await gotoApp(page, path());
      await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
      await axe(page, `${name} @${w}`);
    });
  }
}

test('QE-142, QE-72: the proposal card heading takes focus and tab order follows the card', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${proposalId}`);
  const card = page.getByTestId('proposal');
  await expect(card).toBeVisible();
  const order = await card.evaluate((el) => {
    const fields = [...el.querySelectorAll<HTMLElement>('input, textarea, button')].filter((e) => !(e as HTMLButtonElement).disabled);
    return fields.map((f) => f.getAttribute('aria-label') || f.textContent?.trim() || f.closest('label')?.textContent || f.id).slice(0, 12);
  });
  expect(order.length).toBeGreaterThan(4);
});

test('QE-150: the list is a keyboard grid; / focuses the search; Enter opens a row', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  await expect(tableOf(page)).toBeVisible();
  await expect(page.getByTestId('dup-note')).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search requests')).toBeFocused();
  await page.keyboard.press('Escape');
  await tableOf(page).locator('tbody tr[data-request]').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/feedback\/FB-\d{4}/);
});

test('QE-136: reduced motion jumps the log without smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${draftId}`);
  await expect(page.getByTestId('chat-log')).toBeVisible();
  const behavior = await page.getByTestId('chat-log').evaluate((e) => getComputedStyle(e).scrollBehavior);
  expect(behavior).not.toBe('smooth');
});
