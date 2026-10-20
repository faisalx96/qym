import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
for (const w of [1440]) {
const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${process.argv[3] ?? "mem3"}@x.com` } });
const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:8985/projects/pa/runs/${process.argv[2]}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const t = await p.evaluate('document.querySelector("[data-testid=data-table]").innerText'); console.log(w, JSON.stringify(t.slice(0,420)));
await p.getByText('#1', { exact: true }).first().click().catch(()=>console.log('rowclick fail'));
await p.waitForTimeout(3500);
console.log(await p.evaluate(`({url:location.search, red:document.querySelectorAll('[data-testid="run-item-redacted"]').length, hid:(document.body.innerText.match(/Hidden: you[^\\n]*/g)||[]), leak:/What is the refund|Refunds within|ما هي|I do not know/.test(document.body.innerText), h:(()=>{const e=document.querySelector('[data-testid="run-item-redacted"]'); return e&&+e.getBoundingClientRect().height.toFixed(1)})()})`));
await p.screenshot({ path: path.join(shotsDir, `review-run-item-open-${w}.png`) });
await ctx.close(); }
await b.close();
