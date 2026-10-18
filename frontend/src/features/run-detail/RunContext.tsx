/** One context for everything the run page sections read (run, model, view, live, filtered items). */
import { createContext, useContext } from 'react';
import type { LiveRunState } from './hooks/useLiveRun';
import type { RunViewApi } from './hooks/useRunView';
import type { FilteredItem } from './lib/filterRules';
import type { RunModel } from './lib/runModel';
import type { NeighborsPayload, PassSummary, RowGroup, RunPayload } from './types';

export interface RunPageValue {
  slug: string;
  runId: string;
  payload: RunPayload;
  model: RunModel;
  api: RunViewApi;
  live: LiveRunState;
  passSummary: PassSummary | null;
  /** Rows after every filter (page, rules, search, sort). */
  items: FilteredItem[];
  readOnly: boolean;
  scoresLocked: boolean;
  /** Path of this run without the query string. */
  basePath: string;
  /** From the run summary: how many review events there are (0 = no review-history request) and the pager's neighbours (default list order). */
  reviewEventCount: number | undefined;
  /** The summary (stage 1) has not answered yet. */
  summaryPending: boolean;
  summaryNeighbors: NeighborsPayload | null | undefined;
  /** Stage 2 has not answered yet: the payload is the run header (summary or list row) with no rows. */
  rowsPending: boolean;
  /** Whether the rows carry a group (always true for a payload loaded without `fields`). */
  hasGroup: (group: RowGroup) => boolean;
  /** Ask for a late group; idempotent. The rows gain the group when it arrives (`hasGroup` turns true). */
  needGroup: (group: RowGroup) => void;
}

export const RunContext = createContext<RunPageValue | null>(null);

export function useRunPage(): RunPageValue {
  const value = useContext(RunContext);
  if (!value) throw new Error('useRunPage must be used under <RunDetailPage>');
  return value;
}
