import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const RUN = process.argv[2];
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
for (const w of [1440, 1024, 390]) {
  for (const who of ['mem3', 'mem2']) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
    const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:8985/projects/pa/runs/${RUN}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const r = await p.evaluate(`(()=>{const q=(s)=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)];}; const t=document.body.innerText; return { banner:q('[data-testid="restricted-dataset-banner"]'), bannerText: document.querySelector('[data-testid="restricted-dataset-banner"]')?.innerText.replace(/\\n+/g,' | '), redacted: document.querySelectorAll('[data-testid="run-item-redacted"]').length, redactedText: document.querySelector('[data-testid="run-item-redacted"]')?.innerText.replace(/\\n+/g,' | ').slice(0,200), leaksQ: /What is the refund|ما هي سياسة|Refunds within/.test(t), hasScore: /exact_match|Exact/i.test(t) }})()`);
    console.log(w, who, JSON.stringify(r));
    if (who === 'mem3') await p.screenshot({ path: path.join(shotsDir, `review-run-redaction-${w}.png`) });
    await ctx.close();
  }
}
await b.close();
