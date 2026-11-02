/**
 * Keyboard contract of the trace drawer (cutover of the trace-drawer cases of
 * test_p1_a11y_visual_browser.py): closed it has no tab stops, opened it takes focus and
 * keeps Tab inside, Enter works on its buttons, closing returns focus to the Trace button.
 */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-trace-kbd');
  classic = await seedClassic(s);
});

const traceButton = (page: Page, n: number) =>
  page.getByRole('button', { name: `Open trace of item #${n}`, exact: true });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Trace' });
const inDrawer = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test('a closed drawer has no tab stops; an open one takes focus, traps Tab and gives focus back', async ({
  page,
}) => {
  await openRun(page, s.slug, classic);
  await expect(drawer(page)).toHaveCount(0);
  const button = traceButton(page, 7);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();
  expect(await inDrawer(page)).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await inDrawer(page), `Tab ${i}`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await inDrawer(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('Enter activates the Close button in the drawer and returns focus to Trace (j / k selection: traces.spec)', async ({
  page,
}) => {
  await openRun(page, s.slug, classic);
  const button = traceButton(page, 7);
  await button.focus();
  await page.keyboard.press('Enter');
  const tree = page.getByRole('tree', { name: 'Span tree' });
  await expect(tree).toBeVisible();
  await drawer(page)
    .getByRole('button', { name: /^Close/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});
