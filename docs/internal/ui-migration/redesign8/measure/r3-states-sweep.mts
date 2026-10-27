/** Both pages: error state (unknown run ids), single run, loading frame; React cohort banner + Sweep. */
import { launch, newPage, legacyUrl, reactUrl, LEG, REACT, ids, sleep, shots, reactFull } from './lib8.mts';
import path from 'node:path';
const b = await launch();
const bad = 'runs=00000000-0000-0000-0000-000000000001&runs=00000000-0000-0000-0000-000000000002';
for (const [who, url, w] of [['legacy', `${LEG}/compare?${bad}`, 1440], ['current', `${REACT}/compare?${bad}`, 1440]] as const) {
  const p = await newPage(b, w, 600); await p.goto(url); await sleep(4500);
  await p.screenshot({ path: path.join(shots, `${who}-state-error.png`) });
  console.log(who, 'error text:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(120, 420));
}
for (const [who, url] of [['legacy', `${LEG}/compare?runs=${ids.legacy.base}`], ['current', `${REACT}/compare?runs=${ids.react.base}`]] as const) {
  const p = await newPage(b, 1440, 600); await p.goto(url); await sleep(4500);
  await p.screenshot({ path: path.join(shots, `${who}-state-single-run.png`) });
  console.log(who, 'single:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(100, 400));
}
const rp = await newPage(b, 1440);
await rp.goto(`${REACT}/compare?cohortA=${ids.react.base}&cohortA=${ids.react.a}&cohortB=${ids.react.b}&cohortB=${ids.react.c}`); await sleep(5000);
console.log('cohort h', await reactFull(rp, 'current-cohort-page-1440.png'));
await rp.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; });
await rp.setViewportSize({ width: 1440, height: 900 }); await sleep(500);
await rp.getByRole('radio', { name: 'Sweep' }).click().catch(async () => { await rp.getByText('Sweep', { exact: true }).first().click(); });
await sleep(3000);
console.log('sweep h', await reactFull(rp, 'current-sweep-page-1440.png'));
await b.close();
