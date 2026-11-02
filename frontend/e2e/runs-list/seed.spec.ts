/** The seeding helper reaches the dashboard projection (prerequisite for every runs-list spec). */
import { test, expect } from '@playwright/test';
import { seedProjectWithRuns, waitForProjection } from './seed';

test('seeded runs reach /api/dashboard/runs with mixed statuses', async ({ request }) => {
  const { project, runs } = await seedProjectWithRuns(request, { count: 12 });
  await waitForProjection(request, project.slug, runs.length);
  const res = await request.post('/api/dashboard/runs', {
    data: { project_slug: project.slug, filters: {}, limit: 50, offset: 0, include_overview: true },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    rows: { status: string; samples: number }[];
    overview: { facets: { statuses: string[] } };
  };
  expect(body.rows.length).toBe(13);
  expect(body.rows.some((r) => r.status === 'RUNNING')).toBeTruthy();
  expect(body.rows.some((r) => r.samples === 3)).toBeTruthy();
  expect(body.overview.facets.statuses).toEqual(
    expect.arrayContaining(['COMPLETED', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STOPPED']),
  );
});
