import { alignToElement, focusSectionHeading } from '@/lib/scrollToElement';

export type SectionKey =
  'runs' | 'averages' | 'overview' | 'categories' | 'steps' | 'errors' | 'root-cause' | 'items';

export const sectionDomId = (key: SectionKey) => `compare-${key}`;

/** `focus`: a section link was pressed, so keyboard focus moves to the section heading too (C091). */
export function scrollToSection(key: SectionKey, focus = false): void {
  const el = document.getElementById(sectionDomId(key));
  if (!el) return;
  alignToElement(el);
  if (focus) focusSectionHeading(el);
}
