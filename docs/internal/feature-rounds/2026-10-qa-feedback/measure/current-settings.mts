/** Current Settings tab + Access section: geometry at 1440 / 1024 / 390 and screenshots current-settings-*, current-access-*. */
import { launch, newPage, datasetUrl, save, shotsDir, WIDTHS, BOXES } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
const result: Record<string, unknown> = {};
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w);
  for (const [name, ds] of [['project', 'support-faq'], ['restricted12', 'legal-clauses'], ['restricted0', 'refund-cases'], ['restricted1', 'onboarding-checks']] as const) {
    await page.goto(datasetUrl(ds, 'settings'));
    await page.waitForSelector('[data-testid=access-section]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=access-section] [aria-busy]') && document.querySelector('[data-testid=access-mode]'));
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const col = document.querySelector('[data-dataset-settings]')!;
      const cards = [...col.children].map((c) => { const r = c.getBoundingClientRect(); return { id: c.getAttribute('aria-labelledby') || c.getAttribute('data-testid'), w: +r.width.toFixed(1), h: +r.height.toFixed(1), y: +(r.y + scrollY).toFixed(1) }; });
      const gaps = cards.slice(1).map((c, i) => +(c.y - (cards[i].y + cards[i].h)).toFixed(1));
      const panel = document.querySelector('[role=tabpanel]')!.getBoundingClientRect();
      const rect = (s: string) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
      const inputs = [...col.querySelectorAll('input, textarea')].slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); return { name: (e as HTMLInputElement).labels?.[0]?.textContent ?? e.getAttribute('aria-label'), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
      const labels = [...col.querySelectorAll('label')].slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, w: +r.width.toFixed(1), x: +(r.x - panel.x).toFixed(1) }; });
      const ths = [...document.querySelectorAll('[data-testid=access-grants-table] [role=columnheader], [data-testid=access-grants-table] th')].map((e) => ({ t: e.textContent, w: +e.getBoundingClientRect().width.toFixed(1) }));
      const row = document.querySelector('[data-testid=access-grants-table] [role=row]:nth-of-type(2), [data-testid=access-grants-table] tbody tr');
      return { panelW: +panel.width.toFixed(1), wrapW: +col.getBoundingClientRect().width.toFixed(1), emptyRight: +(panel.width - col.getBoundingClientRect().width).toFixed(1),
        docH: document.documentElement.scrollHeight, cards, gaps, inputs, labels, ths,
        rowH: row ? +row.getBoundingClientRect().height.toFixed(1) : null,
        mode: rect('[data-testid=access-mode]'), people: rect('[data-testid=access-people]'), table: rect('[data-testid=access-grants-table]'),
        add: rect('[data-testid=access-add]'), saveBar: rect('[data-testid=access-save-bar]'), tablist: rect('[role=tablist]') };
    });
    (result as Record<string, unknown>)[`${name}-${w}`] = m;
    if (name === 'project') await page.screenshot({ path: path.join(shotsDir, `current-settings-${w}.png`), fullPage: true });
    if (name === 'restricted12') await page.screenshot({ path: path.join(shotsDir, `current-access-${w}.png`), fullPage: true });
  }
  await ctx.close();
}
save('current-settings', result);
await b.close();
console.log(JSON.stringify(result, null, 1).slice(0, 9000));
