// Review stage, D10-8: the run detail pass table's columns (Median among them) on the repeat run of seed-run-detail.ts,
// and the home bar height at 1024 with a problem shown. Usage: R10_BASE=<origin> R10_RUN=<run id> node r_median.cjs <tag>
const { chromium, base } = require('./pw.cjs');
(async () => {
  const b = await chromium.launch();
  for (const w of [1440, 1024]) {
    const p = await (await b.newContext({ viewport: { width: w, height: 1000 }, colorScheme: 'dark' })).newPage();
    await p.goto(`${base}/projects/rd-seed/runs/${process.env.R10_RUN}`);
    await p.waitForTimeout(7000);
    const r = await p.evaluate(() => Array.from(document.querySelectorAll('table')).filter((t) => /median/i.test(t.innerText)).map((t) =>
      Array.from(t.querySelectorAll('thead th')).map((th) => `${th.innerText.trim() || th.getAttribute('aria-label') || '·'}:${Math.round(th.getBoundingClientRect().width * 10) / 10}`).join(' | ')));
    console.log(process.argv[2], w, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
