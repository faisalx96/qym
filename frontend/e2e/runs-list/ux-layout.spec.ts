/// <reference lib="dom" />
/** UX review (group B) regressions: status-bar overlap, dashboard card clipping, header hit area. */
import { test, expect, type Page } from '@playwright/test';
import { clickBox, dataRows, freshProject, openFilters, openRuns, sharedProject, urlParams } from './support';

/** True when the centre of the element is the element itself (nothing overlaps it). */
const reachable = (page: Page, testid: string, name: string) =>
  page.evaluate(
    ([id, label]) => {
      const el = Array.from(
        document.querySelectorAll(`[data-testid="${id}"] button, [data-testid="${id}"] [role=button]`),
      ).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().startsWith(label!));
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && el.contains(hit) ? 'ok' : `covered by ${hit?.tagName}.${hit?.className}`;
    },
    [testid, name],
  );

test.describe('runs list: UX layout regressions', () => {
  for (const width of [390, 768, 1024, 1280, 1920]) {
    test(`selection bar buttons and pager stay reachable at ${width}px`, async ({ page, request }) => {
      const s = await freshProject(request, 12, { running: false });
      await page.setViewportSize({ width, height: 800 });
      await openRuns(page, s.project.slug);
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      await clickBox(page.getByRole('checkbox', { name: /^Select / }).nth(1));
      await clickBox(page.getByRole('checkbox', { name: /^Select / }).nth(2));
      await expect(page.getByTestId('selection-bar')).toContainText('2 executions selected');
      const bar = await page.getByTestId('status-bar').boundingBox();
      for (const name of ['Compare', 'Cohort', 'Delete', 'Clear']) {
        const box = await page
          .getByTestId('selection-bar')
          .getByRole('button', { name, exact: true })
          .boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.x + box!.width, `${name} clipped on the right`).toBeLessThanOrEqual(
          bar!.x + bar!.width + 1,
        );
      }
      expect(await reachable(page, 'status-bar', 'Next page')).toBe('ok');
      expect(await reachable(page, 'status-bar', 'Keyboard shortcuts')).toBe('ok');
    });
  }

  test('dashboard Recent runs card shows run name and date unclipped at 1280px', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 20);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${s.project.slug}/overview`);
    const card = page.getByRole('region', { name: 'Recent runs' });
    await expect(card.locator('tbody tr').first()).toBeVisible();
    const clipped = await card.evaluate((el) => {
      const wrap = Array.from(el.querySelectorAll('*')).find(
        (n) => n.clientWidth > 100 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowX),
      );
      const date = Array.from(el.querySelectorAll('tbody tr:first-child td')).at(-1)!;
      const span = date.firstElementChild ?? date;
      return {
        scrolls: wrap ? wrap.scrollWidth - wrap.clientWidth : 0,
        dateClipped: span.scrollWidth - span.clientWidth,
        runWidth: el.querySelector('tbody tr td')!.getBoundingClientRect().width,
      };
    });
    expect(clipped.scrolls).toBeLessThanOrEqual(1);
    expect(clipped.dateClipped).toBeLessThanOrEqual(1);
    expect(clipped.runWidth).toBeGreaterThanOrEqual(110);
  });

  test('the whole column header cell sorts, not only the label', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    const th = page.locator('[data-testid="runs-table"] thead th', { hasText: /^Task/i });
    const box = (await th.boundingBox())!;
    // 0.45: the right edge holds the column menu button, which appears on hover
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
    await expect.poll(() => urlParams(page).get('sort')).toBe('task-asc');
    await expect(dataRows(page).first()).toBeVisible();
  });

  test('the custom date range dialog is not covered by the Filters popover', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug);
    await openFilters(page);
    await page.getByTestId('filters-panel').getByText('Range…').click();
    const dlg = page.getByRole('dialog', { name: 'Custom date range' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('filters-panel')).toHaveCount(0);
    const covered = await dlg.getByRole('heading', { name: 'Custom date range' }).evaluate((h) => {
      const r = h.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
      return !hit || !h.contains(hit);
    });
    expect(covered).toBe(false);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
  });

  for (const width of [390, 1280]) {
    test(`trend x-axis labels neither overlap nor clip at ${width}px`, async ({ page, request }) => {
      const s = await freshProject(request, 12);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/projects/${s.project.slug}/overview?range=90d`);
      const fig = page.getByTestId('trend-chart');
      await expect(fig).toBeVisible({ timeout: 15_000 });
      await expect(
        fig
          .locator('text.recharts-cartesian-axis-tick-value', { hasText: /^[A-Z][a-z]{2} \d{1,2}$/ })
          .first(),
      ).toBeVisible();
      const boxes = await fig
        .locator('text.recharts-cartesian-axis-tick-value', { hasText: /^[A-Z][a-z]{2} \d{1,2}$/ })
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { l: r.left, r: r.right };
          }),
        );
      expect(boxes.length).toBeGreaterThan(1);
      const frame = (await fig.boundingBox())!;
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i]!.l).toBeGreaterThanOrEqual(boxes[i - 1]!.r - 0.5);
      expect(boxes.at(-1)!.r).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
    });
  }
});
