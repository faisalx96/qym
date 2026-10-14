/** Cutover of test_dashboard_static.py: empty-state docs link and the Analysis column states. */
import { test, expect } from '@playwright/test';
import { createProject, uniqueSlug } from '../helpers';
import { BOOL, LOWER, seedRun } from './seed';
import { freshProject, openRuns, runsUrl, dataRows, rowOf } from './support';

test.describe('runs list: cutover row details', () => {
  test('the empty project links to the first-run guide', async ({ page, request }) => {
    const p = await createProject(request, 'Empty docs', uniqueSlug('emptydocs'));
    await page.goto(runsUrl(p.slug));
    const link = page.getByRole('link', { name: /log your first run/ });
    await expect(link).toHaveAttribute('href', /\/docs-guide#get-started\/first-run$/);
    await link.click();
    await expect(page).toHaveURL(/\/docs\/get-started\/first-run$/);
  });

  test('Analysis column: live runs show a dash, finished runs an Analyze link to their analyzer', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 8, { running: true });
    await openRuns(page, s.project.slug);
    const rows = dataRows(page);
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    let live = 0;
    let finished = 0;
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const status = ((await row.locator('td[data-col="status"]').textContent()) ?? '').trim().toUpperCase();
      const cell = row.locator('td[data-col="analysis"]');
      if (/RUNNING|PENDING/.test(status)) {
        live++;
        await expect(cell).toHaveText('—');
        await expect(cell.getByRole('link')).toHaveCount(0);
      } else {
        finished++;
        const id = await row.getAttribute('data-run-id');
        const link = cell.getByRole('link');
        await expect(link).toHaveAttribute('href', new RegExp(`/runs/${id}/analyzer$`));
        await expect(link).toHaveText(/Analyze|\d+ causes/);
      }
    }
    expect(live).toBeGreaterThan(0);
    expect(finished).toBeGreaterThan(0);
  });

  test('a lower-is-better metric cell says its errors were left out and the marker opens the explanation', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 2, { running: false });
    await seedRun(request, s.token, {
      name: 'lower-errors-run',
      task: 'summarize',
      dataset: 'cnn-sample',
      model: 'openai/gpt-4o',
      metrics: { accuracy: BOOL, latency_s: LOWER },
      items: [{ accuracy: 1, latency_s: 0.5 }, null, { accuracy: 0, latency_s: 0.7 }],
      status: 'COMPLETED',
    });
    await openRuns(page, s.project.slug);
    const marker = rowOf(page, 'lower-errors-run').getByRole('button', {
      name: /Lower is better for latency_s/,
    });
    await expect(marker).toBeVisible();
    await marker.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'latency_s errors' });
    await expect(dlg).toContainText('Task errors in the run');
    await expect(dlg).toContainText('left out of its mean');
  });
});
