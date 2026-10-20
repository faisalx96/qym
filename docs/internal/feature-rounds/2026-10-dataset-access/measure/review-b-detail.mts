/** WP-B review: experiment detail (B4-28..38, B5-49..58). */
import { chromium, open, SEED, APP, WIDTHS, out, save, boxL, overflow, shot, exp } from './review-lib.mts';
const ids: Record<string, string> = {};
const list = await (await fetch(`${APP}/v1/projects/${SEED.project_id}/experiments`, { headers: { 'X-User-Email': 'dev@local' } })).json();
for (const e of list.experiments) ids[e.name] = e.id;
out.ids = ids;
const b = await chromium.launch();
const cases: [string, string][] = [
  ['active', 'staging vs prod'], ['revoked', 'baseline run'], ['notissued', 'urgent check'], ['notsent', 'gate'],
  ['warning', 'blocked tok'], ['latency', 'lat sweep'], ['latone', 'lat one'],
];
for (const w of WIDTHS) {
  const R: Record<string, any> = (out[`w${w}`] = {});
  const { ctx, page } = await open(b, w);
  for (const [key, name] of cases) {
    // 'gate' has two experiments with the same name; the list keeps the last: fine for the 'not sent' case only when it is the production one
    await page.goto(exp(SEED.slug, `/${ids[name]}`));
    await page.getByRole('region', { name: 'Credentials' }).waitFor();
    await page.waitForTimeout(700);
    const C: Record<string, any> = (R[key] = {});
    C.name = name;
    C.section = await boxL(page.getByRole('region', { name: 'Credentials' }));
    C.dts = await page.getByRole('region', { name: 'Credentials' }).locator('dt').allInnerTexts();
    C.badges = await page.getByRole('region', { name: 'Credentials' }).locator('dd').evaluateAll((els: any[]) => els.map((e) => { const b = e.firstElementChild ?? e; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { t: b.textContent, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, bg: cs.backgroundColor, color: cs.color, title: b.getAttribute('title'), font: cs.fontSize + '/' + cs.fontWeight }; }));
    C.pairGap = await page.getByRole('region', { name: 'Credentials' }).evaluate((s: HTMLElement) => { const items = [...s.querySelectorAll('dl > div')]; const cs = getComputedStyle(s.querySelector('dl')!); const i0 = getComputedStyle(items[0]); return { colGap: cs.columnGap, gap: cs.gap, itemGap: i0.columnGap, align: i0.alignItems, n: items.length, secAlign: getComputedStyle(s).alignItems }; });
    C.noticeText = await page.getByTestId('token-notice').count() ? await page.getByTestId('token-notice').innerText() : null;
    C.notice = (await page.getByTestId('token-notice').count()) ? await boxL(page.getByTestId('token-notice').locator('xpath=ancestor::*[@role="note"][1]')) : null;
    C.noticeRole = (await page.getByTestId('token-notice').count()) ? await page.getByTestId('token-notice').locator('xpath=ancestor::*[@role="note"][1]').count() : 0;
    C.noticeCount = await page.getByRole('note').filter({ hasText: /Dataset read token/ }).count();
    C.header = await boxL(page.locator('main header, [data-testid=page-header]').first());
    C.tag = (await page.getByTestId('latency-tag').count()) ? await boxL(page.getByTestId('latency-tag')) : null;
    C.overflow = await overflow(page);
    // everything above the first card: PageHeader + credentials + notice
    C.titleBlock = await page.evaluate(() => { const h1 = document.querySelector('h1') as HTMLElement | null; const hdr = h1?.closest('header') ?? h1?.parentElement; const r = hdr?.getBoundingClientRect(); return r ? { h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, y: Math.round(r.y) } : null; });
    if (['active', 'warning', 'notsent', 'revoked', 'latency'].includes(key)) await shot(page, `review-detail-${key}-${w}`);
  }
  await ctx.close();
}
save('detail');
await b.close();
