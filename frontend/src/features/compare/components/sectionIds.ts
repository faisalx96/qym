import { alignToElement, cancelAlign, focusSectionHeading } from '@/lib/scrollToElement';
import { prefersReducedMotion, sectionScrollTop, smoothScrollTo } from '@/lib/smoothScroll';

export type SectionKey =
  'runs' | 'averages' | 'overview' | 'categories' | 'steps' | 'errors' | 'root-cause' | 'items';

export const sectionDomId = (key: SectionKey) => `compare-${key}`;

/**
 * `focus`: a section link was pressed, so keyboard focus moves to the section heading too (C091). `smooth` (a nav
 * click, cv4 Y10 as the run page): an eased travel to the section, then the re-alignment while late sections settle;
 * no motion under prefers-reduced-motion.
 */
export function scrollToSection(key: SectionKey, focus = false, smooth = false): void {
  const el = document.getElementById(sectionDomId(key));
  if (!el) return;
  if (focus) focusSectionHeading(el);
  const scroller = document.getElementById('shell-content');
  cancelAlign();
  if (!smooth || !scroller || prefersReducedMotion()) {
    alignToElement(el);
    return;
  }
  void smoothScrollTo(scroller, () => sectionScrollTop(scroller, el)).then((reached) => {
    if (reached) alignToElement(el);
  });
}
