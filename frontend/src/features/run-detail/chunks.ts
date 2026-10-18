/**
 * The run page's lazy chunks, each loaded through one shared promise (see `once`): the page starts the Overview and
 * the Items table early, in step with the rows request, and the Suspense boundaries that render them await the same promise.
 */
import { once } from '@/lib/once';

export const loadOverviewTab = once(() => import('./components/panels/OverviewTab'));
export const loadItemsSection = once(() => import('./components/ItemsSection'));
export const loadTraceHost = once(() => import('./components/TraceHost'));
