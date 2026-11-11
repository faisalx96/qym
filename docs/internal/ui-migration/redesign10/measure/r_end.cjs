// Review stage: the bar at the scroll end and while scrolling (C-4-3, C-4-4), with the lowest painted content box (not the bar's sibling).
// Usage: R10_BASE=http://127.0.0.1:8972 node r_end.cjs
const { open, ids, base, PROJ } = require('./pw.cjs');
const OUT = process.env.R10_REVIEW_OUT;
const probe = () => {
  const bar = document.querySelector('[data-part=launch-bar]');
  const scroller = document.querySelector('main');
  const f = (v) => Math.round(v * 10) / 10;
  const b = bar.getBoundingClientRect();
  // lowest painted box inside main that is not the bar or inside it, and is not a pure wrapper of the bar
  let low = 0, lowEl = '';
  for (const el of scroller.querySelectorAll('*')) {
    if (el === bar || bar.contains(el) || el.contains(bar)) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (r.bottom > low) { low = r.bottom; lowEl = (el.dataset.part || el.tagName.toLowerCase()) + '.' + (el.className?.toString?.().slice(0, 30) || ''); }
  }
  const sr = scroller.getBoundingClientRect();
  return { scrollTop: f(scroller.scrollTop), scrollH: scroller.scrollHeight, clientH: scroller.clientHeight, barTop: f(b.top), barBottom: f(b.bottom),
    viewport: innerHeight, scrollerBottom: f(sr.bottom), lowestContent: f(low), lowEl, gap: f(b.top - low),
    barBottomInScroll: f(b.bottom - sr.top + scroller.scrollTop) };
};
(async () => {
  for (const [w, h] of [[1440, 900], [1440, 1400], [390, 844]]) {
    const { browser, page } = await open(w, h);
    await page.goto(`${base}${PROJ}/experiments`);
    const { envs } = await ids(page);
    const views = [
      ['home nothing', `${PROJ}/experiments/new`],
      ['home production', `${PROJ}/experiments/new?env=${envs.production}`],
      ['home staging', `${PROJ}/experiments/new?env=${envs.staging}`],
      ...['where', 'start', 'models', 'settings', 'evaluation', 'review'].map((s) => [`step ${s}`, `${PROJ}/experiments/new?env=${envs.production}&step=${s}`]),
      ...['where', 'start', 'models', 'settings', 'review'].map((s) => [`editor ${s}`, `${PROJ}/environments/${envs.staging}/default-preset/edit?step=${s}`]),
    ];
    for (const [name, url] of views) {
      await page.goto(base + url);
      try { await page.waitForSelector('[data-part=launch-bar]', { timeout: 15000 }); } catch { console.log(w, h, name, 'NO BAR'); continue; }
      await page.waitForTimeout(2000);
      const top = await page.evaluate(probe);
      await page.evaluate(() => { const s = document.querySelector('main'); s.scrollTo(0, (s.scrollHeight - s.clientHeight) / 2); });
      await page.waitForTimeout(250);
      const mid = await page.evaluate(probe);
      await page.evaluate(() => { const s = document.querySelector('main'); s.scrollTo(0, 1e6); });
      await page.waitForTimeout(250);
      const end = await page.evaluate(probe);
      const over = top.scrollH > top.clientH;
      console.log(JSON.stringify({ w, h, view: name, overflow: over, scrollH: top.scrollH, clientH: top.clientH,
        top: { barBottom: top.barBottom, gap: top.gap }, mid: { barBottom: mid.barBottom, gap: mid.gap },
        end: { barTop: end.barTop, barBottom: end.barBottom, lowest: end.lowestContent, lowEl: end.lowEl, gap: end.gap, barBottomInScroll: end.barBottomInScroll, scrollH: end.scrollH }, viewport: h }));
      if (OUT && (name === 'step where' || name === 'home production') ) await page.screenshot({ path: `${OUT}/end-${name.replace(' ', '-')}-${w}x${h}.png` });
    }
    await browser.close();
  }
})();
