/**
 * Steps section of the Latency panel with mocked /api/runs/step-latency payloads
 * (cutover of test_step_latency_browser.py: the vanilla step_latency.js widget).
 * The payload is fulfilled in the browser so each case controls exactly which
 * distributions the server "returned".
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { openRun, seedClassic, seedProject, type Seeded } from './support';

let s: Seeded;
let classic: string;

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-steps');
  classic = await seedClassic(s);
});

function group(over: Record<string, unknown> = {}, ms: number | null = 222) {
  return {
    phase: 'task',
    kind: 'LLM',
    step_type: 'llm:test',
    n: 2,
    error_count: 0,
    mean_ms: ms,
    median_ms: ms,
    min_ms: ms,
    max_ms: ms,
    p5_ms: ms,
    p25_ms: ms,
    p75_ms: ms,
    p95_ms: ms,
    cv: 0,
    tokens_total: 500,
    ...over,
  };
}

const payload = (over: Record<string, unknown> = {}) => ({
  run_ids: ['x'],
  rollup: 'site',
  passes: [1, 2],
  trace_count: 1,
  groups: [group()],
  ...over,
});

async function mockSteps(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route(/\/api\/runs\/step-latency\?/, handler);
}
const stepsRegion = (page: Page) => page.getByRole('region', { name: 'Steps' });

test.describe('Steps (step latency)', () => {
  test('a zero-latency step and an errors-only step are kept; a step with no samples is dropped', async ({
    page,
  }) => {
    await mockSteps(page, (route) =>
      route.fulfill({
        json: payload({
          groups: [
            group({ step_type: 'llm:zero' }, 0),
            group(
              {
                step_type: 'tool:broken',
                kind: 'TOOL',
                n: 0,
                error_count: 3,
                mean_ms: null,
                median_ms: null,
                p5_ms: null,
                p25_ms: null,
                p75_ms: null,
                p95_ms: null,
              },
              null,
            ),
            group({ step_type: 'llm:silent', n: 0, error_count: 0 }, null),
          ],
          phases: [group({ n: 1 }, 900)],
        }),
      }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    const steps = stepsRegion(page);
    await expect(steps.getByText('llm:zero')).toBeVisible();
    await expect(steps.getByText('tool:broken')).toBeVisible();
    await expect(steps.getByText('3 err')).toBeVisible();
    await expect(steps.getByText('llm:silent')).toHaveCount(0);
  });

  test('a payload without any observation hides the Steps section', async ({ page }) => {
    await mockSteps(page, (route) =>
      route.fulfill({ json: payload({ groups: [group({ n: 0, error_count: 0 }, null)], trace_count: 0 }) }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    await expect(page.getByTestId('latency-panel')).toBeVisible();
    await expect(stepsRegion(page)).toHaveCount(0);
  });

  test('a load failure stays visible with Retry', async ({ page }) => {
    let fail = true;
    await mockSteps(page, (route) =>
      fail ? route.fulfill({ status: 503, json: { detail: 'down' } }) : route.fulfill({ json: payload() }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expect(page.getByText('Trace timings did not load')).toBeVisible();
    fail = false;
    await retry.click();
    await expect(stepsRegion(page)).toBeVisible();
  });

  test('step names render as text, never as markup', async ({ page }) => {
    const name = 'Team </title><image href="data:," onerror="window.injected=true"/> & "B"';
    await mockSteps(page, (route) =>
      route.fulfill({
        json: payload({ groups: [group({ step_type: name })], phases: [group({ n: 1 }, 900)] }),
      }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    await expect(stepsRegion(page).getByText(name)).toBeVisible();
    await expect(stepsRegion(page).locator('image')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBeUndefined();
  });

  test('the phase header plots its parent span and opens/closes from the keyboard keeping focus', async ({
    page,
  }) => {
    await mockSteps(page, (route) =>
      route.fulfill({ json: payload({ groups: [group()], phases: [group({ n: 1 }, 900)] }) }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    const steps = stepsRegion(page);
    const header = steps.getByRole('button', { name: /Agent/ });
    // The phase row carries the parent bar's numbers (aria-label of its interval).
    await expect(steps.getByLabel('p5 900 ms, median 900 ms, p95 900 ms')).toBeVisible();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(steps.getByText('llm:test')).toBeVisible();
    await header.focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(header).toBeFocused();
    await expect(steps.getByText('llm:test')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(steps.getByText('llm:test')).toBeVisible();
  });

  test('a 30s phase bar shares the axis with the step bars (fits inside the plot)', async ({ page }) => {
    await mockSteps(page, (route) =>
      route.fulfill({ json: payload({ groups: [group()], phases: [group({ n: 1 }, 30000)] }) }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    const table = page.getByRole('table', { name: 'Step latency by call site' });
    await expect(table.getByLabel('p5 30.0 s, median 30.0 s, p95 30.0 s')).toBeVisible();
    const box = await table.getByLabel('p5 30.0 s, median 30.0 s, p95 30.0 s').boundingBox();
    const cell = await table.getByLabel('p5 222 ms, median 222 ms, p95 222 ms').boundingBox();
    expect(box && cell).toBeTruthy();
    expect(cell!.x + cell!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  });

  test('Summary and Spans CSV links export the run in the current scope', async ({ page }) => {
    await mockSteps(page, (route) => route.fulfill({ json: payload() }));
    await openRun(page, s.slug, classic, 'panel=latency');
    const summary = stepsRegion(page).getByRole('link', { name: /Summary CSV/ });
    const spans = stepsRegion(page).getByRole('link', { name: /Spans CSV/ });
    const q = async (l: typeof summary) => new URL((await l.getAttribute('href'))!, 'http://x').searchParams;
    expect((await q(summary)).get('format')).toBe('csv');
    expect((await q(summary)).get('run_ids')).toBe(classic);
    expect((await q(summary)).get('level')).toBeNull();
    expect((await q(spans)).get('level')).toBe('spans');
    expect((await q(spans)).get('format')).toBe('csv');
  });

  test('By kind groups the steps into one row per kind and Log scale keeps the rows', async ({ page }) => {
    await mockSteps(page, (route) =>
      route.fulfill({
        json: payload({
          groups: [group(), group({ step_type: 'tool:x', kind: 'TOOL' }, 50)],
          phases: [group({ n: 1 }, 900)],
        }),
      }),
    );
    await openRun(page, s.slug, classic, 'panel=latency');
    const steps = stepsRegion(page);
    await steps.getByRole('radio', { name: 'By kind' }).click({ force: true });
    await expect(steps.getByText('LLM', { exact: true })).toBeVisible();
    await expect(steps.getByText('Tools', { exact: true })).toBeVisible();
    await expect(steps.getByText('llm:test')).toHaveCount(0);
    await steps.getByRole('radio', { name: 'Log' }).click({ force: true });
    await expect(steps.getByText('Tools', { exact: true })).toBeVisible();
  });
});
