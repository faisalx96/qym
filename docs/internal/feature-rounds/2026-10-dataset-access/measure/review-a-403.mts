import { chromium } from './lib-a.mts';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
for (const w of [1440, 1024, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': 'mem3@x.com' } });
  const p = await ctx.newPage(); await p.goto('http://127.0.0.1:8985/projects/pa/datasets/support-faq', { waitUntil: 'networkidle' });
  console.log(w, await p.evaluate(`(()=>{const a=document.querySelector('[data-testid="da-403"] [role="alert"]'); const r=a.getBoundingClientRect(); return [r.width,r.height]})()`));
  await ctx.close();
}
await b.close();
