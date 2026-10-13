/** UX review (group C): axe serious/critical must be 0 on the run page, dark and light, including the error tab count and the histogram. */
import { test, expect } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  openRun,
  seedClassic,
  seedProject,
  type Seeded,
} from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-ux-axe');
  classic = await seedClassic(s);
});

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const query of ['', 'panel=errors', 'panel=latency']) {
      test(`run page ${query || 'overview'}: no serious violations`, async ({ page }) => {
        await openRun(page, s.slug, classic, query);
        await expect(page.getByTestId('metric-card').first()).toBeVisible();
        const violations = await axeSeriousViolations(page, '#shell-content');
        expect(violations, describeViolations(violations)).toEqual([]);
      });
    }
  });
}
