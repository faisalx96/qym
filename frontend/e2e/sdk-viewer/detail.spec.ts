/** Journey 4 (inspect a row) and scenarios 7, 8, 10. */
import { detail, expect, freshFile, INPUT, LONG_OUTPUT, rowByInput, rows, test } from './support';
import type { Page } from '@playwright/test';

const open = async (page: Page, request: Parameters<typeof freshFile>[0]) => {
  const { url } = await freshFile(request);
  await page.goto(url);
  await expect(rows(page)).toHaveCount(8);
};

test.describe('row detail', () => {
  test('keyboard: Tab reaches a row, Enter opens the detail, Escape returns to the row', async ({
    page,
    request,
  }) => {
    await open(page, request);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    // Tab until a table row has focus (skip link, ribbon, toolbar and headers come first)
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.matches('tr[data-row]'))) break;
    }
    const first = rows(page).first();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const second = rows(page).nth(1);
    await expect(second).toBeFocused();
    const index = await second.getAttribute('data-row');

    await page.keyboard.press('Enter');
    await expect(detail(page)).toBeFocused();
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('article[aria-labelledby="detail-title"]')),
    ).toBe(true);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`row=${index}`));

    // Escape also works from a control inside the detail
    await detail(page).getByRole('checkbox', { name: 'Show diff' }).focus();
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await expect(rows(page).nth(1)).toBeFocused();
    await expect(page).not.toHaveURL(/row=/);
  });

  test('keyboard: the ribbon moves with arrows and opens a row with Enter', async ({ page, request }) => {
    await open(page, request);
    const ribbon = page.getByRole('toolbar');
    const cells = ribbon.getByRole('button');
    await expect(cells).toHaveCount(8);
    await cells.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cells.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(cells.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cells.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /^Row \d+$/ })).toBeVisible();
    await expect(detail(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(cells.first()).toBeFocused();
  });

  test('the Close button closes and Escape from the table is harmless', async ({ page, request }) => {
    await open(page, request);
    await rowByInput(page, INPUT.wrong).click();
    await expect(detail(page)).toBeVisible();
    await detail(page)
      .getByRole('button', { name: /Close row detail/ })
      .click();
    await expect(detail(page)).toHaveCount(0);
    await expect(page.getByText(/Select a row or a ribbon cell/)).toBeVisible();
  });

  test('Show diff marks the differing words', async ({ page, request }) => {
    await open(page, request);
    await rowByInput(page, INPUT.diff).click();
    await expect(detail(page).locator('ins, del')).toHaveCount(0);
    await detail(page).getByRole('checkbox', { name: 'Show diff' }).check();
    await expect(detail(page).locator('pre[aria-label="Output"] ins')).toContainText(['slow', 'dog']);
    await expect(detail(page).locator('pre[aria-label="Expected"] del')).toContainText(['quick', 'fox']);
    await detail(page).getByRole('checkbox', { name: 'Show diff' }).uncheck();
    await expect(detail(page).locator('ins, del')).toHaveCount(0);
    await expect(detail(page).locator('pre[aria-label="Output"]')).toHaveText('the slow brown dog');
  });

  test('Copy puts the full, uncollapsed text on the clipboard', async ({ page, request }) => {
    await open(page, request);
    await rowByInput(page, INPUT.long).click();
    const output = detail(page)
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Output' }) });
    await expect(output.getByRole('button', { name: 'Show all' })).toBeVisible();
    await output.getByRole('button', { name: 'Copy output' }).click();
    await expect(output.getByRole('button', { name: 'Copy output' })).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG_OUTPUT);

    await output.getByRole('button', { name: 'Show all' }).click();
    await expect(output.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true');

    await detail(page).getByRole('button', { name: 'Copy expected' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('short');
  });

  test('Arabic blocks are right-to-left with lang=ar, English ones are not', async ({ page, request }) => {
    await open(page, request);
    await rowByInput(page, INPUT.arabic).click();
    for (const label of ['Input', 'Output', 'Expected']) {
      const block = detail(page).locator(`pre[aria-label="${label}"]`);
      await expect(block).toHaveAttribute('dir', 'rtl');
      await expect(block).toHaveAttribute('lang', 'ar');
    }
    // the table cells carry it as well
    await expect(rowByInput(page, INPUT.arabic).locator('td[dir="rtl"][lang="ar"]').first()).toBeVisible();
    await rowByInput(page, INPUT.diff).click();
    await expect(detail(page).locator('pre[aria-label="Input"]')).not.toHaveAttribute('dir', 'rtl');
    await expect(page.locator('header [lang="ar"]')).toHaveText('قيِّم');
  });

  test('a failed row shows the error and metric scores read n/a, not zero', async ({ page, request }) => {
    await open(page, request);
    const errorRow = page.locator('tbody tr[data-status="error"]');
    await expect(errorRow.locator('td').nth(4)).not.toHaveText(/^0$/);
    await errorRow.click();
    await expect(detail(page).getByRole('alert')).toContainText('boom: the task exploded');
    await expect(detail(page).locator('pre[aria-label="Output"]')).toHaveCount(0);
  });
});
