/** Perf round 6 (A7, A8, A13): the first scroll tick and freezing a column from the Columns menu. */
import { test, expect } from '@playwright/test';
import { seedProjectWithRuns } from '../runs-list/seed';
import { openRuns } from '../runs-list/support';
import { waitForProjection } from '../runs-list/seed';
import { COMMIT_HOOK, commits, frames, limit } from './support';

test.use({ viewport: { width: 1440, height: 900 } });

test('first horizontal tick renders nothing; freezing a column is a few commits and no long frame', async ({
  page,
  request,
}) => {
  const s = await seedProjectWithRuns(request, { count: 30 });
  await waitForProjection(request, s.project.slug, s.runs.length);
  await page.addInitScript(COMMIT_HOOK);
  await page.addInitScript(
    `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-quality':'start'},order:null,density:null,collapsed:[]}));`,
  );
  await openRuns(page, s.project.slug);
  await page.waitForTimeout(1200); // the entrance timers of the first marks are over
  const scroller = page.getByTestId('runs-table').locator('[data-dt-scroller]');
  await expect.poll(() => scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(200);

  // A7: the scrolled state is a data attribute, not React state
  const box = (await page.locator('[data-testid="runs-table"] tbody').boundingBox())!;
  await page.mouse.move(box.x + 500, box.y + 40);
  const c0 = await commits(page);
  const tick = await frames(page, async () => {
    await page.mouse.wheel(80, 0);
    await expect(scroller).toHaveAttribute('data-scrolled-x', '');
    await page.waitForTimeout(200);
  });
  expect((await commits(page)) - c0).toBe(0);
  expect(tick.worst).toBeLessThanOrEqual(limit(100, 35));

  // A8: freeze and unfreeze
  await page.getByRole('button', { name: /^Columns/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Columns' });
  const freeze = dialog.getByRole('button', { name: 'Freeze accuracy' });
  for (const step of ['freeze', 'unfreeze']) {
    const before = await commits(page);
    const f = await frames(page, async () => {
      await freeze.click();
      await page.waitForTimeout(500);
    });
    // the menu's own press state commits too: the table itself does one
    expect((await commits(page)) - before, step).toBeLessThanOrEqual(limit(4, 3));
    expect(f.worst, step).toBeLessThanOrEqual(limit(400, 120));
  }

  // A13: under prefers-reduced-motion the shadow appears without a transition
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(async () =>
      page
        .getByTestId('runs-table')
        .locator('[data-edge="start"]')
        .evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration)),
    )
    .toBeLessThanOrEqual(0.001);
});
