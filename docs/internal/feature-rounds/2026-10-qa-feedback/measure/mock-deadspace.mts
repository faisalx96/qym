/** Mock Settings: card top to title text, header height, footer height, description lines. */
import { launch, newPage, save, VITE, WIDTHS } from './lib-qa.mts';
const b = await launch(); const res: Record<string, unknown> = {};
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w);
  await page.goto(`${VITE}/__ui#qa-datasets`); await page.waitForSelector('[data-testid=settings-layout]'); await page.waitForTimeout(800);
  res[w] = await page.evaluate(() => {
    const s = document.querySelector('[data-testid=settings-layout][data-variant=editable]')!; const out: Record<string, unknown> = {};
    for (const t of ['general', 'visibility', 'danger']) {
      const card = s.querySelector(`[data-testid=settings-${t}]`)!; const h = card.querySelector('h2')!; const desc = card.querySelector('[data-testid=card-head] p') as HTMLElement | null;
      const header = card.querySelector('[class*=header]') as HTMLElement | null; const footer = card.querySelector('[class*=footer]') as HTMLElement | null;
      out[t] = { titleTop: +(h.getBoundingClientRect().top - card.getBoundingClientRect().top).toFixed(1), titleH: +h.getBoundingClientRect().height.toFixed(1), headerH: header ? +header.getBoundingClientRect().height.toFixed(1) : null, footerH: footer ? +footer.getBoundingClientRect().height.toFixed(1) : null, descH: desc ? +desc.getBoundingClientRect().height.toFixed(1) : null, descTruncated: desc ? desc.scrollWidth > desc.clientWidth : null };
    }
    const rows = [...s.querySelectorAll('[data-testid=settings-general] [role=group]')].map((r) => +r.getBoundingClientRect().height.toFixed(1));
    out.rows = rows;
    return out;
  });
  await ctx.close();
}
save('mock-deadspace', res); console.log(JSON.stringify(res));
await b.close();
