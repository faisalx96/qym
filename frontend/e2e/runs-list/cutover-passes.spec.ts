/**
 * Pass deletion (cutover of test_dashboard_pass_deletion_browser.py): the confirmed delete carries the
 * pass version the reader saw, a delete made elsewhere in between is refused (409) and nothing is removed,
 * the survivors keep their scores after renumbering and the dialogs say what is and is not reversible.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import { clickBox, freshProject, openRuns, rowOf, deletePassFromMenu } from './support';

const NAME = 'summarize-repeat-done';

async function seedRepeat(page: Page, request: APIRequestContext, samples = 3) {
  const s = await freshProject(request, 3, { running: false });
  const run = await seedRun(request, s.token, {
    name: NAME,
    task: 'summarize',
    dataset: 'cnn-sample',
    model: 'openai/gpt-4o',
    metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
    // distinct per-pass scores identify the survivors after renumbering
    items: Array.from({ length: 6 }, (_, j) => ({ accuracy: j % 2, quality: 0.5 + j / 20, latency_s: 0.5 })),
    samples,
    status: 'COMPLETED',
  });
  await openRuns(page, s.project.slug);
  await rowOf(page, NAME)
    .getByRole('button', { name: `Expand ${samples} passes of ${NAME}` })
    .click();
  const panel = page.getByRole('region', { name: `Passes of ${NAME}` });
  await expect(panel.locator('tbody tr[data-pass-row]')).toHaveCount(samples);
  return { s, run, panel };
}

const passRows = (panel: ReturnType<Page['getByRole']>) => panel.locator('tbody tr[data-pass-row]');

// A stale confirm (passes renumbered elsewhere since the panel was read) is refused by the server.
test('a delete confirmed after the passes were renumbered elsewhere is refused and removes nothing', async ({
  page,
  request,
}) => {
  const { run, panel } = await seedRepeat(page, request, 4);
  await deletePassFromMenu(panel, page, 2);
  const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete pass 2?' }));
  await expect(dlg).toBeVisible();
  // Someone deletes pass 1 meanwhile: the old "pass 2" is now called pass 1.
  const elsewhere = await request.delete(`/api/runs/${run.id}/passes/1`);
  expect(elsewhere.ok(), await elsewhere.text()).toBeTruthy();
  const sent = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/passes\/2/.test(r.url()));
  await dlg.getByRole('button', { name: 'Delete pass' }).click();
  const response = await sent;
  expect(response.status()).toBe(409);
  const after = (await (await request.get(`/api/runs/${run.id}`)).json()) as { run: { samples: number } };
  expect(after.run.samples).toBe(3);
});

test('deleting pass 2 keeps the other passes (renumbered) with their scores', async ({ page, request }) => {
  const { run, panel } = await seedRepeat(page, request);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const before = await passRows(panel).allInnerTexts();
  const done = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/passes\/2/.test(r.url()));
  await deletePassFromMenu(panel, page, 2);
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: 'Delete pass 2?' }))
    .getByRole('button', { name: 'Delete pass' })
    .click();
  const response = await done;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Pass 2 deleted' })).toBeVisible();
  await expect(passRows(panel)).toHaveCount(2, { timeout: 15_000 });
  const after = await passRows(panel).allInnerTexts();
  const cells = (text: string) => text.split(/\s+/).filter(Boolean).slice(1).join(' ');
  expect(cells(after[0]!)).toBe(cells(before[0]!));
  expect(cells(after[1]!)).toBe(cells(before[2]!));
  const final = (await (await request.get(`/api/runs/${run.id}`)).json()) as { run: { samples: number } };
  expect(final.run.samples).toBe(2);
});

// The client sends the pass revision it read (expected_pass_version), so a second delete on the same run succeeds.
test('a second pass delete on the same run still works', async ({ page, request }) => {
  const { run, panel } = await seedRepeat(page, request, 4);
  for (const n of [2, 2]) {
    const done = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/passes\//.test(r.url()));
    await deletePassFromMenu(panel, page, n);
    await page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog', { name: `Delete pass ${n}?` }))
      .getByRole('button', { name: 'Delete pass' })
      .click();
    expect((await done).status()).toBe(200);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Pass ${n} deleted` })
        .last(),
    ).toBeVisible();
    await page.waitForTimeout(500);
  }
  const final = (await (await request.get(`/api/runs/${run.id}`)).json()) as { run: { samples: number } };
  expect(final.run.samples).toBe(2);
});

// Picks of a run's passes are dropped when one of its passes is deleted (they are renumbered).
test("deleting a pass clears the picks of that run's passes", async ({ page, request }) => {
  const { panel } = await seedRepeat(page, request);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await clickBox(panel.getByRole('checkbox', { name: new RegExp(`^Select pass 3 of ${NAME}$`) }));
  await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
  await deletePassFromMenu(panel, page, 2);
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: 'Delete pass 2?' }))
    .getByRole('button', { name: 'Delete pass' })
    .click();
  await expect(passRows(panel)).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.getByTestId('selection-bar')).toContainText('0 executions selected');
});

test('the delete dialogs say a run can be restored and a pass cannot', async ({ page, request }) => {
  const { panel } = await seedRepeat(page, request);
  await deletePassFromMenu(panel, page, 2);
  const passDialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete pass 2?' }));
  await expect(passDialog).toBeVisible();
  await expect(passDialog).toContainText(/permanent|cannot be restored/i);
  await passDialog.getByRole('button', { name: 'Cancel' }).click();
  const other = (await rowOf(page, 'text2sql-gpt-4o-000').count()) ? 'text2sql-gpt-4o-000' : null;
  expect(other).toBeTruthy();
  await rowOf(page, other!)
    .getByRole('button', { name: `Delete ${other}` })
    .click();
  const runDialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: `Delete ${other}?` }));
  await expect(runDialog).toContainText(/restore/i);
  await expect(runDialog).not.toContainText('cannot be undone');
});
