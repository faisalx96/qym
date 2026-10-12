/**
 * Run-page details from the P0 final review (cutover of test_p0_final_review_browser.py): metric cards keep
 * their badge and error note inside the card at both common widths, and the Display popover closes on Escape
 * and gives focus back. The wording of the error notes is Vitest (metricCardNotes.test.ts).
 */
import { test, expect } from '@playwright/test';
import { openRun, seedClassic, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let classic: string;
let repeat: string;
test.beforeAll(async () => {
  s = await seedProject('rd-p0');
  classic = await seedClassic(s);
  repeat = await seedRepeat(s);
});

// 1088 / 1248 px is a 1280 / 1440 px screen beside the app sidebar.
for (const width of [1088, 1248]) {
  for (const kind of ['single pass', 'repeat'] as const) {
    test(`metric cards keep every part inside the card at ${width}px (${kind})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await openRun(page, s.slug, kind === 'repeat' ? repeat : classic);
      // under 1200 px the analysis panel is a drawer opened by the Analysis button
      if (width < 1200) await page.getByRole('button', { name: 'Analysis', exact: true }).click();
      const cards = page.locator('[data-testid=metric-card]');
      await expect(cards.first()).toBeVisible();
      const overflow = await cards.evaluateAll((nodes) =>
        nodes.map((card) => {
          const right = card.getBoundingClientRect().right;
          const worst = Math.max(
            ...Array.from(card.querySelectorAll('*')).map((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 ? r.right - right : -1;
            }),
          );
          return { metric: card.getAttribute('data-metric'), worst };
        }),
      );
      for (const card of overflow) expect(card.worst, `${card.metric}`).toBeLessThanOrEqual(0.5);
      if (kind === 'single pass')
        await expect(
          page.locator('[data-testid=metric-card]', { hasText: 'task errors' }).first(),
        ).toBeVisible();
    });
  }
}

test('the Display popover closes on Escape from inside it and gives focus back to its button', async ({
  page,
}) => {
  await openRun(page, s.slug, classic);
  const button = page.getByRole('button', { name: 'Display' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const popover = page.getByRole('dialog', { name: /Display/ }).or(page.locator('[data-popover]'));
  await expect(popover.first()).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(popover.first()).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
});
