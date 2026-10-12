/** Small UI helpers shared by the experiments specs. */
import { expect, type Locator, type Page } from '@playwright/test';

/** Opens a react-aria Select by its label and picks an option. */
export async function pickSelect(
  scope: Page | Locator,
  label: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  const page = 'page' in scope ? (scope as Locator).page() : (scope as Page);
  await scope.getByRole('button', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

export function query(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

/** Tab through the page until `locator` is focused (fails after `max` presses). */
export async function tabTo(page: Page, locator: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error('element never received keyboard focus');
}
