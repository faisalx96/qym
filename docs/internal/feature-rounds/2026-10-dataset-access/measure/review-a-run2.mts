import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const RUN = process.argv[2];
for (const w of [1440, 390]) for (const who of ['mem3', 'mem2']) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:8985/projects/pa/runs/${RUN}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Items/ }).or(p.getByRole('tab', { name: /^Items/ })).or(p.getByRole('link', { name: /^Items/ })).first().click().catch((e: any) => console.log('click fail'));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(`({url:location.pathname+location.search, red:document.querySelectorAll('[data-testid="run-item-redacted"]').length, hidden:(document.body.innerText.match(/Hidden: you[^\\n]*/g)||[]).slice(0,2), leak:/What is the refund|Refunds within|ما هي|I do not know/.test(document.body.innerText), h:(()=>{const e=document.querySelector('[data-testid="run-item-redacted"]'); return e&&+e.getBoundingClientRect().height.toFixed(1)})()})`);
  console.log(w, who, JSON.stringify(r));
  if (who==='mem3' && w===1440) await p.screenshot({ path: path.join(shotsDir, `review-run-items-redacted-${w}.png`) });
  await ctx.close();
}
await b.close();
