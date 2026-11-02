import { chromium } from './lib-a.mts';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
for (const w of [1440, 1024, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': 'mgr@x.com' } });
  const p = await ctx.newPage(); await p.goto(`http://127.0.0.1:8985/projects/pa/datasets/support-faq?v=v2&item=faq-003&tab=history`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  console.log(w, await p.evaluate(`(()=>{const e=document.querySelector('[data-testid="rev-disabled"]'); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), e.innerText.replace(/\\n+/g,' | '), e.querySelectorAll('button').length]})()`));
  await ctx.close();
}
await b.close();
