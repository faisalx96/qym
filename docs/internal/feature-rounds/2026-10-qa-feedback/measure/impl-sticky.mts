/** QA5-44: the save bar's bottom edge equals the scroll host's bottom edge with 12 grants at a 900 px viewport. */
import { launch, newPage, datasetUrl, save } from './lib-qa.mts';
const b = await launch();
const out: Record<string, unknown> = {};
for (const w of [1440, 1024, 390]) {
  const { ctx, page } = await newPage(b, w, 900);
  await page.goto(datasetUrl('legal-clauses', 'access'));
  await page.waitForSelector('[data-testid=access-save-bar]');
  await page.waitForTimeout(500);
  out[w] = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid=access-save-bar]') as HTMLElement;
    let host: HTMLElement | null = bar.parentElement;
    while (host && !(host.scrollHeight > host.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(host).overflowY))) host = host.parentElement;
    if (!host) return { host: null };
    const hr = host.getBoundingClientRect();
    const at = (top: number) => { host!.scrollTop = top; const r = bar.getBoundingClientRect(); return +(hr.bottom - r.bottom).toFixed(2); };
    const res = { host: host.tagName + '.' + host.className.slice(0, 30), hostH: hr.height, scrollH: host.scrollHeight, top: at(0), mid: at(200), end: at(host.scrollHeight), pos: getComputedStyle(bar).position, barH: bar.getBoundingClientRect().height };
    return res;
  });
  await ctx.close();
}
save('impl-sticky', out);
console.log(JSON.stringify(out));
await b.close();
