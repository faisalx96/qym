export type SectionKey =
  'runs' | 'averages' | 'overview' | 'categories' | 'steps' | 'errors' | 'root-cause' | 'items';

export const sectionDomId = (key: SectionKey) => `compare-${key}`;
