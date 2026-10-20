import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const [A, B2] = [process.argv[2], process.argv[3]];
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': 'mem3@x.com' } });
const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:8985/projects/pa/compare?cohortA=${A}&cohortB=${B2}&tab=items`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
console.log(await p.evaluate(`({u:location.search, hidden:(document.body.innerText.match(/Hidden: you[^\\n]*/g)||[]).length, priv:(document.body.innerText.match(/private test set[^\\n]*/gi)||[]).slice(0,3), leak:/I do not know|ما هي سياسة/.test(document.body.innerText), t:document.body.innerText.length})`));
await p.screenshot({ path: path.join(shotsDir, 'review-compare-redacted-1440.png') });
await b.close();
