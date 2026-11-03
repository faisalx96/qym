// K4: the empty band between the last content element and the bottom bar, today (current-*) or on a mock (arg "mock").
// Usage: node m_gap.cjs [current|mock]
const { open, ids, base, PROJ, SHOTS } = require('./pw.cjs');
const mode = process.argv[2] ?? 'current';
const probe = () => {
  const bar = document.querySelector('[data-part=launch-bar]');
  if (!bar) return null;
  const f = (v) => Math.round(v * 10) / 10;
  // the last painted content box above the bar: the deepest previous sibling chain with a height
  let prev = bar.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
  let host = bar.parentElement;
  if (!prev) {
    for (let n = bar.parentElement; n && !prev; n = n.parentElement) prev = n.previousElementSibling;
  }
  const scroller = document.querySelector('main') ?? document.scrollingElement;
  const b = bar.getBoundingClientRect();
  const p = prev ? prev.getBoundingClientRect() : null;
  return {
    viewport: innerHeight,
    barTop: f(b.top),
    barBottom: f(b.bottom),
    barH: f(b.height),
    contentBottom: p ? f(p.bottom) : null,
    gap: p ? f(b.top - p.bottom) : null,
    belowBar: f(innerHeight - b.bottom),
    scrollH: scroller.scrollHeight,
    clientH: scroller.clientHeight,
    position: getComputedStyle(bar).position,
    marginTop: getComputedStyle(bar).marginTop,
  };
};
(async () => {
  const out = [];
  for (const [w, h] of [[1440, 900], [1440, 1400], [390, 844]]) {
    const { browser, page } = await open(w, h);
    if (mode === 'mock') {
      for (const v of ['home-short', 'customize-start', 'customize-where']) {
        await page.goto(`${base}/__mock/round10/${v}`);
        await page.waitForSelector('[data-part=launch-bar]');
        await page.waitForTimeout(500);
        const r = await page.evaluate(probe);
        out.push({ w, h, view: `mock ${v}`, ...r });
        // the end of a long page: the bar is 14 px under the last element and still ends at the viewport bottom
        await page.evaluate(() => (document.querySelector('main') ?? document.scrollingElement).scrollTo(0, 1e6));
        await page.evaluate(() => window.scrollTo(0, 1e6));
        await page.waitForTimeout(200);
        out.push({ w, h, view: `mock ${v} (scrolled to the end)`, ...(await page.evaluate(probe)) });
      }
    } else {
      await page.goto(`${base}${PROJ}/experiments`);
      const { envs } = await ids(page);
      const views = [
        ['home (default, nothing ticked)', `${PROJ}/experiments/new`],
        ['home (production only)', `${PROJ}/experiments/new?env=${envs.production}`],
        ['home (staging, saved presets)', `${PROJ}/experiments/new?env=${envs.staging}`],
        ...['where', 'start', 'models', 'settings', 'evaluation', 'review'].map((s) => [`step ${s}`, `${PROJ}/experiments/new?env=${envs.production}&step=${s}`]),
      ];
      for (const [name, url] of views) {
        await page.goto(base + url);
        await page.waitForSelector('[data-part=launch-bar]');
        await page.waitForTimeout(2200);
        const r = await page.evaluate(probe);
        out.push({ w, h, view: name, ...r });
        if (name.startsWith('home (prod') || name.startsWith('home (default') || name === 'step start') {
          const tag = name.startsWith('home (prod') ? 'create-home-short' : name.startsWith('home (default') ? 'create-home-empty' : 'step-start';
          await page.screenshot({ path: `${SHOTS}/current-${tag}-${w}x${h}.png` });
        }
      }
    }
    await browser.close();
  }
  for (const r of out) console.log(JSON.stringify(r));
})();
