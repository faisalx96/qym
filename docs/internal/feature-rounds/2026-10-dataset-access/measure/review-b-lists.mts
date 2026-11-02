/** WP-B review: experiments list (B5-59..62), queue (B5-63..66), environment form (B5-43..46), token table (B4-39..46). */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL, overflow, shot, exp } from './review-lib.mts';
const b = await chromium.launch();
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  // ---- list
  await page.goto(exp(SEED.slug));
  await page.getByRole('group', { name: 'Filter experiments' }).waitFor();
  await page.waitForTimeout(800);
  const grp = page.getByRole('group', { name: 'Filter experiments' });
  R.filterGroup = await boxL(grp);
  R.filterBox = await boxL(page.getByRole('checkbox', { name: 'Latency-sensitive only' }).locator('xpath=ancestor::label[1]'));
  R.filterOrder = await grp.getByRole('checkbox').evaluateAll((els: any[]) => els.map((e) => e.closest('label')?.textContent?.trim()));
  R.tagsOff = await page.getByTestId('latency-tag').evaluateAll((els: any[]) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, fam: getComputedStyle(e).fontFamily.slice(0, 12) }; }));
  R.rowsAll = await page.getByRole('row').evaluateAll((els: any[]) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
  R.footerAll = (await page.getByText(/\d+ experiments?$/).allInnerTexts()).slice(0, 2);
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await page.waitForTimeout(1200);
  R.url = page.url().split('?')[1] ?? '';
  R.rowsOn = await page.getByRole('row').evaluateAll((els: any[]) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
  R.names = await page.getByRole('row').evaluateAll((els: any[]) => els.map((e) => e.textContent.slice(0, 40)));
  R.footerOn = (await page.getByText(/\d+ experiments?$/).allInnerTexts()).slice(0, 2);
  R.overflowList = await overflow(page);
  await shot(page, `review-list-latency-${w}`);
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await page.waitForTimeout(500);
  R.urlOff = page.url().split('?')[1] ?? '';
  // ---- queue
  await page.goto(exp(SEED.slug, '/queue'));
  await page.waitForTimeout(1500);
  R.queueFilter = await boxL(page.getByRole('checkbox', { name: 'Latency-sensitive only' }).locator('xpath=ancestor::label[1]'));
  R.queueFilterOrder = await page.getByRole('group', { name: /Queue filters/ }).getByRole('checkbox').evaluateAll((els: any[]) => els.map((e) => e.closest('label')?.textContent?.trim()));
  R.note = await page.getByTestId('queue-latency-note').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent, h: Math.round(e.getBoundingClientRect().height * 10) / 10, role: e.getAttribute('role'), font: getComputedStyle(e).fontSize, bc: getComputedStyle(e).borderTopColor })));
  R.highNote = await page.getByText(/HIGH job is active|high-priority/i).count();
  R.queueTags = await page.getByTestId('latency-tag').evaluateAll((els: any[]) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }));
  R.queueRows = await page.getByRole('row').evaluateAll((els: any[]) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
  R.queueJobCells = await page.getByRole('row').evaluateAll((els: any[]) => els.slice(1, 5).map((e) => e.textContent.slice(0, 70)));
  R.queueOverflow = await overflow(page);
  await shot(page, `review-queue-${w}`);
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await page.waitForTimeout(1500);
  R.queueUrl = page.url().split('?')[1] ?? '';
  R.queueMeta = (await page.locator('main').innerText()).match(/\d+ jobs?/g);
  // ---- environment form
  await page.goto(`${APP}/projects/${SEED.slug}/environments/${SEED.envs.staging}`);
  const sel = page.getByRole('button', { name: /Who can launch latency-sensitive runs/ });
  await sel.waitFor();
  await page.waitForTimeout(800);
  R.sel = await boxL(sel);
  R.selDisabled = await page.getByRole('button', { name: /Who can launch latency-sensitive runs/ }).isDisabled();
  R.section = await boxL(page.locator('[data-section="env-policies"]'));
  R.selects = await page.locator('[data-section="env-policies"] button[aria-haspopup]').evaluateAll((els: any[]) => els.map((e) => ({ t: e.textContent.trim().slice(0, 30), w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10, dis: e.disabled })));
  R.help = await boxL(page.getByText('Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.'));
  await sel.click();
  R.options = await page.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  await shot(page, `review-env-form-${w}`, '[data-section="env-policies"]');
  R.envOverflow = await overflow(page);
  // ---- tokens table
  await page.goto(`${APP}/projects/${SEED.slug}/settings?tab=apikeys`);
  const card = page.locator('[data-read-tokens]');
  await card.waitFor();
  await page.waitForTimeout(900);
  R.tokCard = await boxL(card);
  R.tokDesc = await card.innerText().then((t: string) => t.split('\n').slice(0, 3));
  R.tokRows = await card.getByRole('row').evaluateAll((els: any[]) => els.map((e) => ({ h: Math.round(e.getBoundingClientRect().height * 10) / 10, t: e.textContent.slice(0, 80) })));
  R.kindChips = await card.getByTestId('token-kind-chip').evaluateAll((els: any[]) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }));
  R.links = await card.getByTestId('token-experiment-link').evaluateAll((els: any[]) => els.slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, href: e.getAttribute('href'), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: getComputedStyle(e).fontSize + '/' + getComputedStyle(e).fontWeight }; }));
  R.tokCount = (await card.getByRole('row').count());
  R.tokOverflow = await overflow(page);
  R.secretVisible = (await page.locator('body').innerText()).match(/qym_dr_[A-Za-z0-9_-]{20,}/g)?.length ?? 0;
  await shot(page, `review-tokens-${w}`, '[data-read-tokens]');
  await ctx.close();
}
// ---- member sees no token card; role select disabled for a member
{
  const { ctx, page } = await open(b, 1440, 'alice@x.test');
  await page.goto(`${APP}/projects/${SEED.slug}/settings?tab=apikeys`);
  await page.waitForTimeout(1500);
  out.memberTokenCard = await page.locator('[data-read-tokens]').count();
  await page.goto(`${APP}/projects/${SEED.slug}/environments/${SEED.envs.staging}`);
  await page.waitForTimeout(1500);
  out.memberSelectDisabled = await page.getByRole('button', { name: /Who can launch latency-sensitive runs/ }).isDisabled().catch((e: any) => 'err ' + e.message.slice(0, 60));
  out.memberSelects = await page.locator('[data-section="env-policies"] button[aria-haspopup]').evaluateAll((els: any[]) => els.map((e) => e.disabled));
  await ctx.close();
}
save('lists');
await b.close();
