/** WP-A review measurements on the production build. Run: node review-a.mts <stage> (needs platform on 8985 with proxy_headers auth, seeded by review-a-seed.*).
 *  Identities: admin, mgr (manager), mem (creator/member), mem2, mem3 via X-User-Email on every request. */
import { chromium, shotsDir, WIDTHS } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const API = async (who: string, method: string, p: string, body?: unknown) => {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', 'x-user-email': `${who}@x.com`, origin: 'http://localhost:8000' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const stage = process.argv[2] ?? 'all';
const P = '/projects/pa/datasets';
const BOX = (sel: string) => `(() => { const e = document.querySelector('[data-testid="${sel}"]'); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1), ov: e.scrollWidth > e.clientWidth + 1, te: cs.textOverflow, fs: cs.fontSize + '/' + cs.fontWeight }; })()`;
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
async function open(who: string, w: number, url: string, wait?: string) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const page = await ctx.newPage();
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (wait) await page.waitForSelector(wait, { timeout: 10000 }).catch(() => console.log('  (missing ' + wait + ')'));
  await page.waitForTimeout(400);
  return { ctx, page };
}
const out: Record<string, unknown> = {};
const ev = (page: any, ids: string[]) => page.evaluate(`(() => { const o = {}; for (const id of ${JSON.stringify(ids)}) o[id] = ${'BOXFN'}(id); return o; })()`.replace('BOXFN', `((s)=>${BOX('"+s+"')})`));
async function boxes(page: any, ids: string[]) {
  const res: Record<string, unknown> = {};
  for (const id of ids) res[id] = await page.evaluate(BOX(id));
  return res;
}
const shot = (page: any, name: string, w: number) => page.screenshot({ path: path.join(shotsDir, `review-${name}-${w}.png`) });
async function put(who: string, ref: string, mode: string, grants: any[]) { const r = await API(who, 'PUT', `/v1/datasets/${ref}/access?project_slug=pa`, { access_mode: mode, grants }); if (r.status !== 200) console.log('PUT access failed', r.status, JSON.stringify(r.json)); }

if (stage === 'catalog' || stage === 'all') {
  await put('mgr', 'legal-clauses', 'restricted', [{ user_id: 'mem2', level: 'view' }, { user_id: 'mem', level: 'modify' }]);
  await API('admin', 'PATCH', '/v1/datasets/pricing-golden?project_slug=pa', { description: 'Held-out pricing questions with a rather long description to make the card taller' });
  await put('mgr', 'pricing-golden', 'restricted', [{ user_id: 'mem2', level: 'modify' }]);
  for (const w of WIDTHS) {
    for (const who of ['mgr', 'mem2', 'mem3']) {
      const { ctx, page } = await open(who, w, P, '[data-testid="da-card-badges"], [data-testid="da-card-head"]');
      const r: any = await page.evaluate(`(() => { const cards=[...document.querySelectorAll('[data-testid="da-card-head"]')]; return cards.map(h=>{ const n=h.querySelector('[data-testid="da-card-name"]'); const b=h.querySelector('[data-testid="da-card-badges"]'); const br=b&&b.getBoundingClientRect(); const hr=h.getBoundingClientRect(); const nr=n.getBoundingClientRect(); const cs=getComputedStyle(n); return { name:n.textContent, nameW:+nr.width.toFixed(1), te:cs.textOverflow, clip:n.scrollWidth>n.clientWidth+1, headH:+hr.height.toFixed(1), headW:+hr.width.toFixed(1), badgesW:br?+br.width.toFixed(1):null, badges:b?[...b.children].map(x=>x.textContent+':'+x.getBoundingClientRect().width.toFixed(1)+'x'+x.getBoundingClientRect().height.toFixed(1)):[], br: br? { y:+br.y.toFixed(1), headY:+hr.y.toFixed(1)} : null }; }); })()`);
      const sc = await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
      out[`catalog-${who}-${w}`] = { noHScroll: sc, cards: r };
      console.log('catalog', who, w, JSON.stringify(out[`catalog-${who}-${w}`]));
      if (who === 'mgr' || who==='mem3') await shot(page, `catalog-${who}`, w);
      await ctx.close();
    }
  }
}
if (stage === 'settings' || stage === 'all') {
  const three = [{ user_id: 'mem', level: 'modify' }, { user_id: 'mem2', level: 'view' }, { user_id: 'mem3', level: 'view' }];
  for (const [label, mode, grants] of [['project', 'project', []], ['three', 'restricted', three], ['empty', 'restricted', []]] as any) {
    await put('mgr', 'support-faq', mode, grants);
    for (const w of WIDTHS) {
      const { ctx, page } = await open('mgr', w, `${P}/support-faq?tab=settings`, '[data-testid="access-section"]');
      const b = await boxes(page, ['access-section', 'access-mode', 'access-grants-table', 'access-add', 'access-save-bar', 'access-empty-note', 'access-people']);
      const rows = await page.evaluate(`[...document.querySelectorAll('[data-testid="access-mode"] [role="radio"]')].map(r=>+r.getBoundingClientRect().height.toFixed(1))`);
      b['radios'] = rows; b['noHScroll'] = await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
      out[`settings-${label}-${w}`] = b; console.log('settings', label, w, JSON.stringify(b));
      if (label !== 'empty') await shot(page, `settings-${label}`, w);
      await ctx.close();
    }
  }
  await put('mgr', 'support-faq', 'restricted', [{ user_id: 'mem', level: 'modify' }, { user_id: 'mem2', level: 'view' }]);
  for (const who of ['mem2', 'mem']) for (const w of [1440, 390]) {
    const { ctx, page } = await open(who, w, `${P}/support-faq?tab=settings`, '[data-testid="access-section"]');
    const b = await boxes(page, ['access-section', 'access-summary', 'access-grants-table']);
    b['txt'] = await page.evaluate(`document.querySelector('[data-testid="access-section"]')?.innerText.slice(0,400)`);
    b['inputs'] = await page.evaluate(`document.querySelectorAll('[data-testid="access-section"] button, [data-testid="access-section"] [role="radio"], [data-testid="access-section"] select').length`);
    console.log('settings-ro', who, w, JSON.stringify(b)); out[`settings-ro-${who}-${w}`] = b;
    if (who==='mem2') await shot(page, 'settings-readonly', w);
    await ctx.close();
  }
}
if (stage === 'viewer' || stage === 'all') {
  await put('mgr', 'support-faq', 'restricted', [{ user_id: 'mem', level: 'modify' }, { user_id: 'mem2', level: 'view' }]);
  for (const w of WIDTHS) {
    for (const [who, tab] of [['mem2', ''], ['mem3', '']] as any) {
      const { ctx, page } = await open(who, w, `${P}/support-faq`, '[data-testid="view-only-badge"], [data-testid="da-403"]');
      const b = await boxes(page, ['view-only-badge', 'da-403']);
      b['title'] = await page.title();
      b['txt'] = await page.evaluate(`document.body.innerText.slice(0,500).replace(/\\n+/g,' | ')`);
      console.log('viewer', who, w, JSON.stringify(b)); out[`viewer-${who}-${w}`] = b;
      await shot(page, `viewer-${who}`, w);
      await ctx.close();
    }
  }
  // viewer items tab
  for (const w of [1440, 1024, 390]) {
    const { ctx, page } = await open('mem2', w, `${P}/support-faq?v=v2&tab=items`, '[data-testid="items-state"]');
    const info = await page.evaluate(`({ addItem: !!document.querySelector('[data-testid="add-item"]'), allMatching: !!document.querySelector('[data-testid="all-matching"]'), checkboxes: document.querySelectorAll('input[type=checkbox]').length, meta: !!document.querySelector('[data-testid="metadata-filter"]'), state: !!document.querySelector('[data-testid="items-state"]'), publish: !!document.querySelector('[data-testid="publish"]'), createDraft: !!document.querySelector('[data-testid="create-draft"]') })`);
    console.log('viewer-items', w, JSON.stringify(info)); out[`viewer-items-${w}`] = info; await shot(page, 'viewer-items', w); await ctx.close();
  }
  const net: string[] = [];
  const { ctx, page } = await (async () => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': 'mem3@x.com' } }); const page = await ctx.newPage(); page.on('request', (r: any) => { if (r.url().includes('/v1/') || r.url().includes('/api/')) net.push(r.method() + ' ' + r.url().replace(BASE, '')); }); await page.goto(BASE + `${P}/support-faq?item=faq-001`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500); return { ctx, page }; })();
  console.log('403 item url requests', JSON.stringify(net.filter((n) => /datasets/.test(n)))); await ctx.close();
}
await browser.close();
console.log('JSON', JSON.stringify(out).length);
