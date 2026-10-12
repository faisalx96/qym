/** One context for everything the run page sections read (run, model, view, live, filtered items). */
import { createContext, useContext } from 'react';
import type { LiveRunState } from './hooks/useLiveRun';
import type { RunViewApi } from './hooks/useRunView';
import type { FilteredItem } from './lib/filterRules';
import type { RunModel } from './lib/runModel';
import type { PassSummary, RunPayload } from './types';

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
}

export const RunContext = createContext<RunPageValue | null>(null);

export function useRunPage(): RunPageValue {
  const value = useContext(RunContext);
  if (!value) throw new Error('useRunPage must be used under <RunDetailPage>');
  return value;
}
