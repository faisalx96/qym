/** Composed page mocks: shots/mock-c-<case>-<1440|1024|390>.png, cropped to the shell, plus measurements out/mock-c.json. */
import { launch, newPage, save, shotsDir, VITE } from './lib-c.mts';
import path from 'node:path';
const b = await launch();
const out: Record<string, any> = {};
for (const [w, vw] of [[1440, 1800], [1024, 1100], [390, 480]] as const) {
  const { ctx, page } = await newPage(b, vw, 1000);
  await page.goto(`${VITE}/__ui#multi-sdk`);
  await page.waitForSelector('[data-case^="multi-"]');
  await page.waitForTimeout(1500);
  const cases: string[] = await page.evaluate(`[...document.querySelectorAll('[data-case^="multi-"]')].map(e => e.getAttribute('data-case').split(' ')[0])`);
  for (const id of cases) {
    const el = page.locator(`[data-case^="${id} "] [data-testid=page-shell]`).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await el.boundingBox();
    const m = await page.evaluate((cid: string) => {
      const root = document.querySelector(`[data-case^="${cid} "]`)!;
      const q = (sel: string) => { const e = root.querySelector(sel) as HTMLElement | null; if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
      const qa = (sel: string) => [...root.querySelectorAll(sel)].map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
      const content = root.querySelector('[class*=content]') as HTMLElement | null;
      return {
        content: content ? Math.round((content.getBoundingClientRect().width - parseFloat(getComputedStyle(content).paddingLeft) - parseFloat(getComputedStyle(content).paddingRight)) * 10) / 10 : null,
        hero: q('[data-testid=run-hero]'), strip: q('[data-testid=run-hero-strip]'), ctx: q('[data-testid=hero-context]'), chips: qa('[data-testid=hero-dataset-chip]'),
        fact: q('[data-testid=hero-datasets-fact]'), more: q('[data-testid=hero-more]'), nav: q('[data-testid=section-nav]'),
        breakdown: q('[aria-label="Scores per dataset"]'), section: q('#datasets'), filter: q('[data-testid=dataset-filter]'),
        runsTable: q('[aria-label="Runs"]'), countTags: qa('[data-testid=dataset-count-tag]'), cmp: qa('[data-testid=compare-run-card]'), notice: q('[data-testid=compare-datasets-notice]'),
        scrollOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        rows: qa('[aria-label="Scores per dataset"] [role=row]'),
      };
    }, id);
    out[`${id}@${w}`] = { shell: box && [box.width, box.height], ...m };
    await el.screenshot({ path: path.join(shotsDir, `mock-c-${id.replace('multi-', '')}-${w}.png`) });
  }
  await ctx.close();
}
save('mock-c', out);
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
await b.close();
