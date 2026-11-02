/**
 * Review (round 7): can the item bar be native `position: sticky`? Opens item j-01 of the seeded `jsonKeys` run (every output key open),
 * lists the bar's ancestors with their overflow / position / contain, then scrolls the page scroller (`#shell-content`) by 40 wheel notches of 40 px
 * and records, per rAF frame, the bar's top against a CSS-sticky control placed on the same sticky line (the compositor's truth), for
 *   shipped   the app as built (JS translate on the bar)
 *   v1        `[data-item-bar]` made `position: sticky; top: <line>` and the JS translate switched off (transform: none)
 *   v2        v1 and `overflow: visible` on the table's `[data-dt-scroller]` and its `.bodyHost` (what a sticky bar would need)
 *   v3        v2 and the sticky `detailHold` made static
 *   v2x       v2 plus a check of what it breaks: the table's own horizontal scroll (scrollWidth > clientWidth while overflow is visible)
 *   WIDTH=1440 node r7r-d1-sticky.mts
 */
import { BASE, r7, save, median, launch, newPage, STORAGE_INIT } from '../lib7.mts';

const WIDTH = Number(process.env.WIDTH ?? 1440);
const browser = await launch();
const out: Record<string, unknown> = {};
for (const variant of ['shipped', 'v1', 'v2', 'v3']) {
  const { page } = await newPage(browser, { width: WIDTH, height: 900, init: [STORAGE_INIT] });
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
  const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
  await card.waitFor();
  await card.getByRole('button', { name: 'Expand all output keys' }).click();
  await page.waitForTimeout(800);
  const chain = await page.evaluate(() => {
    const bar = document.querySelector('[data-item-bar]') as HTMLElement;
    const rows: Array<Record<string, string>> = [];
    for (let n: HTMLElement | null = bar; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.position === 'sticky' || cs.contain !== 'none' || cs.containerType !== 'normal')
        rows.push({ el: `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : ''}`, overflow: `${cs.overflowX}/${cs.overflowY}`, position: cs.position, contain: cs.contain, containerType: cs.containerType, scrollsY: String(n.scrollHeight > n.clientHeight + 1 && cs.overflowY !== 'visible'), scrollsX: String(n.scrollWidth > n.clientWidth + 1 && cs.overflowX !== 'visible') });
    }
    return rows;
  });
  const setup = await page.evaluate(({ v }) => {
    const sc = document.getElementById('shell-content')!;
    const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
    const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
    const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
    const f = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
    const line = Math.max(n, f);
    const bar = document.querySelector('[data-item-bar]') as HTMLElement;
    const dtScroller = bar.closest('[data-dt-scroller]') as HTMLElement | null;
    const host = dtScroller?.parentElement as HTMLElement | null;
    const hold = bar.closest('[class*=detailHold]') as HTMLElement | null;
    const st = document.createElement('style');
    let css = '';
    if (v !== 'shipped') css += `[data-item-bar]{position:sticky !important;top:${line - sc.getBoundingClientRect().top}px !important;transform:none !important}`;
    if (v === 'v2' || v === 'v3') css += `[data-dt-scroller]{overflow:visible !important}`;
    st.textContent = css;
    document.head.appendChild(st);
    if ((v === 'v2' || v === 'v3') && host) host.style.setProperty('overflow', 'visible', 'important');
    if (v === 'v3' && hold) hold.style.setProperty('position', 'static', 'important');
    const ctl = document.createElement('div');
    ctl.id = 'r7-ctl';
    ctl.style.cssText = `position:sticky;top:${line - sc.getBoundingClientRect().top}px;height:12px;width:40px;background:#0ff;z-index:60;pointer-events:none`;
    document.getElementById('run-items')!.insertBefore(ctl, document.getElementById('run-items')!.firstChild);
    const article = bar.closest('article') as HTMLElement;
    sc.scrollTop += article.getBoundingClientRect().top - line + 100; // the item starts 100 px above the line: the bar should be stuck from the first frame
    return { line, scrollsXWithVisible: dtScroller ? dtScroller.scrollWidth > dtScroller.clientWidth + 1 : null, hostOverflow: host ? getComputedStyle(host).overflow : null, tableW: dtScroller?.scrollWidth, tableClientW: dtScroller?.clientWidth };
  }, { v: variant });
  await page.waitForTimeout(400);
  await page.evaluate((line) => {
    const P = ((window as any).__s = { frames: [] as Array<{ bar: number; ctl: number; st: number }>, stop: false }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bar = document.querySelector('[data-item-bar]') as HTMLElement; const ctl = document.getElementById('r7-ctl')!; const sc = document.getElementById('shell-content')!;
    const tick = () => { if (P.stop) return; P.frames.push({ bar: bar.getBoundingClientRect().top - line, ctl: ctl.getBoundingClientRect().top - line, st: sc.scrollTop }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, setup.line);
  await page.mouse.move(Math.min(WIDTH / 2, 700), 500);
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(16); }
  await page.waitForTimeout(200);
  const frames = (await page.evaluate(() => { (window as any).__s.stop = true; return (window as any).__s.frames; })) as Array<{ bar: number; ctl: number; st: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const moving = frames.filter((f) => f.st !== frames[0]!.st);
  const err = moving.map((f) => Math.abs(f.bar - f.ctl));
  out[variant] = { setup, framesJudged: err.length, medianErrPx: Number(median(err).toFixed(2)), maxErrPx: Number(Math.max(0, ...err).toFixed(2)), framesOver1px: err.filter((e) => e > 1).length, ancestors: variant === 'shipped' ? chain : undefined };
  await page.close();
}
await browser.close();
save(`r7r-d1-sticky-${WIDTH}`, out);
