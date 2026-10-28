import { launch, newPage, legacyUrl, reactUrl, shots, sleep, legacyFull, reactFull } from './lib8.mts';
import path from 'node:path';
const b = await launch();
for (const w of [1440, 390]) {
  const lp = await newPage(b, w);
  await lp.goto(legacyUrl(['base', 'a', 'b', 'c']));
  await sleep(4000);
  const lh = await legacyFull(lp, `legacy-page-${w}.png`);
  const rp = await newPage(b, w);
  await rp.goto(reactUrl(['base', 'a', 'b', 'c']));
  await sleep(6000);
  const rh = await reactFull(rp, `current-page-${w}.png`);
  console.log(w, lh, rh);
}
await b.close();
