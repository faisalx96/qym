/** Baseline: today's run page (hero), runs list and compare, shots current-*.png and measurements out/current-c.json. */
import path from 'node:path';
import { box, launch, newPage, save, seed, shotsDir, VITE } from './lib-c.mts';
const s = seed();
const b = await launch();
const out: Record<string, unknown> = {};
const ids = s.runs;
for (const w of [1440, 1024, 390]) {
  const { ctx, page } = await newPage(b, w, 1000);
  const m: Record<string, unknown> = {};
  await page.goto(`${VITE}/projects/${s.slug}/runs/${ids['ticket-triage-nightly']}`);
  await page.waitForSelector('[data-testid=run-hero]');
  await page.waitForTimeout(2500);
  m.hero = await box(page, '[data-testid=run-hero]');
  m.heroFacts = await box(page, '[data-testid=run-hero-strip]');
  m.heroContext = await box(page, '[data-testid=hero-context]');
  m.factBoxes = await page.evaluate(`[...document.querySelectorAll('[data-testid=run-hero-strip] > div')].map(e => { const r = e.getBoundingClientRect(); return [e.querySelector('dt').textContent, Math.round(r.x), Math.round(r.width*10)/10, Math.round(r.height*10)/10]; })`);
  m.sections = await page.evaluate(`[...document.querySelectorAll('[id^=run-section-],#run-items')].map(e => [e.id, Math.round(e.getBoundingClientRect().y + scrollY), Math.round(e.getBoundingClientRect().height)])`);
  m.metricCards = await page.evaluate(`[...document.querySelectorAll('[data-testid=metric-strip] > *, [data-testid=metric-card]')].slice(0,6).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width*10)/10, Math.round(r.height*10)/10]; })`);
  await page.screenshot({ path: path.join(shotsDir, `current-run-${w}.png`) });
  await page.goto(`${VITE}/projects/${s.slug}/runs/${ids['ticket-triage-nightly']}#run-items`);
  await page.waitForTimeout(1200);
  m.itemsHeaders = await page.evaluate(`[...document.querySelectorAll('#run-items [role=columnheader]')].map(e => e.textContent)`);
  // runs list
  await page.goto(`${VITE}/projects/${s.slug}`);
  await page.waitForSelector('table, [role=grid], [role=table]', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  m.listHeaders = await page.evaluate(`[...document.querySelectorAll('[role=columnheader], th')].map(e => [e.textContent, Math.round(e.getBoundingClientRect().width)])`);
  m.listRow = await page.evaluate(`(() => { const r = document.querySelector('[role=row]:nth-child(2), tbody tr'); if (!r) return null; const b = r.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height*10)/10]; })()`);
  await page.screenshot({ path: path.join(shotsDir, `current-runs-${w}.png`) });
  // compare
  await page.goto(`${VITE}/projects/${s.slug}/compare?runs=${ids['ticket-triage-nightly']}&runs=${ids['ticket-triage-baseline']}`);
  await page.waitForSelector('[data-testid=run-details]', { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  m.compareCards = await box(page, '[data-testid=run-details]');
  await page.screenshot({ path: path.join(shotsDir, `current-compare-${w}.png`) });
  out[w] = m;
  await ctx.close();
}
save('current-c', out);
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await b.close();
