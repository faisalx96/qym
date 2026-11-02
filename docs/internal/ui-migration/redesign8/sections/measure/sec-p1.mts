import { launch, newPage, cmpUrl, sleep } from './sec-lib.mts';
import { apply } from './sec-measure.mts';
const b = await launch();
for (const r of ['cur','A','B']) { const p = await newPage(b, 1440, 900); await p.goto(cmpUrl()); await sleep(4000); await apply(p, r); await sleep(500);
 console.log(r, await p.evaluate(() => { const q=(s:string)=>document.querySelector(s)!.getBoundingClientRect(); const cards=[...document.querySelectorAll('[data-part=run-card]')].map(e=>Math.round(e.getBoundingClientRect().bottom)); return {cardBottom: Math.max(...cards), table: Math.round(q('[data-part=averages-table]').bottom), avgTitleTop: Math.round(q('#compare-averages-title').top)}; })); await p.context().close(); }
await b.close();
