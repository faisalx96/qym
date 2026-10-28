// Round 8b after-shots and first-screen numbers (implementation). Platform on 8984, Vite on 5984; S holds sec-ids.json (sec-seed.mts).
import { launch, newPage, ids, sleep, warm, full } from './sec-lib.mts';
const V = 'http://127.0.0.1:5984';
const D = '/home/meshari-aldossari/Documents/qym/qym-wt-redesign8-sections/docs/internal/ui-migration/redesign8/sections/shots';
const cmp = `${V}/compare?${['base', 'a', 'b', 'c'].map((k) => 'runs=' + ids.cmp.runs[k]).join('&')}`;
const run = `${V}/run/${ids.rd.runs.repeat}`;
const b = await launch();
// first screen
{
  const p = await newPage(b, 1440, 900); await p.goto(cmp); await sleep(3500);
  const m = await p.evaluate(() => {
    const bottom = (s: string) => document.querySelector(s)!.getBoundingClientRect().bottom;
    const cards = Array.from(document.querySelectorAll('[data-part=run-card]')).map((e) => Math.round(e.getBoundingClientRect().y));
    return { cardsBottom: bottom('[data-part=run-card]'), cardsRows: new Set(cards).size, tableBottom: bottom('[data-part=averages-table]'),
      runsTop: document.querySelector('[data-part=section-runs]')!.getBoundingClientRect().top, avgTitleTop: document.querySelector('[data-part=section-averages] h2')!.getBoundingClientRect().top,
      navBottom: document.querySelector('[data-part=section-nav]')!.getBoundingClientRect().bottom };
  });
  console.log('FIRST', JSON.stringify(m));
  await p.screenshot({ path: `${D}/after-sections-first-screen-1440.png` });
  await p.context().close();
}
for (const w of [1440, 390]) for (const [n, u] of [['compare', cmp], ['run', run]] as const) {
  const p = await newPage(b, w, 900); await p.goto(u); await sleep(3500); await warm(p); await sleep(600);
  if (w === 1440) {
    const y = await p.evaluate((id) => { const el = document.getElementById(id)!; const m = document.getElementById('shell-content')!; return el.getBoundingClientRect().top + m.scrollTop; }, n === 'compare' ? 'compare-overview' : 'run-section-latency');
    await p.evaluate((yy) => { document.getElementById('shell-content')!.scrollTop = yy - 300; }, y); await sleep(500);
    await p.screenshot({ path: `${D}/after-sections-boundary-${n}-1440.png`, clip: { x: 192, y: 96, width: 1248, height: 520 } });
  }
  await p.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; });
  const h = await full(p, `${D}/after-sections-${n}-${w}.png`);
  console.log('SHOT', n, w, h);
  await p.context().close();
}
await b.close();
