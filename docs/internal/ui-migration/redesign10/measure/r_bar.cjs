// Review stage, point 1: every attribute of the five slots per step (launch and editor), chrome, page-wide Launch/Publish controls
// (buttons, links, menu items; mouse and keyboard reach), the 390 bar in the Ready / problems / over-the-limit states.
// Usage: R10_BASE=http://127.0.0.1:8972 node r_bar.cjs
const { open, ids, base, PROJ } = require('./pw.cjs');
const STEPS = ['where', 'start', 'models', 'settings', 'evaluation', 'review'];
const EDITOR = ['where', 'models', 'settings', 'evaluation', 'review'];
const facts = () => {
  const bar = document.querySelector('[data-part=launch-bar]');
  const f = (v) => Math.round(v * 10) / 10;
  const cs = (e, k) => getComputedStyle(e).getPropertyValue(k);
  const parts = Array.from(bar.querySelectorAll('[data-part]')).map((e) => {
    const r = e.getBoundingClientRect();
    return { part: e.dataset.part, x: f(r.x), right: f(r.right), y: f(r.y), w: f(r.width), h: f(r.height), text: e.innerText.trim().replace(/\s+/g, ' ').slice(0, 60),
      action: e.getAttribute('data-action'), variant: e.getAttribute('data-variant'), aria: e.getAttribute('aria-label'),
      disabled: e.disabled ?? null, ariaDisabled: e.getAttribute('aria-disabled'), tabIndex: e.tabIndex, minInline: cs(e, 'min-inline-size'),
      font: `${cs(e, 'font-size')}/${cs(e, 'font-weight')}`, jc: e.dataset.part === 'bar-status' ? cs(e, 'justify-content') : undefined };
  });
  const br = bar.getBoundingClientRect();
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement('div');
  probe.style.cssText = 'background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-popover)';
  document.body.appendChild(probe);
  const want = { bg: cs(probe, 'background-color'), border: cs(probe, 'border-top-color'), radius: cs(probe, 'border-top-left-radius'), shadow: cs(probe, 'box-shadow') };
  probe.remove();
  // every control in the page whose accessible text starts with Launch or Publish
  const named = Array.from(document.querySelectorAll('button, a, [role=button], [role=link], [role=menuitem]'))
    .filter((e) => /^(launch|publish)/i.test((e.getAttribute('aria-label') || e.innerText || '').trim()))
    .map((e) => `${e.tagName.toLowerCase()}[${e.dataset.part ?? ''}] "${(e.getAttribute('aria-label') || e.innerText).trim().slice(0, 30)}" ${e.disabled ? 'disabled' : 'enabled'} visible=${e.getBoundingClientRect().width > 0}`);
  return {
    bar: { x: f(br.x), right: f(br.right), h: f(br.height), sw: bar.scrollWidth, cw: bar.clientWidth, bg: cs(bar, 'background-color'), border: `${cs(bar, 'border-top-width')} ${cs(bar, 'border-top-color')}`,
      radius: cs(bar, 'border-top-left-radius'), shadow: cs(bar, 'box-shadow'), want },
    parts, buttons: bar.querySelectorAll('button').length, statusLinks: bar.querySelectorAll('[data-part=bar-status] button, [data-part=bar-status] a').length,
    launchLike: named,
  };
};
async function tabSweep(page) {
  // Tab through the whole page from the top: every stop whose name starts with Launch / Publish
  await page.evaluate(() => { document.activeElement?.blur(); window.focus(); });
  await page.locator('body').focus().catch(() => {});
  const hits = [];
  const seen = new Set();
  for (let i = 0; i < 250; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; return { name: (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40), part: e.getAttribute('data-part'), id: e.outerHTML.slice(0, 80) }; });
    if (!d) continue;
    if (seen.has(d.id + d.name) && i > 5) { if (seen.size > 3) break; }
    seen.add(d.id + d.name);
    if (/^(launch|publish)/i.test(d.name)) hits.push(d.name + ' [' + d.part + ']');
  }
  return { stops: seen.size, hits };
}
(async () => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const { browser, page } = await open(w, h);
    await page.goto(`${base}${PROJ}/experiments`);
    const { envs, twoAxis } = await ids(page);
    const views = [
      ...STEPS.map((s) => [`launch ${s}`, `${PROJ}/experiments/new?env=${envs.staging},${envs.production}&step=${s}`]),
      ...EDITOR.map((s) => [`editor ${s}`, `${PROJ}/environments/${envs.staging}/default-preset/edit?step=${s}`]),
      ['clone review (Ready)', `${PROJ}/experiments/new?clone=${twoAxis}&step=review`],
      ['clone models (Ready)', `${PROJ}/experiments/new?clone=${twoAxis}&step=models`],
    ];
    for (const [name, url] of views) {
      await page.goto(base + url);
      await page.waitForSelector('[data-part=launch-bar]', { timeout: 20000 });
      await page.waitForTimeout(2200);
      const heading = await page.evaluate(() => Array.from(document.querySelectorAll('h2')).map((e) => e.innerText).join(' | ').slice(0, 80));
      const m = await page.evaluate(facts);
      const out = { w, view: name, heading, bar: m.bar, buttons: m.buttons, statusLinks: m.statusLinks, launchLike: m.launchLike,
        parts: m.parts.map((p) => `${p.part}@${p.x}..${p.right} y${p.y} h${p.h} "${p.text}"${p.action ? ' action=' + p.action : ''}${p.variant ? ' v=' + p.variant : ''}${p.aria ? ' aria="' + p.aria + '"' : ''}${p.disabled ? ' DISABLED' : ''}${p.ariaDisabled ? ' aria-disabled=' + p.ariaDisabled : ''} tab=${p.tabIndex}${p.part === 'bar-continue' ? ' min=' + p.minInline : ''} ${p.font}${p.jc ? ' jc=' + p.jc : ''}`) };
      if (w === 1440 && !name.startsWith('clone')) out.tab = await tabSweep(page);
      console.log(JSON.stringify(out));
    }
    // the home bar
    for (const [name, url] of [['home both', `${PROJ}/experiments/new?env=${envs.staging},${envs.production}`], ['home nothing', `${PROJ}/experiments/new`]]) {
      await page.goto(base + url);
      await page.waitForSelector('[data-part=launch-bar]');
      await page.waitForTimeout(1500);
      const m = await page.evaluate(facts);
      console.log(JSON.stringify({ w, view: name, h: m.bar.h, parts: m.parts.filter((p) => p.part.startsWith('bar-')).map((p) => `${p.part} "${p.text}" ${p.jc ?? ''}`) }));
    }
    if (w === 390 || w === 1440) {
      // over the run limit: the dry run answers max_jobs 4 for the 12-run clone
      await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
        const body = route.request().postDataJSON();
        if (!body?.dry_run) return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        return route.fulfill({ json: { ...json, max_jobs: 4 } });
      });
      for (const s of ['where', 'models', 'review']) {
        await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=${s}`);
        await page.waitForSelector('[data-part=launch-bar]');
        await page.waitForTimeout(3000);
        const m = await page.evaluate(facts);
        const st = m.parts.find((p) => p.part === 'bar-status');
        const pr = m.parts.find((p) => p.part === 'bar-continue');
        console.log(JSON.stringify({ w, view: `over-limit ${s}`, h: m.bar.h, status: `${st.text} h${st.h}`, primary: `${pr.text} ${pr.action} ${pr.disabled ? 'DISABLED' : 'enabled'}`, sw: m.bar.sw, cw: m.bar.cw }));
      }
      await page.unroute(/\/v1\/projects\/[^/]+\/experiments$/);
    }
    await browser.close();
  }
})();
