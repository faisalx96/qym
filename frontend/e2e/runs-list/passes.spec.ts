/** J6 / §8.7: expanding a repeat run: passes, group metrics, select mode, pass delete. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import { clickBox, freshProject, openRuns, rowOf } from './support';

const NAME = 'summarize-repeat-done';

async function seedRepeat(page: Page, request: APIRequestContext) {
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
  return s;
}

const groupMetricRequests = (page: Page) => {
  const urls: URL[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && u.pathname.endsWith('/group-metrics')) urls.push(u);
  });
  return urls;
};

test.describe('runs list: repeat-run passes (J6)', () => {
  test('chevron expands the passes panel with 3 pass rows and the group-metrics strip', async ({
    page,
    request,
  }) => {
    const s = await seedRepeat(page, request);
    const row = rowOf(page, NAME);
    await expect(row.locator('td[data-col="run"]')).toContainText('×3');
    const chevron = row.getByRole('button', { name: `Expand 3 passes of ${NAME}` });
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await chevron.click();
    const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
    await expect(panel).toBeVisible();
    await expect(row.getByRole('button', { name: `Collapse 3 passes of ${NAME}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(panel.getByRole('table', { name: `${NAME} passes` }).locator('tbody tr')).toHaveCount(3);
    await expect(panel.getByText('Group metrics')).toBeVisible();
    await expect(panel.getByText(/k = 3/)).toBeVisible();
    for (const label of ['Pass@3', 'Pass^3', 'Consistency', 'Reliability'])
      await expect(panel.locator('dt', { hasText: label })).toBeVisible();
    // collapse again
    await row.getByRole('button', { name: `Collapse 3 passes of ${NAME}` }).click();
    await expect(panel).toHaveCount(0);
    expect(s.project.slug).toBeTruthy();
  });

  test('changing the Metric select or the threshold slider (keyboard) requests new group metrics', async ({
    page,
    request,
  }) => {
    await seedRepeat(page, request);
    const reqs = groupMetricRequests(page);
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
    await expect(panel.locator('dt', { hasText: 'Pass@3' })).toBeVisible();
    await expect.poll(() => reqs.length).toBeGreaterThanOrEqual(1);
    const base = reqs.length;
    const first = reqs.at(-1)!;
    // metric select
    const current = first.searchParams.get('metric');
    await panel.getByRole('button', { name: /Metric/ }).click();
    const other = current === 'quality' ? 'accuracy' : 'quality';
    await page.getByRole('option', { name: other }).click();
    await expect.poll(() => reqs.length).toBeGreaterThan(base);
    expect(reqs.at(-1)!.searchParams.get('metric')).toBe(other);
    // slider: keyboard step triggers a request with a new threshold
    const n = reqs.length;
    const thumb = panel.getByRole('slider', { name: 'Pass threshold' });
    const t0 = Number(await thumb.inputValue());
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => reqs.length).toBeGreaterThan(n);
    const t1 = Number(reqs.at(-1)!.searchParams.get('threshold'));
    expect(t1).toBeCloseTo(t0 + 0.05, 5);
    expect(reqs.at(-1)!.searchParams.get('metric')).toBe(other);
  });

  test('select mode shows per-pass checkboxes and makes the parent indeterminate; picks count as executions', async ({
    page,
    request,
  }) => {
    const s = await seedRepeat(page, request);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
    const passBoxes = panel.getByRole('checkbox', { name: new RegExp(`^Select pass \\d of ${NAME}$`) });
    await expect(passBoxes).toHaveCount(3);
    const parent = page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true });
    await clickBox(passBoxes.nth(0));
    await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
    await expect.poll(() => parent.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    const stored = await page.evaluate(
      (slug) => JSON.parse(sessionStorage.getItem(`qym:runs-selection:${slug}`) ?? 'null'),
      s.project.slug,
    );
    expect(stored.selected).toEqual([expect.stringMatching(/::pass1$/)]);
    await clickBox(passBoxes.nth(1));
    await expect(page.getByTestId('selection-bar')).toContainText('2 executions selected');
    // ticking the parent selects the whole run (3 executions)
    await clickBox(page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true }));
    await expect(page.getByTestId('selection-bar')).toContainText(/\d executions selected/);
  });

  test('deleting a pass asks for confirmation and removes it', async ({ page, request }) => {
    await seedRepeat(page, request);
    await rowOf(page, NAME)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
    await expect(panel.getByRole('table').locator('tbody tr')).toHaveCount(3);
    await panel.getByRole('button', { name: `Delete pass 2 of ${NAME}` }).click();
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete pass 2?' }));
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Delete pass' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pass 2 deleted' })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: `Passes of ${NAME}` })
        .getByRole('table')
        .locator('tbody tr'),
    ).toHaveCount(2, { timeout: 15_000 });
  });

  test('a SUBMITTED repeat run cannot have passes deleted', async ({ page, request }) => {
    const s = await freshProject(request, 6, { running: false }); // run 005 is a SUBMITTED repeat run
    await openRuns(page, s.project.slug);
    await rowOf(page, 'rag-qa-gpt-4o-005')
      .getByRole('button', { name: /Expand 3 passes/ })
      .click();
    const panel = page.getByRole('region', { name: /Passes of rag-qa-gpt-4o-005/ });
    await expect(panel.getByRole('table').locator('tbody tr')).toHaveCount(3);
    await expect(panel.getByRole('button', { name: /Delete pass/ })).toHaveCount(0);
  });
});
