// Review stage: what m_* and r_bar / r_versions lack. Axe with the five-key payload (1440, 390); the review's Summary rows,
// first screen at 1440x1000, cards at 390, duplicate names, the scroll threshold and one environment (dry-run answers
// rewritten with page.route); the bar's computed style and the page's growth (C-4-1); the step change (C-4-5); Back / Cancel
// targets (C-1-5); the Tab order (C-1-7).
// Usage: R10_BASE=http://127.0.0.1:8972 R10_FAKE_PORTS=9072,9073 node r_misc.cjs
const path = require('path');
const { chromium, ids, base, PROJ } = require('./pw.cjs');
const [STAGING, PRODUCTION] = (process.env.R10_FAKE_PORTS ?? '9098,9099').split(',').map((p) => `http://127.0.0.1:${p}`);
const AXE = path.resolve(__dirname, '../../../../../frontend/node_modules/axe-core/axe.min.js');
const OUT = process.env.R10_REVIEW_OUT;
const setV = (fake, body) => fetch(`${fake}/__control/versioning`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const f1 = (v) => Math.round(v * 10) / 10;
const log = (o) => console.log(JSON.stringify(o));
async function axe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}:${v.nodes.length}`);
  });
}
const table = () => {
  const t = document.querySelector('[data-part=runs-table]');
  const rows = Array.from(t.querySelectorAll('thead tr'));
  const head = rows[rows.length - 1];
  const sc = Array.from(t.querySelectorAll('*')).find((e) => /auto|scroll/.test(getComputedStyle(e).overflowX)) ?? t;
  const clipped = Array.from(t.querySelectorAll('[data-part=axis-header], [data-part=axis-cell]')).filter((e) => e.scrollWidth > e.clientWidth + 0.5 || getComputedStyle(e).textOverflow === 'ellipsis').length;
  return { headers: Array.from(head.querySelectorAll('th')).map((h) => `${h.innerText.replace(/\s+/g, ' ').trim()}:${Math.round(h.getBoundingClientRect().width * 10) / 10}`),
    band: rows.length > 1 ? Array.from(rows[0].querySelectorAll('th')).map((h) => `${h.innerText.trim()}:${Math.round(h.getBoundingClientRect().width * 10) / 10}`) : [],
    sections: Array.from(t.querySelectorAll('[data-part=axis-section]')).map((s) => `${s.innerText} ${getComputedStyle(s).fontSize}/${getComputedStyle(s).fontWeight} ${getComputedStyle(s).color}`),
    headStyle: Array.from(t.querySelectorAll('[data-part=axis-header]')).slice(0, 1).map((s) => `${getComputedStyle(s).textTransform} ls=${getComputedStyle(s).letterSpacing}`),
    scroll: `${sc.scrollWidth}/${sc.clientWidth}`, clipped };
};
async function fakeAxes(page, pointers, envs) {
  await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
    const body = route.request().postDataJSON();
    if (!body?.dry_run) return route.continue();
    const res = await route.fetch();
    const json = await res.json();
    const unique = Array.from(new Map((json.jobs ?? []).map((j) => [j.environment_id, j.environment_name])).entries()).slice(0, envs);
    const jobs = [];
    for (const step of [0, 1]) for (const [id, name] of unique) jobs.push({ ...(json.jobs?.[0] ?? {}), environment_id: id, environment_name: name, combo_index: step, label: '', params: { sweep: Object.fromEntries(pointers.map((p, i) => [p, step ? 1000 + i : 10 + i])) } });
    return route.fulfill({ json: { ...json, ok: true, errors: [], axes: [{ pointers, linked: true, length: 2, values: [pointers.map((_, i) => 10 + i), pointers.map((_, i) => 1000 + i)] }], jobs, job_count: jobs.length } });
  });
}
(async () => {
  const browser = await chromium.launch();
  const ctxOf = async (w, h) => (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage();
  let page = await ctxOf(1440, 1000);
  await page.goto(`${base}${PROJ}/experiments`);
  const { envs, twoAxis } = await ids(page);
  // axe with the five-key payload
  await setV(PRODUCTION, { agent_version: 'agent-1.5.0', kb_version: 'kb-81', prompt_set: 'prompts-2026-11-01', model_routing: { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' }, build: 4127 });
  for (const w of [1440, 390]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
    await page.waitForSelector('[data-env-version][data-status=ok]');
    await page.waitForTimeout(500);
    log({ check: 'C-3-11 axe home five keys', w, serious: await axe(page) });
  }
  // the review of the two-axis clone with production {agent_version, kb_version}, staging 3 keys
  await setV(PRODUCTION, { agent_version: 'agent-1.5.0', kb_version: 'kb-81' });
  await setV(STAGING, { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=review`);
  await page.waitForSelector('[data-part=runs-table] [data-run]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  log({ check: 'review 1440x1000', ...(await page.evaluate(() => {
    const f = (v) => Math.round(v * 10) / 10;
    const rows = Array.from(document.querySelectorAll('[data-part=review-kv] [data-row]')).map((r) => `${r.getAttribute('data-row')}:${f(r.getBoundingClientRect().height)}`);
    const bar = document.querySelector('[data-part=launch-bar]').getBoundingClientRect();
    const sum = document.querySelector('[data-part=review-summary]').getBoundingClientRect();
    const head = document.querySelector('[data-part=runs-table] thead').getBoundingClientRect();
    const r2 = document.querySelector('[data-part=runs-table] [data-run="2"]').getBoundingClientRect();
    const vrow = document.querySelector('[data-row=versions]');
    return { rows, summaryBottom: f(sum.bottom), runsHeadBottom: f(head.bottom), run2Bottom: f(r2.bottom), barTop: f(bar.top),
      versionsEnvs: Array.from(vrow.querySelectorAll('[data-part=review-versions-env]')).map((e) => `${e.getAttribute('data-env')}: ${Array.from(e.querySelectorAll('[data-part=version-key]')).map((k) => k.innerText).join(',')}`),
      cellsAt10px: Array.from(document.querySelectorAll('[data-part=axis-cell]')).filter((c) => getComputedStyle(c).fontSize === '10px').length,
      tagsInCells: document.querySelectorAll('[data-part=axis-cell] [class*=tag], [data-part=axis-cell] [class*=Tag]').length,
      axisCellOverflow: Array.from(document.querySelectorAll('[data-part=axis-cell]')).filter((c) => c.scrollWidth > c.clientWidth + 0.5).length,
      axisCells: document.querySelectorAll('[data-part=axis-cell]').length,
      disclosures: document.querySelectorAll('[data-part=runs-table] details, [data-part=runs-table] [aria-expanded]').length,
      selects: document.querySelectorAll('[data-part=runs-table] tbody button[aria-haspopup], [data-part=runs-table] tbody select').length };
  })), table: await page.evaluate(table) });
  log({ check: 'C-3-11 axe review 1440', serious: await axe(page) });
  // 390 cards
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  log({ check: 'C-2-10 cards 390', ...(await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-part=runs-cards] [data-run]'));
    const c = cards[0];
    return { cards: cards.length, heights: [...new Set(cards.map((k) => Math.round(k.getBoundingClientRect().height * 10) / 10))], dts: Array.from(c.querySelectorAll('dt')).map((d) => d.innerText), dtW: Math.round(c.querySelector('dt').getBoundingClientRect().width * 10) / 10,
      cells: Array.from(c.querySelectorAll('[data-part=axis-cell]')).map((d) => d.innerText), pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      sweptRow: Math.round(document.querySelector('[data-row=swept]').getBoundingClientRect().height * 10) / 10 };
  })) });
  log({ check: 'C-3-11 axe review 390', serious: await axe(page) });
  // duplicate names, thresholds, one environment
  await page.setViewportSize({ width: 1440, height: 900 });
  const TIMEOUT = '/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout';
  await fakeAxes(page, [TIMEOUT, '/env_overrides/LLM_OVERRIDES/endpoints/judge/timeout'], 2);
  await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=review`);
  await page.waitForFunction(() => document.querySelectorAll('[data-part=runs-table] [data-part=axis-header]').length === 2, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  log({ check: 'C-2-2 duplicate names', ...(await page.evaluate(table)) });
  if (OUT) await page.locator('[data-part=runs-table]').screenshot({ path: `${OUT}/runs-duplicate-names-1440.png` });
  await page.unroute(/\/v1\/projects\/[^/]+\/experiments$/);
  for (const [w, n, e] of [[1440, 6, 2], [1440, 7, 2], [1440, 7, 1], [1440, 1, 1], [1024, 3, 2], [1024, 4, 2], [1024, 4, 1]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await fakeAxes(page, Array.from({ length: n }, (_, i) => `/env_overrides/R10_SETTING_${i + 1}`), e);
    await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=review`);
    await page.waitForFunction((n) => document.querySelectorAll('[data-part=runs-table] [data-part=axis-header]').length === n, n, { timeout: 30000 });
    await page.waitForTimeout(800);
    const t = await page.evaluate(table);
    const flexMin = Math.min(...t.headers.slice(1, -1).map((h) => Number(h.split(':').pop())));
    log({ check: 'C-2-6/C-2-7', w, swept: n, envs: e, scroll: t.scroll, minFlex: flexMin, clipped: t.clipped, headers: t.headers.map((h) => h.replace(/R10_SETTING_/, 'S')) });
    await page.unroute(/\/v1\/projects\/[^/]+\/experiments$/);
  }
  // C-4-1 computed style and growth
  await page.setViewportSize({ width: 1440, height: 1400 });
  for (const url of [`${PROJ}/experiments/new?env=${envs.production}`, `${PROJ}/experiments/new?env=${envs.production}&step=start`]) {
    await page.goto(base + url);
    await page.waitForSelector('[data-part=launch-bar]');
    await page.waitForTimeout(1500);
    log({ check: 'C-4-1', url: url.split('?')[1], ...(await page.evaluate(() => {
      const bar = document.querySelector('[data-part=launch-bar]');
      const cs = getComputedStyle(bar);
      const grow = Array.from(document.querySelectorAll('main *')).filter((e) => /_(page|layout|main|home)_/.test(e.className?.toString?.() ?? '') && e.contains(bar)).map((e) => `${e.className.toString().match(/_(page|layout|main|home)_/)[1]}: min-h=${getComputedStyle(e).minHeight} grow=${getComputedStyle(e).flexGrow} h=${Math.round(e.getBoundingClientRect().height)}`);
      return { marginTop: cs.marginTop, marginBottom: cs.marginBottom, position: cs.position, bottom: cs.bottom, ancestors: grow };
    })) });
  }
  // C-4-5 step change where -> start at 1440x1400, sampled every 100 ms
  await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}&step=where`);
  await page.waitForSelector('[data-part=launch-bar]');
  await page.waitForTimeout(2000);
  const xs = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-part=launch-bar] [data-part]')).map((e) => `${e.dataset.part}@${Math.round(e.getBoundingClientRect().x)}`).join(' '));
  const before = await xs();
  await page.locator('[data-part=bar-continue]').click();
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 16; i++) {
    samples.push(`${Date.now() - t0}ms:${await page.evaluate(() => Math.round(document.querySelector('[data-part=launch-bar]').getBoundingClientRect().top * 10) / 10)}`);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const bar = document.querySelector('[data-part=launch-bar]');
    let prev = bar.previousElementSibling; while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
    return { barTop: Math.round(bar.getBoundingClientRect().top * 10) / 10, contentBottom: Math.round(prev.getBoundingClientRect().bottom * 10) / 10, h2: document.activeElement?.tagName + ' ' + document.activeElement?.innerText?.slice(0, 30) };
  });
  log({ check: 'C-4-5', samples, after, xsBefore: before, xsAfter: await xs() });
  // C-1-5 targets, launch and editor
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, url, btn] of [
    ['launch where Back', `${PROJ}/experiments/new?env=${envs.production}&step=where`, 'bar-back'],
    ['launch settings Cancel', `${PROJ}/experiments/new?env=${envs.production}&step=settings`, 'bar-cancel'],
    ['editor where Back', `${PROJ}/environments/${envs.staging}/default-preset/edit?step=where`, 'bar-back'],
    ['editor models Cancel', `${PROJ}/environments/${envs.staging}/default-preset/edit?step=models`, 'bar-cancel'],
    ['launch models Skip', `${PROJ}/experiments/new?env=${envs.production}&step=models`, 'bar-skip'],
  ]) {
    await page.goto(base + url);
    await page.waitForSelector('[data-part=launch-bar]');
    await page.waitForTimeout(1500);
    await page.locator(`[data-part=${btn}]`).click();
    await page.waitForTimeout(1500);
    log({ check: 'C-1-5', name, url: page.url().replace(base, ''), home: await page.locator('[data-testid=launch-home]').count(), h2: await page.evaluate(() => Array.from(document.querySelectorAll('h1,h2')).map((h) => h.innerText).slice(0, 3).join(' | ')) });
  }
  // C-1-7 Tab order on models (production only: the Name problem link) and on the review
  await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}&step=models`);
  await page.waitForSelector('[data-part=bar-status] button', { timeout: 15000 });
  await page.locator('[data-part=bar-skip]').focus();
  const who = () => page.evaluate(() => { const e = document.activeElement; return e?.getAttribute('data-part') ?? ((e?.closest('[data-part]')?.getAttribute('data-part') ?? '?') + ':' + (e?.innerText ?? '').slice(0, 20)); });
  const order = [await who()];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); order.push(await who()); }
  log({ check: 'C-1-7 models', order });
  await page.locator('[data-part=bar-continue]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  log({ check: 'C-1-7 Enter', focused: await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.innerText}`) });
  await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=review`);
  await page.waitForSelector('[data-part=runs-table] [data-run]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-part=bar-cancel]').focus();
  const rev = [await who()];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); rev.push(await who()); }
  await page.locator('[data-part=bar-cancel]').focus();
  await page.keyboard.press('Shift+Tab');
  rev.push('shift-tab from cancel -> ' + (await who()));
  log({ check: 'C-1-7 review', order: rev });
  await browser.close();
})();
