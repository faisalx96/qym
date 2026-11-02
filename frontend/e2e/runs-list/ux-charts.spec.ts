/** UX review (group B) regressions for the Charts page. */
import { test, expect } from '@playwright/test';
import { APP } from '../helpers';
import { BOOL, LOWER, SCORE, seedRun, waitForProjection } from './seed';
import { freshProject } from './support';

test.describe('charts: UX regressions', () => {
  test('the dataset tab and the Runs/Grouped choice survive a reload and Back from a run', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12, { running: false });
    for (let i = 0; i < 2; i++) {
      await seedRun(request, s.token, {
        name: `text2sql-test-${i}`,
        task: 'text2sql',
        dataset: 'spider-test',
        model: 'openai/gpt-4o',
        metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
        items: Array.from({ length: 4 }, (_, j) => ({ accuracy: j % 2, quality: 0.5, latency_s: 0.5 })),
        startedAt: new Date(Date.now() - (i + 1) * 3_600_000),
      });
    }
    await waitForProjection(request, s.project.slug, s.runs.length + 2);
    await page.goto(`${APP}/projects/${s.project.slug}/charts`);
    const card = page.getByTestId('chart-card-text2sql');
    const tabs = card.getByRole('tablist', { name: 'text2sql datasets' });
    await tabs.getByRole('tab', { name: /spider-test/ }).click();
    await expect(tabs.getByRole('tab', { name: /spider-test/ })).toHaveAttribute('aria-selected', 'true');
    await card
      .getByRole('radiogroup', { name: 'text2sql rows' })
      .getByText('Grouped', { exact: true })
      .click();
    await expect(card.getByRole('radio', { name: 'Grouped' })).toBeChecked();

    await page.reload();
    const again = page.getByTestId('chart-card-text2sql');
    await expect(
      again.getByRole('tablist', { name: 'text2sql datasets' }).getByRole('tab', { name: /spider-test/ }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(again.getByRole('radio', { name: 'Grouped' })).toBeChecked();
    // other cards are untouched
    await expect(page.getByTestId('chart-card-summarize').getByRole('radio', { name: 'Runs' })).toBeChecked();
  });
});
