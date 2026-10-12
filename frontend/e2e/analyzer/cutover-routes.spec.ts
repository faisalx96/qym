/// <reference lib="dom" />
/**
 * Cutover of test_analysis_routes.py::test_missing_legacy_run_renders_recoverable_analysis_page: a legacy
 * analyzer URL of a run that does not exist ends on a readable error, never a blank page. (The scope
 * aliases and the focused-URL redirect are Vitest: src/features/analyzer/__tests__/cutover-routes.test.ts;
 * the legacy-URL landing is workspace.spec.ts.)
 */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, seedAnalyzer, waitWorkspace } from './helpers';

test('a legacy analyzer URL of a missing run says so', async ({ page }) => {
  await gotoApp(page, '/run/missing-run/analyzer');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  // without a project to scope the lookup the run cannot be placed; with one it is a plain 404
  await expect(alert).toContainText(/Run not found|No project context for this run/);
});

test.describe('release states of the run workspace (test_auto_analysis_release_gate_browser.py)', () => {
  for (const [status, text] of [
    [404, /not found|404/i],
    [403, /permission|forbidden|403|access/i],
  ] as const) {
    test(`a run answered with HTTP ${status} says so`, async ({ page, request }) => {
      const seed = await seedAnalyzer(request);
      await page.route(new RegExp(`/api/runs/${seed.runId}(\\?|$)`), (route) =>
        route.fulfill({ status, json: { detail: `HTTP ${status} from the test` } }),
      );
      await gotoApp(page, analysisUrl(seed.slug, seed.runId));
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(text);
    });
  }

  test('a failed load offers Retry, and Retry recovers', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    let failing = true;
    await page.route(new RegExp(`/api/runs/${seed.runId}(\\?|$)`), (route) =>
      failing ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.continue(),
    );
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    failing = false;
    await alert.getByRole('button', { name: 'Retry' }).click();
    await waitWorkspace(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
