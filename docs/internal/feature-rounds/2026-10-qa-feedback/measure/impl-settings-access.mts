/** Implemented Settings and Access tabs: boxes at 1440 / 1024 / 390 (numbers of QA5-1..QA5-61) + after-qa-* shots.
 *  QYM_A_VITE=http://127.0.0.1:5983 node impl-settings-access.mts */
import { launch, newPage, datasetUrl, save, shotsDir, WIDTHS, boxes } from './lib-qa.mts';
import path from 'node:path';
const b = await launch();
const out: Record<string, unknown> = {};
const SETTINGS = ['[data-testid=settings-layout]', '[data-testid=settings-general]', '[data-testid=settings-visibility]', '[data-testid=settings-danger]', '[data-testid=settings-general] [data-testid=card-head]', '[data-testid=settings-general] h2', '[data-testid=settings-general] input', '[data-testid=settings-general] textarea'];
const ACCESS = ['[data-testid=access-tab]', '[data-testid=access-mode-card]', '[data-testid=access-mode]', '[data-testid=access-always]', '[data-testid=access-people]', '[data-testid=access-add]', '[data-testid=access-grants-table]', '[data-testid=access-save-bar]', '[data-testid=access-empty-note]', '[data-testid=access-mode-card] [data-testid=card-head]', '[data-testid=access-mode-card] h2', '[data-testid=access-summary]'];
for (const w of WIDTHS) {
  const m: Record<string, unknown> = {};
  const s = await newPage(b, w, 1200);
  await s.page.goto(datasetUrl('support-faq', 'settings'));
  await s.page.waitForSelector('[data-testid=settings-layout]');
  await s.page.waitForTimeout(500);
  m.settings = await boxes(s.page, SETTINGS);
  m.settingsTexts = await s.page.evaluate(() => [...document.querySelectorAll('[data-testid=settings-visibility] p, [data-testid=settings-danger] p')].map((p) => { const e = p as HTMLElement; return { h: +e.getBoundingClientRect().height.toFixed(1), over: e.scrollWidth > e.clientWidth, ellipsis: getComputedStyle(e).textOverflow }; }));
  m.settingsOverflow = await s.page.evaluate(() => { const e = document.querySelector('[data-testid=settings-layout]') as HTMLElement; return [e.scrollWidth, e.clientWidth, document.documentElement.scrollWidth, innerWidth]; });
  await s.page.screenshot({ path: path.join(shotsDir, `after-qa-settings-${w}.png`) });
  await s.ctx.close();
  for (const [name, ds] of [['project', 'support-faq'], ['twelve', 'legal-clauses'], ['one', 'onboarding-checks'], ['none', 'refund-cases']] as const) {
    const a = await newPage(b, w, 1300);
    const reqs: string[] = [];
    a.page.on('request', (r) => { if (/\/access\?/.test(r.url())) reqs.push(r.method()); });
    await a.page.goto(datasetUrl(ds, 'access'));
    await a.page.waitForSelector('[data-testid=access-save-bar]');
    await a.page.waitForTimeout(500);
    const r: Record<string, unknown> = { boxes: await boxes(a.page, ACCESS), requests: reqs };
    r.rows = await a.page.evaluate(() => [...document.querySelectorAll('[data-testid=access-grants-table] [role=row]')].slice(0, 3).map((e) => +e.getBoundingClientRect().height.toFixed(1)));
    r.overflow = await a.page.evaluate(() => { const e = document.querySelector('[data-testid=access-tab]') as HTMLElement; return [e.scrollWidth, e.clientWidth]; });
    r.tab = await a.page.evaluate(() => { const t = document.querySelector('[role=tab][id$=access]') as HTMLElement | null; return t && { text: t.textContent, w: +t.getBoundingClientRect().width.toFixed(1), h: +t.getBoundingClientRect().height.toFixed(1) }; });
    await a.page.screenshot({ path: path.join(shotsDir, `after-qa-access-${name}-${w}.png`) });
    m[`access-${name}`] = r;
    await a.ctx.close();
  }
  out[String(w)] = m;
}
save('impl-settings-access', out);
console.log('saved');
await b.close();
