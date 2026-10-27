/**
 * Implementation stage: the after-shots of round 8 (`after-<component>-<width>.png`), taken from the React app.
 * Run from frontend/ with Node 24 while the platform (8982) and Vite (5982) run on the seed of frontend/scripts/seed-compare.ts
 * plus `seed-extra.mts` (four more runs). Env: IDS (json file with {runs:{base,a,b,c,e1..e4}}), BASE (default http://127.0.0.1:5982), OUT.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const req = createRequire(path.resolve('package.json'));
const { chromium } = req('playwright-core');
const ids = JSON.parse(readFileSync(process.env.IDS!, 'utf8')).runs as Record<string, string>;
const BASE = process.env.BASE ?? 'http://127.0.0.1:5982';
const OUT = process.env.OUT!;
const four = ['base', 'a', 'b', 'c'];
const eight = [...four, 'e1', 'e2', 'e3', 'e4'];
const url = (names: string[], extra = '') => `${BASE}/compare?${names.map((n) => `runs=${ids[n]}`).join('&')}${extra}`;
const cohort = `${BASE}/compare?cohortA=${ids.b}&cohortA=${ids.base}&cohortB=${ids.a}&cohortB=${ids.c}&cohortALabel=Weak&cohortBLabel=Strong`;

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
async function page(width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.addInitScript('window.__name = (f) => f;');
  return p;
}
async function load(p: any, u: string) {
  await p.goto(u);
  await p.waitForSelector('[data-testid=item-list], [data-testid=sweep-view]', { timeout: 20000 });
  await p.waitForTimeout(700);
}
async function crop(p: any, sel: string, name: string) {
  const el = p.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: path.join(OUT, name) });
}
const parts = [
  ['title-block', 'title'],
  ['section-runs', 'runs'],
  ['section-averages', 'averages'],
  ['section-overview', 'overview'],
  ['section-categories', 'categories'],
  ['section-errors', 'errors'],
  ['section-items', 'items'],
] as const;
for (const w of [1440, 1024, 390]) {
  const p = await page(w, 6000);
  await load(p, url(four));
  await p.screenshot({ path: path.join(OUT, `after-page-compare-${w}.png`) });
  for (const [sel, name] of parts) await crop(p, `[data-part=${sel}]`, `after-${name}-${w}.png`);
  await p.close();
}
{
  const p = await page(1440, 6200);
  await load(p, url(eight));
  await p.screenshot({ path: path.join(OUT, 'after-page-compare-8runs-1440.png') });
  await p.close();
}
{
  const p = await page(1440, 5200);
  await load(p, url(four, '&item=cmp-001'));
  await p.screenshot({ path: path.join(OUT, 'after-page-compare-expanded-1440.png') });
  const d = p.locator('[data-testid=item-detail]').first();
  await d.getByRole('button', { name: 'Show quality details' }).first().click();
  await d.screenshot({ path: path.join(OUT, 'after-expanded-details-1440.png') });
  await p.close();
}
{
  const p = await page(1440, 6200);
  await load(p, url(four));
  await p.locator('[data-part=items-facets-btn]').click();
  await p.waitForTimeout(500);
  await crop(p, '[data-part=section-items]', 'after-items-sidebar-open-1440.png');
  await p.close();
}
{
  const p = await page(1440, 3000);
  await load(p, `${cohort}&tab=sweep`);
  await p.screenshot({ path: path.join(OUT, 'after-page-sweep-1440.png') });
  await p.close();
}
await browser.close();
