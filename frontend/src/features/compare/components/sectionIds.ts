import { alignToElement } from '@/lib/scrollToElement';

export type SectionKey =
  'runs' | 'averages' | 'overview' | 'categories' | 'steps' | 'errors' | 'root-cause' | 'items';

export const sectionDomId = (key: SectionKey) => `compare-${key}`;

export function scrollToSection(key: SectionKey): void {
  const el = document.getElementById(sectionDomId(key));
  if (el) alignToElement(el);
}
