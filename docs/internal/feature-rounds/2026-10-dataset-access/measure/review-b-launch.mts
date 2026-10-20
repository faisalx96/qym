/** WP-B review: launch step 1 (B4-21..27, B5-23..42). SEED_B / SEED_B2 point at the review seed files. */
import { chromium, open, SEED, APP, WIDTHS, out, save, box, boxL, overflow, shot, exp } from './review-lib.mts';
const b = await chromium.launch();
const go = async (page: any, q = '') => {
  await page.goto(`${APP}/projects/${SEED.slug}/experiments/new?step=where${q}`);
  await page.getByRole('textbox', { name: 'Experiment name' }).waitFor();
  await page.waitForTimeout(700);
};
const pickEnv = async (page: any, names: string[]) => {
  for (const n of names) await page.getByRole('checkbox', { name: new RegExp(`^${n}`) }).check({ force: true });
  await page.waitForTimeout(900);
};
const card = (page: any) => page.locator('[aria-label="Name and priority"]');
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  // ---- admin: flag off / on
  {
    const { ctx, page } = await open(b, w);
    await go(page);
    const cb = page.getByRole('checkbox', { name: 'Latency-sensitive run' });
    R.checkboxExists = await cb.count();
    R.unchecked = !(await cb.isChecked());
    R.labelRow = await boxL(page.locator('[data-testid="launch-latency"] label').first());
    R.helper = await boxL(page.locator('#launch-latency-help'));
    R.cardOff = await boxL(card(page));
    R.nameInput = await boxL(page.getByRole('textbox', { name: 'Experiment name' }));
    R.priority = await boxL(page.getByRole('button', { name: /Priority/ }));
    R.order = await page.evaluate(() => {
      const els = [...document.querySelectorAll('input,textarea,button')].filter((e) => (e as HTMLElement).offsetParent);
      const names = els.map((e) => (e.getAttribute('aria-label') || (e as any).labels?.[0]?.textContent || e.textContent || '').trim().slice(0, 30));
      return names.slice(0, 12);
    });
    R.describedby = await cb.getAttribute('aria-describedby');
    await cb.check({ force: true });
    await page.waitForTimeout(400);
    R.callout = await boxL(card(page).locator('[role="note"]'));
    R.calloutText = (await card(page).locator('[role="note"]').innerText());
    R.cardOn = await boxL(card(page));
    R.overflowOn = await overflow(page);
    await shot(page, `review-launch-latency-on-${w}`, '[aria-label="Name and priority"]');
    await cb.uncheck({ force: true });
    await page.waitForTimeout(300);
    R.cardOffAgain = await boxL(card(page));
    // dataset picker
    await pickEnv(page, ['staging']);
    const dsBtn = page.getByRole('button', { name: /(golden|secret-set|Choose a dataset).* Dataset$/ }).first();
    R.dsTrigger = await boxL(dsBtn);
    R.dsCardBefore = await boxL(page.locator('section,div').filter({ has: dsBtn }).last());
    await dsBtn.click();
    R.options = await page.getByRole('option').evaluateAll((os: any[]) => os.map((o) => ({ text: o.innerText, h: Math.round(o.getBoundingClientRect().height * 10) / 10 })));
    R.optionChips = await page.getByRole('option').locator('[data-testid="dataset-chip"]').evaluateAll((os: any[]) => os.map((o) => { const r = o.getBoundingClientRect(); const cs = getComputedStyle(o); return { t: o.textContent, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, font: cs.fontSize + '/' + cs.fontWeight, fam: cs.fontFamily.slice(0, 20) }; }));
    R.disabledOptions = await page.getByRole('option', { disabled: true }).count();
    await page.getByRole('option', { name: /secret-set/ }).click();
    await page.waitForTimeout(500);
    R.dsTrigger2 = await boxL(dsBtn);
    R.dsTriggerScroll = await dsBtn.evaluate((e: HTMLElement) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    R.triggerChip = await boxL(dsBtn.locator('[data-testid="dataset-chip"]'));
    R.help = await boxL(page.locator('[data-testid="dataset-token-help"]'));
    R.helpIcons = await page.locator('[data-testid="dataset-token-help"] svg').count();
    R.helpText = await page.locator('[data-testid="dataset-token-help"]').innerText();
    await shot(page, `review-dataset-private-${w}`, '[data-testid="dataset-token-help"] >> xpath=ancestor::div[contains(@class,"stack")][1]');
    await dsBtn.click();
    await page.getByRole('option', { name: /golden/ }).click();
    await page.waitForTimeout(400);
    R.helpAfterPlain = await page.locator('[data-testid="dataset-token-help"]').count();
    R.chipAfterPlain = await dsBtn.locator('[data-testid="dataset-chip"]').count();
    await ctx.close();
  }
  // ---- alice (member): staging member-level, production manager-only
  {
    const { ctx, page } = await open(b, w, 'alice@x.test');
    await go(page);
    const cb = page.getByRole('checkbox', { name: 'Latency-sensitive run' });
    R.aliceNoEnvEnabled = !(await cb.isDisabled());
    await pickEnv(page, ['production']);
    R.aliceProdDisabled = await cb.isDisabled();
    R.reason = await boxL(page.locator('[data-testid="launch-latency-reason"]'));
    R.reasonColor = R.reason.color;
    R.cardDisabled = await boxL(card(page));
    R.helperStill = await page.locator('#launch-latency-help').count();
    R.describedbyDisabled = await cb.getAttribute('aria-describedby');
    await shot(page, `review-launch-disabled-${w}`, '[aria-label="Name and priority"]');
    await pickEnv(page, ['staging']);
    R.alicePartialEnabled = !(await cb.isDisabled());
    R.reasonGoneWhenPartial = await page.locator('[data-testid="launch-latency-reason"]').count();
    await cb.check({ force: true });
    await page.waitForTimeout(600);
    R.partialCallout = await boxL(card(page).locator('[role="note"]'));
    R.partialText = await card(page).locator('[role="note"]').innerText();
    R.cardPartial = await boxL(card(page));
    await shot(page, `review-launch-partial-${w}`, '[aria-label="Name and priority"]');
    // review pane blocking item
    const pane = page.locator('aside, [aria-label="Review"], [data-testid="review-pane"]').first();
    R.paneText = (await page.locator('main').innerText()).includes('Latency-sensitive runs on production need a project manager');
    R.launchDisabled = await page.getByRole('button', { name: 'Launch' }).first().isDisabled();
    const prob = page.getByRole('button', { name: /Latency-sensitive/ }).filter({ hasText: 'need a project manager' });
    R.problemItem = (await prob.count()) ? await boxL(prob) : null;
    if (await prob.count()) { await prob.first().click(); await page.waitForTimeout(300); R.focusAfterClick = await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('aria-label') || (document.activeElement as HTMLElement)?.parentElement?.textContent?.slice(0, 40)); }
    await cb.uncheck({ force: true });
    await page.waitForTimeout(500);
    R.problemGoneAfterClear = !(await page.locator('main').innerText()).includes('need a project manager');
    await ctx.close();
  }
}
save('launch');
await b.close();
