/** Geometry of the QA-A mocks at 1440 / 1024 / 390 (the numbers the spec quotes). Writes out/mock-<width>.json. */
import { launch, newPage, save, VITE, WIDTHS } from './lib-qa.mts';
const b = await launch();
for (const w of WIDTHS) {
  const { ctx, page } = await newPage(b, w, 900);
  await page.goto(`${VITE}/__ui#qa-datasets`);
  await page.waitForSelector('[data-case^="qa-"]');
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const r1 = (n: number) => +n.toFixed(1);
    const box = (e: Element | null) => (e ? { x: r1(e.getBoundingClientRect().x), y: r1(e.getBoundingClientRect().y + scrollY), w: r1(e.getBoundingClientRect().width), h: r1(e.getBoundingClientRect().height) } : null);
    const q = (root: ParentNode, s: string) => root.querySelector(s);
    const out: Record<string, unknown> = {};
    // QA1 popovers
    const pops: Record<string, unknown> = {};
    document.querySelectorAll('[data-case^="qa-filter-popover"] [data-facet-state]').forEach((p) => {
      const rows = [...p.querySelectorAll('[role=option]')];
      pops[p.getAttribute('data-facet-state')!] = {
        popover: box(p), select: box(q(p, 'button[aria-haspopup]')), valuesHead: box(q(p, '[class*=valuesHead]')), list: box(q(p, '[data-testid=facet-values]')),
        row: box(rows[0] ?? null), rows: rows.length, match: box(q(p, '[data-testid=meta-match]')), matchRow: box(q(p, '[class*=matchRow]')),
        control: box(q(p, '[data-testid=meta-match] [role=radiogroup]')), help: box(q(p, '[data-testid=meta-match-help]')), foot: box(q(p, '[class*=popoverFoot]')),
        helpText: q(p, '[data-testid=meta-match-help]')?.textContent ?? null, scrollOverflow: (p as HTMLElement).scrollWidth > (p as HTMLElement).clientWidth,
      };
    });
    out.popovers = pops;
    const chipBlocks = [...document.querySelectorAll('[data-case^="qa-filter-chips"] [data-testid=filter-chips]')];
    out.chips = chipBlocks.map((c) => ({ box: box(c), items: [...c.children].map((ch) => ({ t: ch.textContent, ...box(ch)! })) }));
    out.tabs = [...document.querySelectorAll('[data-case^="qa-tabs"] [role=tablist]')].map((t) => ({ box: box(t), tabs: [...t.querySelectorAll('[role=tab]')].map((x) => ({ t: x.textContent, ...box(x)! })) }));
    // QA5 settings
    const settings: Record<string, unknown> = {};
    document.querySelectorAll('[data-testid=settings-layout]').forEach((s) => {
      const g = q(s, '[data-testid=settings-general]'), v = q(s, '[data-testid=settings-visibility]'), d = q(s, '[data-testid=settings-danger]');
      const labels = [...(g?.querySelectorAll('[role=group]') ?? [])].map((x) => ({ x: box(x.firstElementChild)!, body: box(x.children[1])! }));
      const inputs = [...(g?.querySelectorAll('input, textarea') ?? [])].map((x) => box(x)!);
      settings[s.getAttribute('data-variant')!] = { layout: box(s), general: box(g), visibility: box(v), danger: box(d), head: box(q(g!, '[data-testid=card-head]')), labels, inputs,
        gapSide: v && d ? r1(d.getBoundingClientRect().top - v.getBoundingClientRect().bottom) : null,
        gapCols: g && (v || d) ? r1(((v ?? d)!.getBoundingClientRect().left) - g.getBoundingClientRect().right) : null,
        columns: getComputedStyle(q(s, '[class*=settingsGrid]')!).gridTemplateColumns };
    });
    out.settings = settings;
    // QA5 access
    const access: Record<string, unknown> = {};
    document.querySelectorAll('[data-testid=access-tab]').forEach((t) => {
      const st = t.getAttribute('data-access-state')!;
      const ppl = q(t, '[data-testid=access-people]');
      const table = q(t, '[data-testid=access-grants-table]');
      const ths = [...(table?.querySelectorAll('[role=columnheader], th') ?? [])].map((x) => ({ t: x.textContent, w: r1(x.getBoundingClientRect().width) }));
      const rowEls = [...(table?.querySelectorAll('[role=row]') ?? [])].filter((x) => !x.querySelector('[role=columnheader]'));
      const radios = [...t.querySelectorAll('[data-testid=access-mode] [role=radio]')];
      access[st] = {
        tab: box(t), modeCard: box(q(t, '[data-testid=access-mode-card]')), head: box(q(t, '[data-testid=card-head]')), radiogroup: box(q(t, '[data-testid=access-mode]')), radios: radios.map((x) => box(x)),
        summary: box(q(t, '[data-testid=access-summary]')), always: box(q(t, '[data-testid=access-always]')), people: box(ppl), add: box(q(t, '[data-testid=access-add]')),
        addSelect: box(q(t, '[data-testid=access-add] button[aria-haspopup]')), table: box(table), ths, rows: rowEls.length, row0: box(rowEls[0] ?? null), rowLast: box(rowEls[rowEls.length - 1] ?? null),
        empty: box(q(t, '[data-testid=access-empty-note]')), save: box(q(t, '[data-testid=access-save-bar]')), status: q(t, '[data-part=status]')?.textContent ?? null,
        gapCards: ppl && q(t, '[data-testid=access-mode-card]') ? r1(ppl.getBoundingClientRect().top - q(t, '[data-testid=access-mode-card]')!.getBoundingClientRect().bottom) : null,
        overflowX: (t as HTMLElement).scrollWidth > (t as HTMLElement).clientWidth,
        stickyPos: q(t, '[data-testid=access-save-bar]') ? getComputedStyle(q(t, '[data-testid=access-save-bar]')!).position : null,
      };
    });
    out.access = access;
    out.dialog = box(q(document, '[data-testid=access-leave-dialog]'));
    return out;
  });
  save(`mock-${w}`, data);
  await ctx.close();
}
await b.close();
console.log('ok');
