import { launch, newPage, cmpUrl, sleep } from './sec-lib.mts';
import { apply } from './sec-measure.mts';
const b = await launch();
for (const r of ['cur','A','B']) { const p = await newPage(b, 1440, 900); await p.goto(cmpUrl()); await sleep(3500); await apply(p, r);
  await p.locator('[data-part=section-nav]').getByRole('link', { name: 'Overview' }).click(); await sleep(1500);
  console.log(r, await p.evaluate(() => { const n=document.querySelector('[data-part=section-nav]')!.getBoundingClientRect(); const s=document.getElementById('compare-overview')!; const t=document.getElementById('compare-overview-title')!; return {navBottom:Math.round(n.bottom), secTop:Math.round(s.getBoundingClientRect().top-n.bottom), titleTop:Math.round(t.getBoundingClientRect().top-n.bottom)}; })); await p.context().close(); }
await b.close();
