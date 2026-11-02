/** WP-B review: revoke confirm texts (B4-42, B4-41, B4-43). */
import { chromium, open, SEED, APP, out, save, shot } from './review-lib.mts';
const b = await chromium.launch();
const { ctx, page } = await open(b, 1440);
await page.goto(`${APP}/projects/${SEED.slug}/settings?tab=apikeys`);
const card = page.locator('[data-read-tokens]');
await card.waitFor(); await page.waitForTimeout(800);
const row = card.getByRole('row').filter({ hasText: 'Evaluation Service · private run' });
out.revokeBtn = await row.getByRole('button', { name: /Revoke Evaluation Service · private run/ }).count();
out.adminRevokeBtn = await card.getByRole('row').filter({ hasText: 'admin svc token' }).getByRole('button', { name: /Revoke admin svc token/ }).count();
out.revokedRowActions = await card.getByRole('row').filter({ hasText: 'Evaluation Service · baseline run' }).getByRole('button').count();
out.statuses = await card.getByRole('row').evaluateAll((els: any[]) => els.slice(1).map((e) => e.textContent.slice(-20)));
await row.getByRole('button', { name: /Revoke Evaluation Service · private run/ }).click();
const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
await dlg.waitFor();
out.dialog = await dlg.innerText();
out.focus = await page.evaluate(() => (document.activeElement as HTMLElement)?.textContent);
await shot(page, 'review-revoke-confirm-1440');
await dlg.getByRole('button', { name: 'Cancel' }).click();
// admin token confirm text
await card.getByRole('row').filter({ hasText: 'admin svc token' }).getByRole('button', { name: /Revoke admin svc token/ }).click();
out.adminDialog = await page.getByRole('alertdialog').or(page.getByRole('dialog')).last().innerText();
await page.getByRole('alertdialog').or(page.getByRole('dialog')).last().getByRole('button', { name: 'Cancel' }).click();
out.createForm = await page.getByRole('button', { name: /Create token/ }).count();
save('revoke');
await b.close();
