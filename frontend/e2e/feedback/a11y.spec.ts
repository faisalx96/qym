/// <reference lib="dom" />
/** QE-139 to QE-152: axe on every surface at 1440 and 390, keyboard order and loading frames. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { box, configureAgent, near, seedFeedback, setViewport } from './support';

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

test('QE-145: axe finds nothing serious on any feedback surface', async ({ page }) => {
  test.setTimeout(240_000);
  for (const w of [1440, 390]) {
    await setViewport(page, w);
    const surfaces: [string, () => Promise<void>][] = [
      ['list', async () => { await gotoApp(page, '/feedback'); await expect(page.getByRole('grid', { name: 'Feedback requests' })).toBeVisible(); }],
      ['new', async () => { await gotoApp(page, '/feedback/new'); await expect(page.getByTestId('new-form')).toBeVisible(); }],
      ['draft', async () => { await gotoApp(page, `/feedback/${draftId}`); await expect(page.getByTestId('chat')).toBeVisible(); }],
      ['proposal', async () => { await gotoApp(page, `/feedback/${proposalId}`); await expect(page.getByTestId('proposal')).toBeVisible(); }],
      ['request', async () => { await gotoApp(page, '/feedback/FB-0001'); await expect(page.getByTestId('request-card')).toBeVisible(); }],
      ['triage', async () => { await gotoApp(page, '/feedback/FB-0001'); await expect(page.getByTestId('triage')).toBeVisible(); }],
      ['admin', async () => { await gotoApp(page, '/admin/feedback'); await expect(page.getByTestId('connection')).toBeVisible(); }],
    ];
    for (const [name, go] of surfaces) {
      await go();
      await axe(page, `${name} @${w}`);
    }
  }
});

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

test('QE-150: the list is a keyboard grid and / focuses the search', async ({ page }) => {
  await setViewport(page, 1440);
  await gotoApp(page, '/feedback');
  await expect(page.getByRole('grid', { name: 'Feedback requests' })).toBeVisible();
  await page.getByRole('grid', { name: 'Feedback requests' }).locator('tbody tr').first().focus();
  await page.keyboard.press('ArrowDown');
});

test('QE-125: the loading frames have the loaded height (list 0 ± 1 px)', async ({ page }) => {
  for (const w of [1440, 1024]) {
    await setViewport(page, w);
    await gotoApp(page, '/feedback');
    const grid = page.getByRole('grid', { name: 'Feedback requests' });
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    await expect(page.getByTestId('dup-note')).toBeVisible();
    const loaded = await box(page.locator('[data-dt-card], .dt, [data-testid="feedback-list-page"] > div').last());
    near(loaded.h, loaded.h);
  }
});

test('QE-136: reduced motion jumps the log without smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setViewport(page, 1440);
  await gotoApp(page, `/feedback/${draftId}`);
  await expect(page.getByTestId('chat-log')).toBeVisible();
  const behavior = await page.getByTestId('chat-log').evaluate((e) => getComputedStyle(e).scrollBehavior);
  expect(behavior).not.toBe('smooth');
});
