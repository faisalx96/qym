/**
 * Kept selection and pager (cutover of test_runs_compare_selection_browser.py). The reducer rules
 * (per project, deleted runs and stale pass picks drop out, Cohort A survives a remount, Clear)
 * are Vitest in src/features/runs-list/__tests__/selection-reconcile.test.ts; here the
 * integration in the browser: a run deleted while the reader was away, the sign-in page
 * starting the tab clean, and the pager next to the selection actions.
 */
import { test, expect, type Page } from '@playwright/test';
import { APP } from '../helpers';
import { clickBox, dataRows, freshProject, openRuns, rowOf, sharedProject } from './support';

const selected = (page: Page) => page.getByTestId('selection-bar').getByText(/executions? selected/);

test('a run deleted while the reader was away drops out of the kept selection', async ({ page, request }) => {
  const s = await freshProject(request, 6);
  await openRuns(page, s.project.slug);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    names.push((await dataRows(page).nth(i).locator('td[data-col="run"] a').innerText()).trim());
    await clickBox(dataRows(page).nth(i).getByRole('checkbox'));
  }
  const [a, b] = names as [string, string, string];
  await expect(selected(page)).toHaveText('3 executions selected');
  await rowOf(page, a).locator('td[data-col="run"] a').click();
  await expect(page).toHaveURL(/\/runs\//);
  // Someone deletes one of the picked runs meanwhile.
  const victim = s.runs.find((r) => r.name === b)!;
  const res = await request.post('/api/runs/delete', { data: { file_path: victim.id } });
  expect(res.ok(), await res.text()).toBeTruthy();
  await page.goBack();
  await expect(dataRows(page).first()).toBeVisible();
  await expect(selected(page)).toHaveText('2 executions selected', { timeout: 20_000 });
  await expect(rowOf(page, b)).toHaveCount(0);
  await expect(rowOf(page, a)).toHaveAttribute('data-selected', '');
  const stored = await page.evaluate(
    (slug) => sessionStorage.getItem(`qym:runs-selection:${slug}`) ?? '',
    s.project.slug,
  );
  expect(stored).not.toContain(victim.id);
});

test('the selection belongs to its project: another project starts empty and the first keeps its picks', async ({
  page,
  request,
}) => {
  const one = await freshProject(request, 4);
  const two = await freshProject(request, 4);
  await openRuns(page, one.project.slug);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await clickBox(dataRows(page).first().getByRole('checkbox'));
  await expect(selected(page)).toHaveText('1 execution selected');
  await page.goto(`${APP}/projects/${two.project.slug}`);
  await expect(dataRows(page).first()).toBeVisible();
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await page.goBack();
  await expect(dataRows(page).first()).toBeVisible();
  await expect(selected(page)).toHaveText('1 execution selected');
});

test('the sign-in page starts the tab clean: no kept selection, no saved filters', async ({
  page,
  request,
}) => {
  const s = await freshProject(request, 4);
  await openRuns(page, s.project.slug, 'sort=task-asc');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await clickBox(dataRows(page).first().getByRole('checkbox'));
  await expect(selected(page)).toHaveText('1 execution selected');
  expect(await page.evaluate(() => Object.keys(sessionStorage).length)).toBeGreaterThan(0);
  await page.goto(`${APP}/login?next=%2F`);
  await expect(page.locator('[data-login-page]')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

for (const width of [1280, 1440, 1024]) {
  test(`the pager stays usable beside the kept selection at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await sharedProject(request, 55, 'big');
    await openRuns(page, s.project.slug);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickBox(dataRows(page).nth(0).getByRole('checkbox'));
    await clickBox(dataRows(page).nth(2).getByRole('checkbox'));
    await expect(selected(page)).toHaveText('2 executions selected');
    const geometry = await page.evaluate(() => {
      const box = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const bar = document.querySelector('[data-testid="status-bar"]');
      const actions = document.querySelector('[data-testid="selection-bar"]');
      const pager = document.querySelector('[data-testid="status-bar"] nav, [aria-label="Pagination"]');
      return {
        bar: box(bar),
        actions: box(actions),
        pager: box(pager),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.overflow).toBe(0);
    const inside = (a: NonNullable<typeof geometry.bar>, o: NonNullable<typeof geometry.bar>) =>
      a.left >= o.left - 0.5 &&
      a.right <= o.right + 0.5 &&
      a.top >= o.top - 0.5 &&
      a.bottom <= o.bottom + 0.5;
    expect(geometry.bar && geometry.actions && geometry.pager).toBeTruthy();
    expect(inside(geometry.actions!, geometry.bar!)).toBe(true);
    expect(inside(geometry.pager!, geometry.bar!)).toBe(true);
    const apart =
      geometry.actions!.right <= geometry.pager!.left + 0.5 ||
      geometry.pager!.right <= geometry.actions!.left + 0.5 ||
      geometry.actions!.bottom <= geometry.pager!.top + 0.5 ||
      geometry.pager!.bottom <= geometry.actions!.top + 0.5;
    expect(apart).toBe(true);
    const next = page.getByRole('button', { name: 'Next page' });
    await expect(next).toBeEnabled();
    await next.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect(selected(page)).toHaveText('2 executions selected');
  });
}
