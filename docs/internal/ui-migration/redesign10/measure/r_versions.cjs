// Review stage, point 3: the Versions grid on the environment box (2-key, 5-key with an object, empty, null, unsupported, error),
// columns and box heights at 1440 / 1024 / 390, contrast in dark and light, the review row, the Experiments list filters and
// the best-run picker's scope selects and Versions column (answers injected with page.route).
// Usage: R10_BASE=http://127.0.0.1:8972 R10_FAKE_PORTS=9072,9073 node r_versions.cjs
const { chromium, ids, base, PROJ, SHOTS } = require('./pw.cjs');
const [STAGING, PRODUCTION] = (process.env.R10_FAKE_PORTS ?? '9098,9099').split(',').map((p) => `http://127.0.0.1:${p}`);
const OUT = process.env.R10_REVIEW_OUT;
const setV = async (fake, body) => { const r = await fetch(`${fake}/__control/versioning`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); };
const ROUTING = { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' };
const V2 = { agent_version: 'agent-1.5.0', kb_version: 'kb-81' };
const V3 = { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' };
const V5 = { agent_version: 'agent-1.5.0', kb_version: 'kb-81', prompt_set: 'prompts-2026-11-01', model_routing: ROUTING, build: 4127 };
const VODD = { zeta_build: 'z-9', 'alpha.version': '2.0', enabled: true, a_very_long_versioning_key_name_from_the_service: 'x' };
const facts = (env) => {
  const li = Array.from(document.querySelectorAll('li')).find((l) => l.querySelector('[data-env-version]') && l.innerText.includes(env));
  if (!li) return null;
  const line = li.querySelector('[data-env-version]');
  const f = (v) => Math.round(v * 10) / 10;
  const grid = line.querySelector('dl');
  const cells = grid ? Array.from(grid.children) : [];
  const boxes = cells.map((c) => c.getBoundingClientRect());
  let overlap = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap++; }
  const cs = (e) => getComputedStyle(e);
  const label = line.firstElementChild;
  return {
    status: line.getAttribute('data-status'), box: f(li.getBoundingClientRect().width) + 'x' + f(li.getBoundingClientRect().height), lineH: f(line.getBoundingClientRect().height),
    label: `${label.innerText} ${cs(label).fontSize}/${cs(label).fontWeight}`,
    cols: grid ? cs(grid).gridTemplateColumns.split(' ').length : 0, gridW: grid ? f(grid.getBoundingClientRect().width) : 0,
    cells: cells.map((c) => {
      const k = c.querySelector('[data-part=version-key]'); const v = c.querySelector('[data-part=version-value]');
      return `${k ? k.innerText : '?'}${k && k.scrollWidth > k.clientWidth + 0.5 ? '(CLIPPED)' : ''}${k ? ' ' + cs(k).fontSize + ' ' + cs(k).color : ''} = ${v ? v.innerText : '?'} [${v ? (v.className.match(/tag/i) ? 'tag' : 'text') + ' ' + cs(v).fontSize + ' ' + (/mono/i.test(cs(v).fontFamily) ? 'mono' : 'sans') : ''}${v && v.title ? ' title=' + v.title.length + 'ch' : ''}]${c.hasAttribute('data-wide') ? ' WIDE w=' + f(c.getBoundingClientRect().width) : ''}${c.getAttribute('aria-hidden') ? ' aria-hidden' : ''}`;
    }),
    overlap, text: line.innerText.replace(/\s+/g, ' ').slice(0, 200),
    unset: line.querySelectorAll('[data-unset]').length, notSet: /not set/i.test(line.innerText), image: /\bimage\b/.test(line.innerText),
  };
};
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    for (const [w, h] of scheme === 'dark' ? [[1440, 1000], [1024, 900], [390, 844]] : [[1440, 1000]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(`${base}${PROJ}/experiments`);
      const { envs } = await ids(page);
      const payloads = scheme === 'dark' ? [['two', V2], ['three', V3], ['five', V5], ['odd', VODD], ['empty', {}], ['null-image', { agent_version: 'agent-1.5.0', image_version: null, kb_version: 'kb-81' }]] : [['five', V5]];
      for (const [name, payload] of payloads) {
        await setV(PRODUCTION, payload);
        await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
        await page.waitForSelector('[data-env-version][data-status=ok]', { timeout: 15000 });
        await page.waitForTimeout(500);
        const r = await page.evaluate(facts, 'production');
        console.log(JSON.stringify({ scheme, w, payload: name, ...r }));
        if (OUT && ['two', 'five', 'empty'].includes(name) && w !== 1024 && scheme === 'dark') {
          const li = page.locator('li', { has: page.locator('[data-env-version]') }).filter({ hasText: 'production' }).first();
          await li.screenshot({ path: `${OUT}/versions-${name}-${w}.png` });
        }
        if (name === 'five') {
          // contrast of the key on the selected box (resolve the fill over the card) and axe
          const c = await page.evaluate(() => {
            const li = Array.from(document.querySelectorAll('li')).find((l) => l.querySelector('[data-env-version]') && l.innerText.includes('production'));
            const key = li.querySelector('[data-part=version-key]');
            const val = li.querySelector('[data-part=version-value]');
            const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d');
            const rgb = (col, under) => { x.clearRect(0, 0, 1, 1); if (under) { x.fillStyle = under; x.fillRect(0, 0, 1, 1); } x.fillStyle = col; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); };
            let n = li; const layers = []; while (n) { const bg = getComputedStyle(n).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)') layers.unshift(bg); n = n.parentElement; }
            x.clearRect(0, 0, 1, 1); for (const l of layers) { x.fillStyle = l; x.fillRect(0, 0, 1, 1); }
            const ground = Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3);
            const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
            const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((h + 0.05) / (l + 0.05)) * 100) / 100; };
            const groundStr = `rgb(${ground.join(',')})`;
            const keyRgb = rgb(getComputedStyle(key).color, groundStr);
            const mono = li.querySelectorAll('[data-part=version-value]')[4];
            const monoRgb = rgb(getComputedStyle(mono).color, groundStr);
            return { ground: groundStr, keyColor: getComputedStyle(key).color, key: ratio(keyRgb, ground), monoValue: ratio(monoRgb, ground) };
          });
          let axe = 'n/a';
          try {
            const { default: AxeBuilder } = require(require('path').resolve(__dirname, '../../../../../frontend/node_modules/@axe-core/playwright'));
            const res = await new AxeBuilder({ page }).analyze();
            axe = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}(${v.nodes.length})`).join(',') || '0 serious';
          } catch (e) { axe = 'axe unavailable: ' + e.message.slice(0, 80); }
          console.log(JSON.stringify({ scheme, w, contrast: c, axe }));
        }
      }
      if (scheme === 'dark') {
        // the loading frame: hold the answer
        await setV(PRODUCTION, V3);
        let release; const gate = new Promise((r) => (release = r));
        await page.route('**/versioning-details', async (route) => { await gate; await route.continue(); });
        await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
        await page.waitForSelector('[data-env-version] [aria-busy=true]', { timeout: 15000 });
        await page.waitForTimeout(300);
        const lf = await page.evaluate(() => {
          const line = document.querySelector('[data-env-version]');
          const busy = line.querySelector('[aria-busy=true]');
          const ph = Array.from(line.querySelectorAll('[data-part=version-placeholder]'));
          const vis = Array.from(line.querySelectorAll('*')).filter((e) => e.childElementCount === 0 && e.innerText && e.innerText.trim() && e.getBoundingClientRect().width > 2 && getComputedStyle(e).clip !== 'rect(0px, 0px, 0px, 0px)' && getComputedStyle(e).position !== 'absolute').map((e) => e.innerText.trim());
          const sr = Array.from(line.querySelectorAll('*')).filter((e) => e.childElementCount === 0 && e.innerText && e.innerText.trim() && (getComputedStyle(e).position === 'absolute')).map((e) => e.innerText.trim() + ' (' + e.getBoundingClientRect().width + 'px)');
          return { placeholders: ph.length, rows: new Set(ph.map((p) => Math.round(p.getBoundingClientRect().y))).size, ariaHidden: ph.every((p) => p.getAttribute('aria-hidden') === 'true'), busyText: busy.innerText.replace(/\s/g, ''), visibleText: vis, srOnly: sr, box: Math.round(line.closest('li').getBoundingClientRect().height * 10) / 10 };
        });
        release();
        await page.waitForSelector('[data-env-version][data-status=ok]');
        await page.waitForTimeout(300);
        const loaded = await page.evaluate(() => Math.round(document.querySelector('[data-env-version]').closest('li').getBoundingClientRect().height * 10) / 10);
        console.log(JSON.stringify({ w, loadingFrame: lf, loadedBox3: loaded }));
        await page.unroute('**/versioning-details');
        // unsupported / error
        for (const [st, extra] of [['unsupported', {}], ['error', { error: 'kb offline' }]]) {
          await page.route(`**/eval-environments/${envs.production}/versioning-details`, (route) => route.fulfill({ json: { environment_id: envs.production, status: st, versioning_details: {}, error: null, fetched_at: null, ...extra } }));
          await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
          await page.waitForSelector(`[data-env-version][data-status=${st}]`, { timeout: 15000 });
          console.log(JSON.stringify({ w, status: st, text: await page.locator('[data-env-version]').first().innerText() }));
          await page.unroute(`**/eval-environments/${envs.production}/versioning-details`);
        }
      }
      await ctx.close();
    }
  }
  // the Experiments list filters and the best-run picker (answers injected)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`${base}${PROJ}/experiments`);
  const { envs } = await ids(page);
  await page.route(/\/experiments\?.*/, async (route) => {
    if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') return route.continue();
    const res = await route.fetch(); const json = await res.json();
    return route.fulfill({ json: { ...json, versioning_facets: { kb_version: ['kb-77', 'kb-81'], agent_version: ['agent-1.4.2'], prompt_set: ['prompts-2026-11-01'] } } });
  });
  await page.goto(`${base}${PROJ}/experiments?versioning=image_version%3Dimg-1`);
  await page.waitForSelector('[data-exp-versioning]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const filters = await page.evaluate(() => Array.from(document.querySelectorAll('[data-exp-versioning]')).map((s) => `${s.dataset.expVersioning}: label="${(s.querySelector('label') ?? s).innerText.split('\n')[0]}" title="${s.title}"`));
  console.log(JSON.stringify({ listFilters: filters }));
  const first = page.locator('[data-exp-versioning]').first().getByRole('button').first();
  await first.click().catch(() => {});
  await page.waitForTimeout(300);
  console.log(JSON.stringify({ listFirstOptions: await page.evaluate(() => Array.from(document.querySelectorAll('[role=option]')).map((o) => o.innerText.trim()).slice(0, 4)) }));
  if (OUT) await page.screenshot({ path: `${OUT}/list-filters-1440.png`, clip: { x: 192, y: 0, width: 1248, height: 260 } });
  await page.keyboard.press('Escape');
  await page.unroute(/\/experiments\?.*/);
  // best-run picker
  await page.route(/\/best-runs\/scope/, (route) => route.fulfill({ json: { datasets: [{ id: 'd1', name: 'golden', run_count: 2, versions: [{ id: 'v1', version: 'v1', run_count: 2 }] }], versioning: { kb_version: [{ value: 'kb-7', run_count: 2 }], agent_version: [{ value: '1.4', run_count: 2 }], prompt_set: [{ value: 'p-1', run_count: 1 }] }, total_runs: 2 } }));
  await page.route(/\/best-runs\?/, (route) => route.fulfill({ json: { environment_id: envs.production, dataset: { id: 'd1', name: 'golden' }, dataset_version: null, scope: { dataset: null, dataset_version: null, versioning: {}, global: true }, metric: 'exact_match', direction: 'maximize', k: null, exclude_errored: true, metrics: [{ name: 'exact_match', run_count: 2 }], eligible_count: 2, runs: [
    { rank: 1, run_id: 'r1', score: 0.9, item_count: 10, status: 'SUCCEEDED', dataset: { id: 'd1', name: 'golden' }, remote_versioning: { kb_version: 'kb-7', agent_version: '1.4', model_routing: ROUTING } },
    { rank: 2, run_id: 'r2', score: 0.8, item_count: 10, status: 'SUCCEEDED', dataset: { id: 'd1', name: 'golden' }, remote_versioning: { agent_version: '1.3' } } ], reason: null } }));
  await page.goto(`${base}${PROJ}/experiments/new?env=${envs.production}`);
  await page.getByText('Top-scoring run').click();
  await page.waitForTimeout(1500);
  const scope = await page.evaluate(() => Array.from(document.querySelectorAll('label')).map((l) => l.innerText.trim()).filter((t) => /version|set|kb|agent|prompt/i.test(t)));
  console.log(JSON.stringify({ bestRunScopeLabels: scope }));
  const kb = page.getByRole('button', { name: /kb_version/ }).first();
  if (await kb.count()) { await kb.click(); await page.waitForTimeout(300); console.log(JSON.stringify({ scopeFirstOption: await page.evaluate(() => Array.from(document.querySelectorAll('[role=option]')).map((o) => o.innerText.trim()).slice(0, 3)) })); await page.keyboard.press('Escape'); }
  const find = page.getByRole('button', { name: /^Find/ });
  if (await find.count()) { await find.first().click(); await page.waitForTimeout(2500); }
  const table = await page.evaluate(() => Array.from(document.querySelectorAll('table')).map((t) => ({ head: Array.from(t.querySelectorAll('th')).map((th) => th.innerText.trim()), rows: Array.from(t.querySelectorAll('tbody tr')).map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()) })));
  console.log(JSON.stringify({ bestRunTables: table }));
  if (OUT) await page.screenshot({ path: `${OUT}/bestrun-1440.png`, fullPage: true });
  await browser.close();
})();
