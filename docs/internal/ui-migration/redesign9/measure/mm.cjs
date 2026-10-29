const { chromium } = require('/home/meshari-aldossari/Documents/qym/qym-wt-redesign9/frontend/node_modules/@playwright/test');
const { base, measure } = require('./pw.cjs');
(async () => {
  const browser = await chromium.launch();
  for (const [w, vw] of [[1440, 1800], [390, 480]]) {
    const page = await (await browser.newContext({ viewport: { width: vw, height: 1000 }, colorScheme: 'dark' })).newPage();
    const q = async (variant, parts) => {
      await page.goto(`${base}/__mock/round9/${variant}`); await page.waitForSelector('[data-testid=page-shell]'); await page.waitForTimeout(700);
      for (const p of parts) { const r = await measure(page, `[data-part="${p}"]`); console.log(w, variant, p, r && `${r.w}x${r.h} bg=${r.bg} parent=${r.parentBg} border=${r.border} pad=${r.pad} font=${r.font}`); }
    };
    await q('create-home', ['task-section', 'task-select', 'env-box', 'dataset-box', 'launch-bar', 'bar-launch']);
    await q('customize-where', ['launch-bar', 'bar-back', 'bar-skip', 'bar-continue', 'bar-launch', 'bar-cancel']);
    await q('customize-settings', ['launch-bar']);
    await q('review', ['review-summary', 'review-kv', 'run-count', 'runs-table', 'run-priority', 'review-ack', 'review-changes', 'launch-bar']);
    await q('environments-table', ['env-table', 'env-row-chevron']);
  }
  await browser.close();
})();
