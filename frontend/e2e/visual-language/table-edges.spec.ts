/**
 * Redesign round 7, D3-8 (docs/internal/ui-migration/redesign7/qa.md): every table that pins a column draws its boundary
 * with its own cells. The sweep visits the pages that own a DataTable (runs, run detail, compare, experiments, datasets,
 * environments, settings, admin, profile, trash) at 1440 and 1024 and, for every table on the page, at rest and
 * scrolled to the end sideways: no overlay element or fade, every pinned-edge cell draws the --border-strong line, and no
 * glyph has anything but its own cell stacked on it. The route, the tables found and the pinned ones are recorded as
 * annotations of the test, so the report names them.
 */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl } from '../compare/support';
import { coveredText, edgeReport, LINE_END, LINE_START } from '../edges';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { seedTrash } from '../trash/support';
import { seedProjectWithRuns, waitForProjection } from '../runs-list/seed';
import { createLaunchAreas, seedTour, settled, type AreasWorld, type Tour } from './support';

let tour: Tour;
let areas: AreasWorld;
let runsSlug = '';
const trashPrefix = `r7edges${Date.now().toString(36)}`;
test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  tour = await seedTour();
  areas = await createLaunchAreas(request);
  await seedTrash(request, trashPrefix, 3);
  const seeded = await seedProjectWithRuns(request, { count: 14, running: false });
  await waitForProjection(request, seeded.project.slug, seeded.runs.length);
  runsSlug = seeded.project.slug;
});

const routes = (): Array<[string, string]> => [
  ['runs list', `/projects/${runsSlug}`],
  ['charts', `/projects/${runsSlug}/charts`],
  ['run detail (classic)', runUrl(tour.slug, tour.runId)],
  ['run detail (repeat: passes)', runUrl(tour.slug, tour.repeatId)],
  ['compare', compareUrl(tour.compareIds)],
  ['experiments', `/projects/${areas.slug}/experiments`],
  ['experiment queue', `/projects/${areas.slug}/experiments/queue`],
  ['experiment detail', `/projects/${areas.slug}/experiments/${areas.experimentId}`],
  ['environments', `/projects/${areas.slug}/environments`],
  ['datasets', `/projects/${areas.slug}/datasets`],
  ['dataset', `/projects/${areas.slug}/datasets/${areas.datasetSlug}`],
  ['settings: members', `/projects/${areas.slug}/settings?tab=members`],
  ['settings: API keys', `/projects/${areas.slug}/settings?tab=apikeys`],
  ['settings: LLM connections', `/projects/${areas.slug}/settings?tab=llm`],
  ['settings: environments', `/projects/${areas.slug}/settings?tab=environments`],
  ['admin runs', '/admin/runs'],
  ['admin projects', '/admin/projects'],
  ['admin users', '/admin/users'],
  ['admin maintenance', '/admin/maintenance'],
  ['profile', '/profile'],
  ['trash', `/trash?q=${trashPrefix}`],
];

async function sweepPage(
  page: Page,
  name: string,
  width: number,
): Promise<{ tables: number; pinned: number }> {
  const cards = page.locator('[data-testid=data-table]');
  const n = await cards.count();
  let pinned = 0;
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    if (!(await card.isVisible())) continue;
    await card.evaluate((el) => el.setAttribute('data-r7-probe', ''));
    try {
      const sel = '[data-r7-probe]';
      for (const state of ['rest', 'scrolled to the end'] as const) {
        if (state !== 'rest') {
          const moved = await card.evaluate((el) => {
            const sc = el.querySelector<HTMLElement>('[data-dt-scroller]');
            if (!sc || sc.scrollWidth <= sc.clientWidth + 2) return false;
            sc.scrollLeft = sc.scrollWidth;
            return true;
          });
          if (!moved) continue;
          await page.waitForTimeout(120);
        }
        const where = `${name} @${width} table ${i} ${state}`;
        const rep = await edgeReport(page, sel);
        expect(rep.overlays, `${where}: overlay elements`).toBe(0);
        for (const c of rep.cells) {
          const want = c.edge === 'start' ? LINE_START : LINE_END;
          expect(c.shadow, `${where}: ${c.tag} ${c.edge}`).toContain(want);
        }
        expect(await coveredText(page, sel), `${where}: covered text`).toEqual([]);
        if (state === 'rest' && rep.cells.length) pinned++;
      }
    } finally {
      await card.evaluate((el) => el.removeAttribute('data-r7-probe')).catch(() => undefined);
    }
  }
  return { tables: n, pinned };
}

for (const width of [1440, 1024] as const) {
  test(`D3-8 at ${width}: every table that pins a column draws its own line and covers no text`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: 900 });
    let pinnedTotal = 0;
    for (const [name, url] of routes()) {
      await gotoApp(page, url);
      await page
        .locator('[data-testid=data-table]')
        .first()
        .waitFor({ timeout: 8_000 })
        .catch(() => undefined);
      await settled(page).catch(() => undefined);
      const r = await sweepPage(page, name, width);
      pinnedTotal += r.pinned;
      console.log(`table-edges ${width}: ${name}: ${r.tables} tables, ${r.pinned} with a pinned boundary`);
      test.info().annotations.push({
        type: `table-edges ${width}`,
        description: `${name}: ${r.tables} tables, ${r.pinned} with a pinned boundary`,
      });
    }
    expect(pinnedTotal, 'the sweep found tables that pin a column').toBeGreaterThan(3);
  });
}
