// K3: the environment box's Versions line and the review's Versions row for what the service reports
// (3 keys = the fake's default, 2 keys, 5 keys incl. an object, none), plus the loading frame.
// Today (current): drives the production fake (:9099) through /__control/versioning. Mock: /__mock/round10/sheet-versions.
// Usage: node m_versions.cjs [current|mock]
const { open, ids, base, PROJ, SHOTS } = require('./pw.cjs');
const mode = process.argv[2] ?? 'current';
const FAKE = process.env.R10_FAKE ?? 'http://127.0.0.1:9099';
const STATES = {
  three: { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' },
  two: { agent_version: 'agent-1.5.0', kb_version: 'kb-81' },
  five: {
    agent_version: 'agent-1.5.0',
    kb_version: 'kb-81',
    prompt_set: 'prompts-2026-11-01',
    model_routing: { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' },
    build: 4127,
  },
  none: {},
};
const probe = () => {
  const f = (v) => Math.round(v * 10) / 10;
  const line = document.querySelector('[data-env-version]');
  const box = line?.closest('li');
  return line && {
    status: line.dataset.status,
    lineH: f(line.getBoundingClientRect().height),
    boxH: box && f(box.getBoundingClientRect().height),
    text: line.innerText.replace(/\n/g, ' | '),
    labels: Array.from(line.querySelectorAll('dt')).map((d) => d.innerText),
  };
};
(async () => {
  if (mode === 'mock') {
    const { browser, page } = await open(1440, 900);
    await page.goto(`${base}/__mock/round10/sheet-versions`);
    await page.waitForSelector('[data-part=env-versions]');
    await page.waitForTimeout(600);
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-part=env-versions]')).map((l) => {
        const f = (v) => Math.round(v * 10) / 10;
        const box = l.closest('[data-part=env-box]');
        const width = l.closest('[data-width]').dataset.width;
        const vals = Array.from(l.querySelectorAll('[data-part=version-value]'));
        const keys = Array.from(l.querySelectorAll('[data-part=version-key]'));
        const cols = getComputedStyle(l.querySelector('dl') ?? l).gridTemplateColumns.split(' ').filter((x) => x.endsWith('px')).length;
        return {
          case: l.dataset.case,
          width,
          lineH: f(l.getBoundingClientRect().height),
          boxW: f(box.getBoundingClientRect().width),
          boxH: f(box.getBoundingClientRect().height),
          columns: cols,
          keys: keys.map((k) => `${k.innerText}${k.scrollWidth > k.clientWidth ? ' (overflow)' : ''}`).join(','),
          values: vals.map((v) => `${v.innerText.length}ch${v.title ? ' title' : ''}${v.scrollWidth > v.clientWidth + 1 ? ' overflow' : ''}`).join(','),
          smallestFont: Math.min(...Array.from(l.querySelectorAll('*')).filter((e) => e.childNodes.length && e.innerText && e.innerText.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))),
        };
      }),
    );
    const byWidth = {};
    for (const r of rows) (byWidth[r.width] ??= {})[r.case] = r.boxH;
    for (const r of rows) console.log(JSON.stringify(r));
    for (const [w, m] of Object.entries(byWidth)) console.log(`width ${w}: loading ${m.loading} one ${m.one} two ${m.two} three ${m.three} (shift 1..3 vs loading: ${[m.one, m.two, m.three].map((h) => Math.round((h - m.loading) * 10) / 10).join(' / ')}) five ${m.five} none ${m.none}`);
    await browser.close();
    return;
  }
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const { browser, page } = await open(w, h);
    await page.goto(`${base}${PROJ}/experiments`);
    const { envs } = await ids(page);
    for (const [name, body] of Object.entries(STATES)) {
      await page.request.post(`${FAKE}/__control/versioning`, { data: body });
      // the loading frame: hold the response 2.5 s
      await page.route('**/versioning-details', async (route) => {
        await new Promise((r) => setTimeout(r, 2500));
        await route.continue();
      });
      await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
      await page.waitForSelector('[data-env-version]');
      await page.waitForTimeout(300);
      const loading = await page.evaluate(probe);
      await page.waitForSelector('[data-env-version][data-status=ok]', { timeout: 15000 });
      await page.waitForTimeout(300);
      const loaded = await page.evaluate(probe);
      await page.unroute('**/versioning-details');
      console.log(w, name, 'loading', JSON.stringify(loading));
      console.log(w, name, 'loaded ', JSON.stringify(loaded), 'shift', Math.round((loaded.boxH - loading.boxH) * 10) / 10);
      const box = page.locator('[data-env-version]').first().locator('xpath=ancestor::li[1]');
      await box.screenshot({ path: `${SHOTS}/${process.env.R10_SHOTS ?? 'current'}-env-versions-${name}-${w}.png` });
    }
    await page.request.post(`${FAKE}/__control/versioning`, { data: STATES.three });
    await browser.close();
  }
})();
