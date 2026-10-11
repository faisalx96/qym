/** Per-page lookups the cells need (links, model colours, metric types, owner labels). */
import { createContext, useContext } from 'react';
import type { MetricType } from '@/api/dashboardTypes';

export interface RunsCtxValue {
  slug: string;
  /** `?list=` context appended to run links ('' = default order). */
  listContext: string;
  metricTypes: Record<string, MetricType>;
  modelIndex: Record<string, number>;
  /** Owner id → label */
  owners: Record<string, string>;
}

export const EMPTY_CTX: RunsCtxValue = { slug: '', listContext: '', metricTypes: {}, modelIndex: {}, owners: {} };
export const RunsCtx = createContext<RunsCtxValue>(EMPTY_CTX);
export const useRunsCtx = () => useContext(RunsCtx);
