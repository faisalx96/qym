/** Current Settings: card top to the title text (dead space), label to field geometry, description truncation. */
import { launch, newPage, datasetUrl, save, WIDTHS } from './lib-qa.mts';
const b = await launch(); const res: Record<string, unknown> = {};
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w);
  await page.goto(datasetUrl('support-faq', 'settings')); await page.waitForSelector('[data-testid=access-section]'); await page.waitForTimeout(800);
  res[w] = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (const id of ['ds-general', 'ds-visibility', 'ds-access', 'ds-danger']) {
      const title = document.getElementById(id)!; const card = title.closest('section')!;
      const desc = title.parentElement!.querySelector('p') as HTMLElement | null;
      out[id] = { cardTop: +card.getBoundingClientRect().top.toFixed(1), titleTop: +(title.getBoundingClientRect().top - card.getBoundingClientRect().top).toFixed(1), titleH: +title.getBoundingClientRect().height.toFixed(1), descTruncated: desc ? desc.scrollWidth > desc.clientWidth : null, descH: desc ? +desc.getBoundingClientRect().height.toFixed(1) : null };
    }
    const label = document.querySelector('[data-dataset-settings] label')!; const input = document.querySelector('[data-dataset-settings] input')!;
    out.labelAbove = label.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1;
    return out;
  });
  await ctx.close();
}
save('current-deadspace', res); console.log(JSON.stringify(res));
await b.close();
