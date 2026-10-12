/** J5 / §8.6: row actions for an ADMIN: submit, review decisions, transfer, delete. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { APP } from '../helpers';
import { addMember, createUser } from '../shell/support';
import { dataRows, failOnNativeDialogs, freshProject, openRuns, rowOf, statusText } from './support';

const NAME = 'text2sql-gpt-4o-000'; // COMPLETED
const kpis = async (request: APIRequestContext, slug: string) =>
  (
    (await (
      await request.post('/api/dashboard/kpis', { data: { project_slug: slug, filters: {} } })
    ).json()) as { kpis: Record<string, number> }
  ).kpis;

async function openMore(page: Page, name: string, how: 'mouse' | 'keyboard' = 'mouse') {
  const trigger = rowOf(page, name).getByRole('button', { name: `More actions for ${name}` });
  if (how === 'mouse') await trigger.click();
  else {
    await trigger.focus();
    await page.keyboard.press('Enter');
  }
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function submitRow(page: Page, name: string) {
  await rowOf(page, name)
    .getByRole('button', { name: `Submit ${name} for review` })
    .click();
  const dlg = page.getByRole('dialog', { name: `Submit ${name} for review` });
  await dlg.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(dlg).toHaveCount(0);
}

test.describe('runs list: row actions (J5)', () => {
  test('Submit on a COMPLETED row flips it to SUBMITTED at once and toasts', async ({ page, request }) => {
    const s = await freshProject(request, 12);
    await openRuns(page, s.project.slug);
    expect(await statusText(rowOf(page, NAME))).toMatch(/completed/i);
    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/submit'),
    );
    await submitRow(page, NAME);
    await post;
    await expect(page.getByRole('status').filter({ hasText: 'Submitted for review' })).toBeVisible();
    await expect.poll(async () => statusText(rowOf(page, NAME)), { timeout: 5000 }).toMatch(/submitted/i);
    // a SUBMITTED row has no Submit icon any more
    await expect(rowOf(page, NAME).getByRole('button', { name: /^Submit / })).toHaveCount(0);
  });

  test('Approve, Unapprove, Reject (comment required), Unreject through the More menu; Overview Approved gains the run; error KPI is stable', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    const before = await kpis(request, s.project.slug);
    await openRuns(page, s.project.slug);
    await submitRow(page, NAME);
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/submitted/i);

    // keyboard: open the menu with Enter, ArrowDown to move, Enter to pick
    let menu = await openMore(page, NAME, 'keyboard');
    await expect(menu.getByRole('menuitem')).toHaveText(['Approve', 'Reject', 'Transfer ownership…']);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Reject' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: 'Approve' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(rowOf(page, NAME).getByRole('button', { name: `More actions for ${NAME}` })).toBeFocused();

    // Approve
    menu = await openMore(page, NAME);
    await menu.getByRole('menuitem', { name: 'Approve' }).click();
    let dlg = page.getByRole('dialog', { name: `Approve run: ${NAME}` });
    await dlg.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${NAME} approved` })).toBeVisible();
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/approved/i);
    expect((await kpis(request, s.project.slug)).runs_with_errors).toBe(before.runs_with_errors);

    // the Overview Approved list shows it
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    const approved = page.getByRole('region', { name: 'Approved runs' });
    await expect(approved.getByRole('link', { name: NAME })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Project KPIs')).toBeVisible();
    await page.goBack();
    await expect(dataRows(page).first()).toBeVisible();

    // Unapprove -> SUBMITTED
    menu = await openMore(page, NAME);
    await expect(menu.getByRole('menuitem').first()).toHaveText('Unapprove');
    await menu.getByRole('menuitem', { name: 'Unapprove' }).click();
    await page
      .getByRole('dialog', { name: `Withdraw approval: ${NAME}` })
      .getByRole('button', { name: 'Unapprove' })
      .click();
    // the platform returns a withdrawn run to its execution result
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/completed/i);
    await submitRow(page, NAME);
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/submitted/i);

    // Reject needs a comment
    menu = await openMore(page, NAME);
    await menu.getByRole('menuitem', { name: 'Reject' }).click();
    dlg = page.getByRole('dialog', { name: `Reject run: ${NAME}` });
    await dlg.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(dlg).toBeVisible(); // not accepted without a comment
    expect(await statusText(rowOf(page, NAME))).toMatch(/submitted/i);
    await dlg.getByLabel('Comment').fill('needs more items');
    await dlg.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/rejected/i);

    // Unreject -> SUBMITTED
    menu = await openMore(page, NAME);
    await menu.getByRole('menuitem', { name: 'Unreject' }).click();
    await page
      .getByRole('dialog', { name: `Withdraw rejection: ${NAME}` })
      .getByRole('button', { name: 'Unreject' })
      .click();
    await expect.poll(async () => statusText(rowOf(page, NAME))).toMatch(/completed/i);
    expect((await kpis(request, s.project.slug)).runs_with_errors).toBe(before.runs_with_errors);
  });

  test('the withdraw dialogs describe what really happens (the run returns to its execution result)', async ({
    page,
    request,
  }) => {
    const s = await freshProject(request, 12);
    await openRuns(page, s.project.slug);
    const menu = await openMore(page, 'text2sql-claude-sonnet-4-006'); // APPROVED
    await menu.getByRole('menuitem', { name: 'Unapprove' }).click();
    const dlg = page.getByRole('dialog', { name: /Withdraw approval/ });
    await expect(dlg).toBeVisible();
    expect(await dlg.innerText()).not.toMatch(/returns to Submitted/i);
  });

  test('Transfer ownership lists the other project members and moves the run', async ({ page, request }) => {
    const s = await freshProject(request, 4);
    const email = `owner-${Date.now().toString(36)}@example.com`;
    const user = await createUser(request, email, 'Second Owner');
    await addMember(request, s.project.id, user.id, 'MEMBER');
    await openRuns(page, s.project.slug);
    const menu = await openMore(page, NAME);
    await menu.getByRole('menuitem', { name: 'Transfer ownership…' }).click();
    const dlg = page.getByRole('dialog', { name: `Transfer ${NAME}` });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: /New owner/ }).click();
    const option = page.getByRole('option', { name: new RegExp(email) });
    await expect(option).toBeVisible();
    await option.click();
    await dlg.getByRole('button', { name: 'Transfer', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ownership transferred' })).toBeVisible();
    await expect(rowOf(page, NAME).locator('td[data-col="owner"]')).toContainText('Second Owner', {
      timeout: 15_000,
    });
  });

  test('Delete on a single row confirms (Cancel focused) and removes the row', async ({ page, request }) => {
    const s = await freshProject(request, 4);
    const dialogs = failOnNativeDialogs(page);
    await openRuns(page, s.project.slug);
    const before = await dataRows(page).count();
    await rowOf(page, NAME)
      .getByRole('button', { name: `Delete ${NAME}` })
      .click();
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: `Delete ${NAME}?` }));
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rowOf(page, NAME)).toHaveCount(0);
    await expect(dataRows(page)).toHaveCount(before - 1);
    expect(dialogs.seen()).toEqual([]);
    // the deleted run disappears from the project KPIs too
    await page.goto(`${APP}/projects/${s.project.slug}/overview`);
    await expect(page.getByLabel('Project KPIs')).toContainText(String(before - 1));
  });

  test('a RUNNING row has no Delete or Submit action', async ({ page, request }) => {
    const s = await freshProject(request, 2);
    await openRuns(page, s.project.slug);
    const live = rowOf(page, 'live');
    await expect(live.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(live.getByRole('button', { name: /^Submit / })).toHaveCount(0);
  });
});
