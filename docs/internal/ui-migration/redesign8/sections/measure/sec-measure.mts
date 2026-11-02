import { readFileSync, writeFileSync } from 'node:fs';
import { launch, newPage, cmpUrl, runUrl, sleep, warm, full, S } from './sec-lib.mts';
const D = '/home/meshari-aldossari/Documents/qym/qym-wt-redesign8-sections/docs/internal/ui-migration/redesign8/sections';
export const recipe = (r: string) => r === 'cur' ? '' : readFileSync(`${D}/measure/recipe-${r.toLowerCase()}.css`, 'utf8');
export async function apply(p: any, r: string) {
  await p.evaluate(() => { const s = [...document.querySelectorAll('section:is([data-report-section], :where(#run-items))')] as HTMLElement[]; s.forEach(e => e.removeAttribute('data-first')); s[0]?.setAttribute('data-first', ''); });
  if (r === 'cur') return;
  await p.addStyleTag({ content: recipe(r) });
  if (r === 'A') await p.evaluate(() => {
    const surf = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface').trim();
    const el = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim();
    const tmp = document.createElement('i'); document.body.append(tmp);
    tmp.style.background = surf; const sRGB = getComputedStyle(tmp).backgroundColor; tmp.remove();
    document.querySelectorAll('section:is([data-report-section], :where(#run-items))').forEach((sec) => {
      [...sec.children].slice(1).forEach(k => k.querySelectorAll('*').forEach((e: any) => { const cs = getComputedStyle(e); if (cs.backgroundColor === sRGB) { e.style.background = el; if (parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopWidth) === parseFloat(cs.borderBottomWidth)) e.style.borderColor = 'transparent'; } }));
    });
  });
  await sleep(400);
}
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const rgb = (s: string) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
export const ratio = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return +(((Math.max(x, y) + .05) / (Math.min(x, y) + .05))).toFixed(2); };
export async function boundaries(p: any) {
  const raw = await p.evaluate(() => {
    const scroller = document.getElementById('shell-content')!; const st = scroller.scrollTop;
    const secs = [...document.querySelectorAll('section:is([data-report-section], :where(#run-items))')] as HTMLElement[];
    const visible = (e: HTMLElement) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 3 && r.height > 3 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    const paints = (e: HTMLElement) => { const cs: any = getComputedStyle(e); if (['svg','IMG','CANVAS'].includes(e.tagName)) return true; if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())) return true; return (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || ['Top','Bottom'].some(s => cs['border'+s+'Width'] !== '0px' && cs['border'+s+'Style'] !== 'none'); };
    const lastPix = (s: HTMLElement) => { let m = 0; const body = s.lastElementChild as HTMLElement; body.querySelectorAll('*').forEach((e: any) => { if (visible(e) && paints(e)) m = Math.max(m, e.getBoundingClientRect().bottom); }); return m + st; };
    const shellBg = getComputedStyle(scroller).backgroundColor;
    const bg = shellBg !== 'rgba(0, 0, 0, 0)' ? shellBg : getComputedStyle(document.body).backgroundColor;
    return secs.map((s, i) => {
      const head = s.firstElementChild as HTMLElement; const t = s.querySelector('[id$="-title"]') as HTMLElement;
      const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect(), hcs = getComputedStyle(head), scs = getComputedStyle(s), tcs = getComputedStyle(t);
      const rule = (cs: CSSStyleDeclaration) => parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? { w: parseFloat(cs.borderTopWidth), c: cs.borderTopColor } : null;
      const prev = i ? secs[i - 1] : null; const d = head.querySelector('p');
      return { id: s.id, secTop: sr.top + st, titleTop: tr.top + st, titleH: tr.height, headH: head.getBoundingClientRect().height,
        prevLast: prev ? lastPix(prev) : null, rule: rule(scs) || rule(hcs) || (head.querySelector('[data-level=xl]') ? rule(getComputedStyle(head.querySelector('[data-level=xl]') as Element)) : null), titleSize: tcs.fontSize, titleW: tcs.fontWeight, panel: scs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? scs.backgroundColor : null,
        descSize: d ? getComputedStyle(d).fontSize : null, bg, secBottom: sr.bottom + st };
    });
  });
  return raw.map((r: any) => ({ ...r, gap: r.prevLast == null ? null : Math.round(r.titleTop - r.prevLast),
    ruleDesc: r.rule ? `${r.rule.w}px ${r.rule.c} (${ratio(r.rule.c, r.bg)}:1)` : 'none' }));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out: any = {};
  const b = await launch();
  for (const r of (process.env.RECIPES||'cur,A,B').split(',')) for (const w of [1440, 1024, 390]) for (const [n, u] of [['cmp', cmpUrl()], ['run', runUrl()]]) {
    const p = await newPage(b, w); await p.goto(u); await sleep(3500); await warm(p); await apply(p, r); await sleep(500);
    out[`${r}-${n}-${w}`] = await boundaries(p);
    await p.context().close();
  }
  writeFileSync(S + '/sec-measure-' + (process.env.RECIPES||'all') + '.json', JSON.stringify(out, null, 1));
  for (const k of Object.keys(out)) { console.log(k); for (const x of out[k]) console.log(' ', x.id.padEnd(22), 'gap', x.gap, 'rule', x.ruleDesc, 'title', x.titleSize + '/' + x.titleW, 'head', Math.round(x.headH), 'panel', x.panel); }
  await b.close();
}
