/// <reference lib="dom" />
/** Round 5 after-screenshots (docs/internal/ui-migration/redesign5/shots/after-*.png). Runs only with R5_SHOTS=1. */
import { test, expect, type Page } from '@playwright/test';
import { chooseOption, openRun, seedClassic, seedProject, seedR5, type Seeded } from './support';

test.skip(!process.env.R5_SHOTS, 'screenshots are produced on demand');

let s: Seeded;
let classic: string;
let details: string;
let passes19: string;
const OUT = '../docs/internal/ui-migration/redesign5/shots';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-shots');
  classic = await seedClassic(s);
  const r = await seedR5(s);
  details = r.details;
  passes19 = r.passes19;
});

const settle = (page: Page) =>
  page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));

for (const w of [1440, 390]) {
  test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: 1000 } });

    test('bars', async ({ page }) => {
      await openRun(page, s.slug, details);
      await expect(page.getByTestId('metric-card').first()).toBeVisible();
      await settle(page);
      await page.locator('#run-section-overview').screenshot({ path: `${OUT}/after-r5-bars-10-${w}.png` });
      await openRun(page, s.slug, passes19, 'panel=repeat');
      const card = page
        .locator('section[aria-label]')
        .filter({ has: page.getByRole('group', { name: /^Items by number of passes/ }) })
        .first();
      await expect(card).toBeVisible();
      await settle(page);
      await card.screenshot({ path: `${OUT}/after-r5-bars-20-${w}.png` });
    });

    test('box plots', async ({ page }) => {
      await openRun(page, s.slug, classic);
      const grid = page.getByTestId('metric-card').filter({ hasText: 'tokens_used' });
      await expect(grid).toBeVisible();
      await settle(page);
      await grid.screenshot({ path: `${OUT}/after-r5-box-coloured-${w}.png` });
      await openRun(page, s.slug, passes19, 'panel=repeat');
      const panel = page.getByTestId('repeat-analysis');
      await chooseOption(page, panel.getByRole('button', { name: /Metric/ }).first(), 'quality');
      const dist = panel.getByRole('region', { name: 'quality by pass' });
      await expect(dist).toBeVisible();
      await settle(page);
      await dist.screenshot({ path: `${OUT}/after-r5-box-perpass-${w}.png` });
    });

    for (const [metric, name] of [
      ['rubric_judge', 'metric-panel-en'],
      ['arabic_judge', 'metric-panel-ar'],
    ] as const) {
      test(name, async ({ page }) => {
        await openRun(page, s.slug, details, 'item=r5-005');
        const card = page.locator('[data-testid=item-card][data-item-id="r5-005"]');
        await card.locator(`[data-cell^="${metric}::"]`).first().click();
        const panel = card.getByTestId('metric-detail');
        await expect(panel).toBeVisible();
        await page.waitForTimeout(300);
        await panel.screenshot({ path: `${OUT}/after-r5-${name}-${w}.png` });
        if (metric === 'rubric_judge' && w === 1440)
          await card
            .getByRole('region', { name: 'Metrics' })
            .screenshot({ path: `${OUT}/after-r5-metric-matrix-${w}.png` });
      });
    }
  });
}
