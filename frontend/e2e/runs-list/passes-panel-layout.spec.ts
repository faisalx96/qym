/** Redesign 2, W4: the calmer passes panel: one stat band row, sticky width, threshold chip, phone cards, axe. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import { axeSeriousViolations, describeViolations, freshProject, openRuns, rowOf, table } from './support';

const NAME = 'summarize-repeat-done';

async function open(page: Page, request: APIRequestContext) {
  const s = await freshProject(request, 3, { running: false });
  await seedRun(request, s.token, {
    name: NAME,
    task: 'summarize',
    dataset: 'cnn-sample',
    model: 'openai/gpt-4o',
    metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
    items: Array.from({ length: 6 }, (_, j) => ({ accuracy: j % 2, quality: 0.5 + j / 20, latency_s: 0.5 })),
    samples: 3,
    status: 'COMPLETED',
  });
  await openRuns(page, s.project.slug);
  await rowOf(page, NAME)
    .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
    .click();
  const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
  await expect(panel).toBeVisible();
  await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(3);
  return panel;
}

test.describe('passes panel at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the five stats sit on one row and the panel stays compact', async ({ page, request }) => {
    const panel = await open(page, request);
    const strip = panel.locator('[aria-label="Group metrics"]').first();
    await expect(strip).toContainText('Pass@3');
    const tops = await strip
      .locator('[data-stat], > * > *')
      .evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops.length).toBeLessThanOrEqual(2); // tile and its inner label, never a second row of tiles
    const h = (await panel.boundingBox())!.height;
    expect(h).toBeLessThan(330);
  });

  test('the threshold is one chip that opens a popover with presets', async ({ page, request }) => {
    const panel = await open(page, request);
    const chip = panel.getByTestId('pass-threshold-chip');
    await expect(chip).toHaveText(/^Pass if [≥≤] \d+%$/);
    await chip.click();
    const pop = page.getByRole('dialog', { name: 'Pass threshold' });
    await expect(pop.getByRole('slider', { name: 'Pass threshold' })).toBeVisible();
    await pop.getByRole('button', { name: '90%' }).click();
    await expect(chip).toContainText('90%');
  });

  test('horizontal scroll never drags the panel', async ({ page, request }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    const panel = await open(page, request);
    const before = (await panel.boundingBox())!.x;
    await table(page)
      .locator('[data-dt-scroller]')
      .first()
      .evaluate((el) => (el.scrollLeft = el.scrollWidth));
    const after = (await panel.boundingBox())!.x;
    expect(Math.abs(after - before)).toBeLessThan(2);
  });

  test('axe: no serious or critical violations', async ({ page, request }) => {
    await open(page, request);
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('reduced motion: the panel opens without animation', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const panel = await open(page, request);
    const anims = await panel.evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(anims).toBe(0);
  });
});

test.describe('passes panel at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the panel fits the phone: no horizontal page scroll, axe clean', async ({ page, request }) => {
    const s = await freshProject(request, 3, { running: false });
    await seedRun(request, s.token, {
      name: NAME,
      task: 'summarize',
      dataset: 'cnn-sample',
      model: 'openai/gpt-4o',
      metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
      items: Array.from({ length: 6 }, (_, j) => ({ accuracy: j % 2, quality: 0.5, latency_s: 0.5 })),
      samples: 3,
      status: 'COMPLETED',
    });
    await openRuns(page, s.project.slug);
    const card = page.getByTestId('runs-table').getByText(NAME).first();
    await expect(card).toBeVisible();
    const fits = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });
});
