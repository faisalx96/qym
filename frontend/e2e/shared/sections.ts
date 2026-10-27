/// <reference lib="dom" />
/**
 * Round 8b (owner decision H6): geometry readers and the shared assertions of the framed-section criteria
 * C-sec-1..6 and C-sec-A1..A6, used by compare/r8b-sections.spec.ts and run-detail/r8b-sections.spec.ts.
 */
import { expect, type Page } from '@playwright/test';

export interface SectionInfo {
  id: string;
  tag: string;
  part: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  bottom: number;
  bg: string;
  borderWidths: number[];
  borderColors: string[];
  radius: number;
  padding: number[];
  marginTop: number;
  headFirst: boolean;
  headBorderBottom: number;
  headBodyGap: number;
  bodyBottom: number;
  titleTop: number;
  titleTag: string;
  titleSize: number;
  titleWeight: string;
  descTag: string | null;
  descLines: number;
  descEllipsis: boolean;
  descColor: string | null;
  ruleCount: number;
}

/** Computed colour of a design token (resolved through a probe element, so `var()` chains are followed). */
export async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
}

export async function readSections(page: Page): Promise<SectionInfo[]> {
  return page.evaluate(() => {
    const px = (v: string) => parseFloat(v) || 0;
    return Array.from(document.querySelectorAll<HTMLElement>('[data-report-section]')).map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const head = el.querySelector<HTMLElement>(':scope > [data-part=section-head]');
      const body = head?.nextElementSibling as HTMLElement | null;
      const title = el.querySelector<HTMLElement>(':scope > [data-part=section-head] h2');
      const desc = el.querySelector<HTMLElement>(':scope > [data-part=section-head] p');
      const tcs = title ? getComputedStyle(title) : null;
      const dcs = desc ? getComputedStyle(desc) : null;
      const line = dcs ? px(dcs.lineHeight) || px(dcs.fontSize) * 1.3 : 0;
      return {
        id: el.id,
        tag: el.tagName,
        part: el.getAttribute('data-part'),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        bottom: r.bottom,
        bg: cs.backgroundColor,
        borderWidths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(
          px,
        ),
        borderColors: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
        radius: px(cs.borderTopLeftRadius),
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
        marginTop: px(cs.marginTop),
        headFirst: el.firstElementChild === head,
        headBorderBottom: head ? px(getComputedStyle(head).borderBottomWidth) : -1,
        headBodyGap:
          head && body ? body.getBoundingClientRect().top - head.getBoundingClientRect().bottom : -1,
        bodyBottom: body ? body.getBoundingClientRect().bottom : 0,
        titleTop: title ? title.getBoundingClientRect().top : 0,
        titleTag: title?.tagName ?? '',
        titleSize: tcs ? px(tcs.fontSize) : 0,
        titleWeight: tcs?.fontWeight ?? '',
        descTag: desc?.tagName ?? null,
        descLines: desc && line ? Math.round(desc.getBoundingClientRect().height / line) : 0,
        descEllipsis: dcs ? dcs.textOverflow === 'ellipsis' : false,
        descColor: dcs?.color ?? null,
        ruleCount: el.querySelectorAll('[data-part=section-rule]').length,
      };
    });
  });
}

const near = (a: number, b: number, tol: number, what: string) =>
  expect(Math.abs(a - b), `${what}: ${a} vs ${b} +-${tol}`).toBeLessThanOrEqual(tol);

/** C-sec-1: every top-level section is a `section[data-report-section]` with a head first; no CompareSection leftovers. */
export function assertOnePrimitive(sections: SectionInfo[], expectedIds: string[]): void {
  expect(sections.map((s) => s.id)).toEqual(expectedIds);
  for (const s of sections) {
    expect(s.tag, `${s.id} tag`).toBe('SECTION');
    expect(s.headFirst, `${s.id}: head is the first child`).toBe(true);
    expect(s.titleTag, `${s.id} title`).toBe('H2');
    expect(s.part, `${s.id} data-part`).toBeTruthy();
  }
}

/** C-sec-2 / C-sec-A3: title 18/650, one muted description (one line at >= 1024, never an ellipsis), head inside, no rule. */
export function assertHeads(sections: SectionInfo[], width: number): void {
  for (const s of sections) {
    expect(s.titleSize, `${s.id} title size`).toBe(18);
    expect(Number(s.titleWeight), `${s.id} title weight`).toBe(650);
    expect(s.descTag, `${s.id} description`).toBe('P');
    expect(s.descEllipsis, `${s.id} description ellipsis`).toBe(false);
    if (width >= 1024) expect(s.descLines, `${s.id} description lines at ${width}`).toBeLessThanOrEqual(2);
    expect(s.headBorderBottom, `${s.id} head border`).toBe(0);
    near(s.headBodyGap, 14, 1, `${s.id} head to body`);
    expect(s.ruleCount, `${s.id} section-rule`).toBe(0);
  }
}

/** C-sec-A1 / C-sec-6: the panel is --bg-surface, 1px --border-subtle, 8px radius, 14px padding, the column wide. */
export async function assertPanels(page: Page, sections: SectionInfo[]): Promise<void> {
  const surface = await tokenColor(page, '--bg-surface');
  const subtle = await tokenColor(page, '--border-subtle');
  const column = sections[0]!.w;
  for (const s of sections) {
    expect(s.bg, `${s.id} fill`).toBe(surface);
    expect(s.borderWidths, `${s.id} border widths`).toEqual([1, 1, 1, 1]);
    expect(s.borderColors, `${s.id} border colours`).toEqual([subtle, subtle, subtle, subtle]);
    expect(s.radius, `${s.id} radius`).toBe(8);
    expect(s.padding, `${s.id} padding`).toEqual([14, 14, 14, 14]);
    near(s.w, column, 1, `${s.id} width equals the column`);
  }
}

/** C-sec-3 / C-sec-A2: 20 px between panels, 48 from the last body pixel to the next title top, no lead-in on the first. */
export function assertRhythm(sections: SectionInfo[]): void {
  expect(sections[0]!.marginTop, 'first section lead-in').toBe(0);
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1]!;
    const cur = sections[i]!;
    near(cur.y - prev.bottom, 20, 1, `edge gap ${prev.id} to ${cur.id}`);
    near(cur.titleTop - prev.bodyBottom, 14 + 1 + 20 + 1 + 14, 1, `body end to title ${cur.id}`);
  }
}

/** Inset cards (C-sec-A4): nothing inside a panel body paints --bg-surface behind a visible outline (no nested card). */
export async function nestedCards(page: Page): Promise<string[]> {
  const surface = await tokenColor(page, '--bg-surface');
  return page.evaluate((surfaceColor) => {
    const out: string[] = [];
    for (const body of Array.from(
      document.querySelectorAll<HTMLElement>('[data-report-section] > div:last-child'),
    )) {
      for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
        const cs = getComputedStyle(el);
        if (cs.backgroundColor !== surfaceColor) continue;
        const visible = [
          [cs.borderTopWidth, cs.borderTopColor],
          [cs.borderRightWidth, cs.borderRightColor],
          [cs.borderBottomWidth, cs.borderBottomColor],
          [cs.borderLeftWidth, cs.borderLeftColor],
        ].some(([w, c]) => parseFloat(w!) > 0 && c !== 'rgba(0, 0, 0, 0)' && !c!.endsWith(', 0)'));
        if (visible && el.offsetWidth > 24 && el.offsetHeight > 16) {
          out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-part') ?? el.className}]`);
        }
      }
    }
    return out;
  }, surface);
}

/** The computed fill and outline of an element (inset-card check). */
export async function fillAndEdge(
  page: Page,
  selector: string,
): Promise<{ bg: string; edgeColors: string[]; edgeWidths: number[] }> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      // the inline-start rail is the meaning rail (3px, tone colour); the other three sides are the outline
      const sides = ['Top', 'Right', 'Bottom'] as const;
      return {
        bg: cs.backgroundColor,
        edgeColors: sides.map((s) => cs.getPropertyValue(`border-${s.toLowerCase()}-color`)),
        edgeWidths: sides.map((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`))),
      };
    });
}

export async function noSideways(page: Page): Promise<void> {
  const [sw, cw] = await page.locator('#shell-content').evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw, 'shell scrollWidth').toBeLessThanOrEqual(cw);
}

/**
 * Round 8b fix pass: every visible descendant of a panel stays inside the panel's content box (border and 14 px padding
 * excluded). Elements clipped or scrolled by an ancestor inside the panel (a table scroller, a visually hidden label) are
 * not drawn outside, so they are skipped. Returns one line per offender.
 */
export async function outsideContentBox(page: Page, tolerance = 1): Promise<string[]> {
  return page.evaluate((tol) => {
    const out: string[] = [];
    for (const panel of Array.from(document.querySelectorAll<HTMLElement>('[data-report-section]'))) {
      const pr = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const left = pr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const right = pr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      for (const el of Array.from(panel.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
        if (style.clip !== 'auto' || style.clipPath !== 'none') continue; // visually hidden labels
        let clipped = false;
        for (let a = el.parentElement; a && a !== panel; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (o.overflowX !== 'visible' || o.clipPath !== 'none') {
            const ar = a.getBoundingClientRect();
            if (ar.width <= 2 || (ar.left >= left - tol && ar.right <= right + tol)) clipped = true; // a 1 px visually hidden host clips its content
            break;
          }
        }
        if (clipped) continue;
        if (r.right > right + tol || r.left < left - tol) {
          out.push(
            `${panel.id}: ${el.parentElement?.tagName.toLowerCase()}.${String(el.parentElement?.className).slice(0, 24)} > ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${(el.textContent ?? '').slice(0, 12)}" ${Math.round(r.left)}-${Math.round(r.right)} (box ${Math.round(left)}-${Math.round(right)})`,
          );
        }
      }
    }
    return out.slice(0, 20);
  }, tolerance);
}
