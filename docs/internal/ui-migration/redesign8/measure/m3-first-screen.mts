/** What the 1440x900 first screen shows (y relative to the top of the shell = the top of the browser window): mock and the current React page. */
import { launch, newPage, REACT, reactUrl, sleep } from './lib8.mts';
const b = await launch();
let p = await newPage(b, 1440, 900);
await p.goto(`${REACT}/__ui#round8`); await sleep(3500);
console.log('mock', await p.evaluate(() => {
  const shell = document.querySelectorAll('[data-testid="r8-shell"]')[0]!; const top = shell.getBoundingClientRect().top;
  const y = (sel: string, which: 'top' | 'bottom', n = 0) => { const e = shell.querySelectorAll(sel)[n]; return e ? Math.round(e.getBoundingClientRect()[which] - top) : null; };
  return { navBottom: y('[data-part="section-nav"]', 'bottom'), runCardsBottom: y('[data-part="run-card"]', 'bottom'), avgTop: y('[data-part="averages-table"]', 'top'), avgFirstRowBottom: y('[data-part="averages-metric-row"]', 'bottom', 0), avgSecondRowBottom: y('[data-part="averages-metric-row"]', 'bottom', 1), avgBottom: y('[data-part="averages-table"]', 'bottom'), overviewTop: y('[data-part="section-overview"]', 'top'), itemsTop: y('[data-part="section-items"]', 'top') };
}));
p = await newPage(b, 1440, 900);
await p.goto(reactUrl(['base', 'a', 'b', 'c'])); await sleep(6000);
console.log('current', await p.evaluate(() => {
  const m = document.getElementById('shell-content')!; const top = m.getBoundingClientRect().top - 50;
  const y = (sel: string, which: 'top' | 'bottom', n = 0) => { const e = document.querySelectorAll(sel)[n]; return e ? Math.round(e.getBoundingClientRect()[which] - top) : null; };
  return { stickyBottom: y('[data-compare-sticky]', 'bottom'), runCardsBottom: y('[data-testid="run-card"]', 'bottom'), avgTop: y('#compare-averages [data-testid="data-table"]', 'top'), avgRow1Bottom: y('[data-testid="average-row"]', 'bottom', 0), avgRow2Bottom: y('[data-testid="average-row"]', 'bottom', 1), overviewTop: y('#compare-overview', 'top') };
}));
await b.close();
