/**
 * Geometry of the gallery mocks (the numbers the spec's criteria quote). Output baseline/mock-<w>.json.
 *   VITE_BASE=http://127.0.0.1:5996 node mock-measure.mts
 */
import { chromium, APP, WIDTHS, open, save } from './lib.mts';
const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width, 900);
  await page.goto(`${APP}/__ui#multi-launch`);
  await page.waitForSelector('[data-gallery-section="multi-launch"]');
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => {
    const r = (e: Element | null) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e as HTMLElement);
      return { x: Math.round(b.x), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, font: `${cs.fontSize}/${cs.fontWeight}`, overflow: (e as HTMLElement).scrollWidth - (e as HTMLElement).clientWidth };
    };
    const all = (root: Element, sel: string) => Array.from(root.querySelectorAll(sel)).map((e) => ({ ...r(e)!, text: (e.textContent ?? '').trim().slice(0, 36) }));
    const o: Record<string, unknown> = {};
    const cs = (id: string) => document.querySelector(`[data-case^="${id}"]`)!;
    for (const id of ['md-page-home', 'md-page-step1', 'md-page-review', 'md-page-detail']) {
      const c = cs(id);
      o[id] = {
        shell: r(c.querySelector('[data-testid="page-shell"]')),
        header: r(c.querySelector('[data-page-header]')),
        where: r(c.querySelector('[class*="where"]')),
        cards: all(c, '[class*="where"] > div'),
        envBoxes: all(c, 'li[data-selected="true"]'),
        versionLines: all(c, '[data-env-version]'),
        taskLines: all(c, '[data-env-task]'),
        taskSelect: all(c, '[data-env-task] button'),
        shapeTags: all(c, '[data-testid="env-shape-tag"]'),
        dsFieldset: all(c, '[data-testid="datasets-fieldset"]'),
        dsBoxes: all(c, '[data-dataset-box]'),
        dsRefs: all(c, '[data-dataset-box] [class*="dsRefs"]'),
        dsTrigger: all(c, '[data-dataset-box] button'),
        refTags: all(c, '[data-dataset-box] [class*="refTags"] span[data-kind="version"]').slice(0, 4),
        runShape: all(c, '[data-testid="run-shape"]'),
        runShapeControl: all(c, '[data-testid="run-shape"] [role="radiogroup"]'),
        runShapeOptions: all(c, '[data-testid="run-shape"] [role="radio"]'),
        pairCount: all(c, '[data-testid="pair-count"]'),
        addButton: all(c, 'button').filter((b) => b.text.startsWith('Add another')).slice(0, 1),
        bar: all(c, '[role="region"][aria-label="Launch"]'),
        reviewAside: all(c, 'aside[aria-label="Review"]'),
        reviewRows: all(c, 'aside[aria-label="Review"] dl > div'),
        reviewEnvLines: all(c, '[data-testid="review-env-lines"] li'),
        detailCard: all(c, 'section[aria-label="Datasets and task"]'),
        groups: all(c, '[data-job-group]'),
        matrix: all(c, '[data-exp-matrix]'),
        jobsTable: all(c, '[aria-label="Job history"]'),
        strip: all(c, '[aria-label="Job totals"]'),
        back: all(c, 'span[class*="back"]'),
        raw: all(c, '[data-testid="raw-json"]'),
        layout: all(c, '[class*="layout"]'),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }
    for (const id of ['md-s-single', 'md-s-picker', 'md-s-shape', 'md-s-task', 'md-s-env', 'md-s-problems', 'md-s-raw']) {
      const c = cs(id);
      o[id] = {
        cards: all(c, '[class*="where"] > div'),
        envBoxes: all(c, 'li[data-selected="true"]'),
        taskLines: all(c, '[data-env-task]'),
        taskSelect: all(c, '[data-env-task] button'),
        versionLines: all(c, '[data-env-version]'),
        dsFieldset: all(c, '[data-testid="datasets-fieldset"]'),
        dsBoxes: all(c, '[data-dataset-box]'),
        shapeBlocks: all(c, '[data-testid="run-shape"]'),
        popovers: all(c, '[role="group"][aria-label^="Versions of"]'),
        shapeTags: all(c, '[data-testid="env-shape-tag"]'),
        selects: all(c, 'button[aria-haspopup="listbox"]'),
        review: all(c, 'aside[aria-label="Review"]'),
        raw: all(c, '[data-testid="raw-json"]'),
      };
    }
    return o;
  });
  save(`mock-${width}`, out);
  await ctx.close();
}
await browser.close();
console.log('ok');
