import { launch, newPage, cmpUrl, runUrl, sleep, warm, full, S } from './sec-lib.mts';
import { apply } from './sec-measure.mts';
const D = '/home/meshari-aldossari/Documents/qym/qym-wt-redesign8-sections/docs/internal/ui-migration/redesign8/sections/shots';
const b = await launch();
for (const r of ['cur', 'A', 'B']) for (const w of [1440, 390]) for (const [n, u] of [['compare', cmpUrl()], ['run', runUrl()]]) {
  const p = await newPage(b, w, 900); await p.goto(u); await sleep(3500); await warm(p); await apply(p, r); await sleep(600);
  const name = r === 'cur' ? `current-${n}-${w}.png` : `mock-sections-${r}-${n}-${w}.png`;
  // boundary crop first (1440 only), at the real viewport
  if (w === 1440 && r !== 'cur') {
    const y = await p.evaluate((id) => { const el = document.getElementById(id)!; const m = document.getElementById('shell-content')!; return el.getBoundingClientRect().top + m.scrollTop; }, n === 'compare' ? 'compare-overview' : 'run-section-latency');
    await p.evaluate((yy) => { document.getElementById('shell-content')!.scrollTop = yy - 300; }, y); await sleep(500);
    await p.screenshot({ path: `${D}/mock-sections-${r}-boundary-${n}-1440.png`, clip: { x: 192, y: 96, width: 1248, height: 520 } });
  }
  await p.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; });
  await full(p, `${D}/${name}`);
  await p.context().close();
}
await b.close();
