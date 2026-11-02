/** Current-state screenshots + measurements of the dataset pages WP-A changes (1440, 1024, 390; dark).
 *  node shots-current.mts   (needs the platform seeded with seed-a.mts and Vite on QYM_A_VITE) */
import { launch, newPage, save, shotsDir, VITE, SLUG, WIDTHS, BOX } from './lib-a.mts';
import path from 'node:path';

const browser = await launch();
const out: Record<string, unknown> = {};
const P = (p: string) => `${VITE}/projects/${SLUG}/datasets${p}`;

for (const w of WIDTHS) {
  const { ctx, page } = await newPage(browser, w);
  const shot = (name: string) => page.screenshot({ path: path.join(shotsDir, `current-${name}-${w}.png`) });
  const box = (sel: string) => page.evaluate(`(${BOX})(${JSON.stringify(sel)})`);
  const settle = async (sel: string) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.waitForTimeout(500); };
  const m: Record<string, unknown> = {};

  // catalog
  await page.goto(P(''));
  await settle('[data-dataset-card]');
  m.catalogGrid = await box('ul[aria-label="Datasets"]');
  m.catalogCard = await box('[data-dataset-card]');
  m.catalogCardTitle = await box('[data-dataset-card] [class*=cardTitle]');
  m.catalogBadge = await box('[data-dataset-card="pricing-golden"] span[data-tone]');
  await shot('catalog');

  // items tab, draft v2
  await page.goto(P('/support-faq?tab=items&v=v2'));
  await settle('[data-items-tab] [data-row-key]');
  m.itemsTab = await box('[data-items-tab]');
  m.toolbar = await box('[data-items-tab] [class*=toolbar]');
  m.search = await box('[data-testid=items-search]');
  m.heroActions = await box('[class*=heroActions]');
  m.versionPill = await box('[data-testid=version-switcher]');
  m.pageMeta = await box('[class*=meta]');
  m.firstRow = await page.evaluate(`(() => { const r = document.querySelector('[data-items-tab] [data-row-key]'); if(!r) return null; const b = r.getBoundingClientRect(); return { h: +b.height.toFixed(1), cells: [...r.children].map(c => +c.getBoundingClientRect().width.toFixed(1)) }; })()`);
  m.headerCells = await page.evaluate(`[...document.querySelectorAll('[data-items-tab] thead th')].map(c => c.textContent.trim().slice(0,14) + ':' + Math.round(c.getBoundingClientRect().width))`);
  await shot('items-draft');

  // selection bar: select two rows through the checkboxes
  const boxes = page.locator('[data-items-tab] [data-row-key] input[type=checkbox], [data-items-tab] [data-row-key] [role=checkbox]');
  if (await boxes.count()) {
    await boxes.nth(0).click({ force: true }).catch(() => undefined);
    await boxes.nth(1).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(400);
    m.selectionBar = await page.evaluate(`(() => { const b = document.querySelector('[data-items-tab] [class*=selection], [data-items-tab] [class*=bulk]'); if(!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: b.textContent.trim().slice(0,120) }; })()`);
    await shot('items-selection');
  }

  // pane
  await page.goto(P('/support-faq?tab=items&v=v2'));
  await settle('[data-items-tab] [data-row-key]');
  await page.locator('[data-items-tab] [data-row-key]').nth(2).click({ position: { x: 150, y: 10 } }).catch(() => undefined);
  await page.waitForTimeout(700);
  m.pane = await box('[data-item-pane]');
  m.paneHead = await box('[data-item-pane] header');
  m.paneFoot = await box('[data-item-pane] footer');
  m.tableWithPane = await box('[data-items-tab]');
  await shot('item-pane');

  // item page (draft)
  await page.goto(P('/support-faq?v=v2&item=faq-003'));
  await settle('[data-item-page]');
  m.itemHeader = await box('[data-item-page] header, [data-item-page] [class*=header]');
  m.itemActions = await box('[class*=actions]');
  await shot('item-page-draft');
  await page.goto(P('/support-faq?v=v1&item=faq-003'));
  await settle('[data-item-page]');
  await shot('item-page-published');

  // settings
  await page.goto(P('/support-faq?tab=settings&v=v2'));
  await settle('[data-dataset-settings]');
  m.settingsWrap = await box('[data-dataset-settings]');
  m.settingsCards = await page.evaluate(`[...document.querySelectorAll('[data-dataset-settings] > section')].map(s => ({ title: s.querySelector('h2,h3')?.textContent, y: Math.round(s.getBoundingClientRect().y + scrollY), h: Math.round(s.getBoundingClientRect().height), w: Math.round(s.getBoundingClientRect().width) }))`);
  await page.screenshot({ path: path.join(shotsDir, `current-settings-${w}.png`), fullPage: true });

  // compare
  await page.goto(`${VITE}/projects/${SLUG}/datasets/support-faq/compare?base=v1&head=v2`);
  await page.waitForTimeout(1500);
  await shot('compare');

  // published items tab
  await page.goto(P('/support-faq?tab=items&v=v1'));
  await settle('[data-items-tab] [data-row-key]');
  m.publishedToolbar = await box('[data-items-tab] [class*=toolbar]');
  await shot('items-published');

  out[String(w)] = m;
  await ctx.close();
}
save('current', out);
await browser.close();
