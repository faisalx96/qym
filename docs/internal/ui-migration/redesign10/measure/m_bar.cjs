// K1: the parts of the bottom bar on every Customize step (order, x, width, label, disabled), today or on the mocks.
// Usage: node m_bar.cjs [current|mock]
const { open, ids, base, PROJ } = require('./pw.cjs');
const mode = process.argv[2] ?? 'current';
const probe = () => {
  const bar = document.querySelector('[data-part=launch-bar]');
  if (!bar) return null;
  const parts = Array.from(bar.querySelectorAll('[data-part]')).filter((e) => e.getBoundingClientRect().width > 0);
  return {
    h: Math.round(bar.getBoundingClientRect().height * 10) / 10,
    buttons: bar.querySelectorAll('button').length,
    parts: parts.map((e) => {
      const r = e.getBoundingClientRect();
      const label = (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const dis = e.matches('button') ? (e.disabled || e.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : '') : '';
      return `${e.dataset.part}@${Math.round(r.x)}+${Math.round(r.width)} "${label}"${dis}`;
    }),
  };
};
(async () => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const { browser, page } = await open(w, h);
    let views;
    if (mode === 'mock') {
      views = ['customize-where', 'customize-start', 'review', 'sheet-bar'].map((v) => [v, `/__mock/round10/${v}`]);
    } else {
      await page.goto(`${base}${PROJ}/experiments`);
      const { envs } = await ids(page);
      views = ['where', 'start', 'models', 'settings', 'evaluation', 'review'].map((s) => [s, `${PROJ}/experiments/new?env=${envs.staging}&step=${s}`]);
      views.push(['editor where', `${PROJ}/environments/${envs.staging}/default-preset/edit?step=where`]);
      views.push(['editor review', `${PROJ}/environments/${envs.staging}/default-preset/edit?step=review`]);
    }
    for (const [name, url] of views) {
      await page.goto(base + url);
      try { await page.waitForSelector('[data-part=launch-bar]', { timeout: 15000 }); } catch { console.log(w, name, 'no bar'); continue; }
      await page.waitForTimeout(1500);
      console.log(w, name, JSON.stringify(await page.evaluate(probe)));
    }
    await browser.close();
  }
})();
