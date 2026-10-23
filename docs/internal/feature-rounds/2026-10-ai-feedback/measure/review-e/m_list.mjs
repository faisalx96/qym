import { open, ready, rect, overflow, BASE } from './lib.mjs';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname + u.search); });
  await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(800); await ready(page);
  const o = { w };
  o.nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.nav, +r.width.toFixed(1), +r.height.toFixed(1)]; }));
  o.page = await rect(page, '[data-testid=feedback-list-page]');
  o.title = await page.evaluate(() => { const h = document.querySelector('[data-testid=feedback-list-page] h1'); if (!h) return null; const c = getComputedStyle(h); const r = h.getBoundingClientRect(); return [c.fontSize, c.fontWeight, r.height]; });
  o.header = await page.evaluate(() => { const h = document.querySelector('[data-testid=feedback-list-page] header, [data-testid=feedback-list-page] [class*=PageHeader], [data-testid=feedback-list-page] h1')?.closest('header') ?? document.querySelector('[data-testid=feedback-list-page] h1').parentElement.parentElement; const r = h.getBoundingClientRect(); return [h.tagName, +r.width.toFixed(1), +r.height.toFixed(1)]; });
  o.strip = await rect(page, '[data-testid=drafts-strip]');
  o.table = await rect(page, '[aria-label="Feedback requests"]');
  o.frame = await rect(page, '[data-testid=feedback-table-frame]');
  o.rows = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Feedback requests"] [role=row]')].map(r => [r.getAttribute('aria-level'), +r.getBoundingClientRect().height.toFixed(1)]));
  o.cols = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Feedback requests"] [role=columnheader]')].map(c => [c.textContent.trim(), +c.getBoundingClientRect().width.toFixed(1), c.scrollWidth <= c.clientWidth]));
  o.filterRow = await rect(page, '[data-testid=filter-row]');
  o.filtersTrigger = await rect(page, '[data-testid=filters-trigger]');
  o.exportMenu = await rect(page, '[data-testid=export-menu]');
  o.pageOverflow = await overflow(page);
  o.tableOverflow = await page.evaluate(() => { const t = document.querySelector('[aria-label="Feedback requests"]'); const s = t?.closest('[data-testid=feedback-table-frame]') ?? t; return [t?.scrollWidth, t?.clientWidth, s?.scrollWidth, s?.clientWidth]; });
  o.titleEllipsis = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Feedback requests"] [role=gridcell] a, [aria-label="Feedback requests"] [role=row] [class*=title]')].slice(0, 20).map(e => [getComputedStyle(e).textOverflow, e.scrollWidth <= e.clientWidth + 1]).filter(x => x[0] === 'ellipsis' || !x[1]).length);
  o.calls = calls;
  o.doctitle = await page.title();
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/review-e/dl/list-${w}.png`, fullPage: true });
  await browser.close();
}
