/** URL state and grouping of the Feedback list (QE-13, QE-15, QE-17). */
import type { FeedbackListParams, FeedbackRow } from '@/api/feedback';

export const PAGE_SIZE = 50;

export interface ListView {
  status: string[];
  about: string[];
  project: string[];
  priority: string[];
  complexity: string[];
  q: string;
  mine: boolean;
  sort: string;
  page: number;
}

const split = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function viewFromParams(p: URLSearchParams): ListView {
  return {
    status: split(p.get('status')),
    about: split(p.get('about')),
    project: split(p.get('project')),
    priority: split(p.get('priority')),
    complexity: split(p.get('complexity')),
    q: p.get('q') ?? '',
    mine: p.get('mine') === '1',
    sort: p.get('sort') ?? 'created_at:desc',
    page: Math.max(1, Number(p.get('page') ?? '1') || 1),
  };
}

export function apiParams(view: ListView): FeedbackListParams {
  return {
    status: view.status.join(','),
    about: view.about.join(','),
    project_id: view.project.join(','),
    priority: view.priority.join(','),
    complexity: view.complexity.join(','),
    q: view.q,
    mine: view.mine,
    sort: view.sort,
    page: view.page,
    page_size: PAGE_SIZE,
  };
}

export function activeFilterCount(view: ListView): number {
  return (
    [view.status, view.about, view.project, view.priority, view.complexity].filter((a) => a.length).length +
    (view.mine ? 1 : 0)
  );
}

export function isFiltered(view: ListView): boolean {
  return activeFilterCount(view) > 0 || Boolean(view.q);
}

/** Child rows by canonical row id, in the response order. */
export function childMap(children: Record<string, FeedbackRow[]>): Map<string, FeedbackRow[]> {
  return new Map(Object.entries(children));
}

export function metaLine(counts: { all: number; new: number; duplicate_pairs: number }): string[] {
  const out = [`${counts.all} ${counts.all === 1 ? 'request' : 'requests'}`, `${counts.new} new`];
  if (counts.duplicate_pairs)
    out.push(`${counts.duplicate_pairs} duplicate ${counts.duplicate_pairs === 1 ? 'pair' : 'pairs'}`);
  return out;
}

/** `sort` as the DataTable's SortState and back. */
export function sortToState(sort: string): { key: string; direction: 'asc' | 'desc' } {
  const [key, dir] = sort.split(':');
  return { key: key || 'created_at', direction: dir === 'asc' ? 'asc' : 'desc' };
}
