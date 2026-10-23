/// <reference lib="dom" />
/** QE-109 to QE-122: Admin, Feedback agent. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { box, configureAgent, COLUMN, near, overflowX, record, setViewport, shot, STUB_URL, WIDTHS } from './support';

test.describe.configure({ mode: 'serial' });

test('QE-109 to QE-113: the fifth tab, the totals and the connection card at three widths', async ({ page, request }) => {
  await configureAgent(request);
  for (const w of WIDTHS) {
    await setViewport(page, w);
    await gotoApp(page, '/admin/feedback');
    await expect(page.getByRole('tab', { name: 'Feedback agent' })).toHaveAttribute('aria-selected', 'true');
    const conn = page.getByTestId('connection');
    await expect(conn).toBeVisible();
    await expect(conn).toContainText('Configured');
    const tabs = await box(page.getByRole('tablist', { name: 'Admin sections' }));
    const totals = await box(page.getByLabel('Feedback totals'));
    const card = await box(conn);
    if (w !== 390) near(tabs.w, COLUMN[w]);
    near(card.w, COLUMN[w]);
    expect(await overflowX(page)).toBe(0);
    record(`admin-${w}`, { tabs, totals, connection: card });
    await shot(page, 'admin', w);
  }
  await expect(page.getByLabel('API key')).toHaveAttribute('placeholder', /Keep current \(••••1234\)/);
  await expect(page.getByLabel('API key')).toHaveValue('');
});

test('QE-114: test connection reports success and each failure cause; nothing is saved by a failure', async ({ page, request }) => {
  await configureAgent(request);
  await setViewport(page, 1440);
  await gotoApp(page, '/admin/feedback');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected: feedback:ask_then_propose answered in \d+ ms and called a test tool\./)).toBeVisible();
  for (const [script, text] of [['bad_key', 'rejected'], ['no_tools', 'tool calls']] as const) {
    await page.getByLabel('Model').fill(`feedback:${script}`);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('The connection test failed')).toBeVisible();
    await expect(page.getByTestId('connection')).toContainText(text);
    await shot(page, `admin-${script}`, 1440);
  }
  const stored = (await (await request.get('/v1/admin/feedback-agent')).json()) as { connection: { llm_model: string } };
  expect(stored.connection.llm_model).toBe('feedback:ask_then_propose');
});

test('QE-116, QE-120, QE-121: behaviour numbers, keep the key, remove the connection', async ({ page, request }) => {
  await configureAgent(request);
  await setViewport(page, 1440);
  await gotoApp(page, '/admin/feedback');
  await page.getByLabel('Keep drafts for (days)', { exact: true }).first().fill('14');
  await page.getByRole('button', { name: 'Save behaviour' }).click();
  await expect(page.getByText('Behaviour saved')).toBeVisible();
  await page.getByLabel('Keep drafts for (days)', { exact: true }).first().fill('30');
  await page.getByRole('button', { name: 'Save behaviour' }).click();
  await page.getByLabel('Model').fill('feedback:ask_then_propose');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('Connection saved')).toBeVisible();
  const body = (await (await request.get('/v1/admin/feedback-agent')).json()) as { connection: { llm_api_key_hint: string; llm_base_url: string } };
  expect(body.connection.llm_api_key_hint).toBe('••••1234');
  expect(body.connection.llm_base_url).toBe(STUB_URL);
  await page.getByRole('button', { name: 'Remove connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove the connection?' }).or(page.getByRole('alertdialog'));
  await expect(dialog).toContainText('Feedback will show not configured. Existing requests are kept.');
  await dialog.getByRole('button', { name: 'Remove connection' }).click();
  await expect(page.getByTestId('connection')).toContainText('Not configured');
  await configureAgent(request);
});
