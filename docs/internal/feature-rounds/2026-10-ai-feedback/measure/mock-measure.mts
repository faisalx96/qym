/** Geometry of the gallery mocks (the numbers the spec's criteria quote). Output measure/mock-e/mock-<w>.json.  VITE_BASE=... node mock-measure.mts */
import { chromium, APP, WIDTHS, open, save } from './lib.mts';
const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width, 900);
  await page.goto(`${APP}/__ui#ai-feedback`);
  await page.waitForSelector('[data-gallery-section="ai-feedback"]');
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => {
    const r = (e: Element | null) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e as HTMLElement);
      return { x: Math.round(b.x), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, font: `${cs.fontSize}/${cs.fontWeight}`, overflowX: (e as HTMLElement).scrollWidth - (e as HTMLElement).clientWidth };
    };
    const all = (root: Element, sel: string) => Array.from(root.querySelectorAll(sel)).map((e) => ({ ...r(e)!, text: (e.textContent ?? '').trim().slice(0, 30) }));
    const cs = (id: string) => document.querySelector(`[data-case^="${id} "]`)!;
    const o: Record<string, unknown> = {};
    for (const id of ['ae-page-list', 'ae-page-new', 'ae-page-chat', 'ae-page-proposal', 'ae-page-request', 'ae-page-conversation', 'ae-page-triage', 'ae-page-admin', 'ae-page-unconfigured']) {
      const c = cs(id);
      o[id] = {
        shell: r(c.querySelector('[data-testid="page-shell"]')),
        col: r(c.querySelector('[class*="col"]')),
        header: r(c.querySelector('[data-page-header]')),
        title: r(c.querySelector('[data-page-header] h1, [data-page-header] [class*="title"]')),
        navFeedback: r(c.querySelector('[data-nav="feedback"]')),
        navItems: all(c, '[data-nav]').map((n) => n.h),
        drafts: r(c.querySelector('[data-testid="drafts-strip"]')),
        table: r(c.querySelector('[aria-label="Feedback requests"]')),
        rows: all(c, '[aria-label="Feedback requests"] tbody tr').map((n) => n.h),
        filterRow: r(c.querySelector('[data-testid="filter-row"]')),
        facets: all(c, '[data-testid="filter-row"] button').map((n) => `${n.w}x${n.h}`),
        newForm: r(c.querySelector('[data-testid="new-form"]')),
        textarea: all(c, 'textarea').map((n) => `${n.w}x${n.h}`),
        radios: all(c, '[role="radio"]'),
        chat: r(c.querySelector('[data-testid="chat"]')),
        log: r(c.querySelector('[role="log"]')),
        msgs: all(c, '[role="log"] li').map((n) => n.h),
        composer: r(c.querySelector('[class*="composer"]')),
        checklist: r(c.querySelector('[data-testid="checklist"]')),
        checkItems: all(c, '[data-check]').map((n) => n.h),
        proposal: r(c.querySelector('[data-testid="proposal"]')),
        proposalFields: all(c, '[data-testid="proposal"] input, [data-testid="proposal"] textarea, [data-testid="proposal"] button').map((n) => `${n.text}:${n.w}x${n.h}`),
        related: r(c.querySelector('[data-testid="related"]')),
        relatedItems: all(c, '[data-related]').map((n) => n.h),
        requestCard: r(c.querySelector('[data-testid="request-card"]')),
        history: r(c.querySelector('[data-testid="history"]')),
        triage: r(c.querySelector('[data-testid="triage"]')),
        triageControls: all(c, '[data-testid="triage"] button, [data-testid="triage"] textarea').map((n) => `${n.text}:${n.w}x${n.h}`),
        tabs: r(c.querySelector('[role="tablist"]')),
        transcript: r(c.querySelector('[data-testid="transcript"]')),
        connection: r(c.querySelector('[data-testid="connection"]')),
        connInputs: all(c, '[data-testid="connection"] input').map((n) => `${n.w}x${n.h}`),
        stat: r(c.querySelector('[aria-label="Feedback totals"], [aria-label="Priority and size"]')),
        empty: r(c.querySelector('[data-empty-state]')),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }
    const lo = cs('ae-s-list');
    o['loadingFrame'] = { loading: r(lo.querySelector('[data-testid="list-loading"]')), loadedTable: r(cs('ae-page-list').querySelector('[aria-label="Feedback requests"]')) };
    o['sheets'] = Object.fromEntries(['ae-s-list', 'ae-s-chat', 'ae-s-proposal', 'ae-s-request', 'ae-s-admin', 'ae-s-new-product', 'ae-s-unconfigured-admin', 'ae-s-nav'].map((id) => [id, r(cs(id))]));
    return o;
  });
  save('mock-e', `mock-${width}`, out);
  await ctx.close();
}
await browser.close();
