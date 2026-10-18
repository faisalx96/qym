/**
 * The run page's lazy chunks, each loaded through one shared promise (see `once`): the page starts the Overview and
 * the Items table early, in step with the rows request, the Suspense boundaries that render them await the same
 * promise, and `preloadPanels` fetches the rest once the Overview has painted (no scroll needed).
 */
import { once } from '@/lib/once';

export const loadOverviewTab = once(() => import('./components/panels/OverviewTab'));
export const loadItemsSection = once(() => import('./components/ItemsSection'));
export const loadTraceHost = once(() => import('./components/TraceHost'));
export const loadRepeatTab = once(() => import('./components/panels/RepeatTab'));
export const loadLatencyTab = once(() => import('./components/panels/LatencyTab'));
export const loadDeepTab = once(() => import('./components/panels/DeepTab'));
export const loadCategoriesTab = once(() => import('./components/panels/CategoriesTab'));
export const loadErrorsTab = once(() => import('./components/panels/ErrorsTab'));
export const loadRootCauseTab = once(() => import('./components/panels/RootCauseTab'));

/** Every panel chunk, one after the other in page order (they share the link with the data requests). */
export function preloadPanels(): void {
  void loadOverviewTab()
    .then(loadCategoriesTab)
    .then(loadErrorsTab)
    .then(loadItemsSection)
    .then(loadLatencyTab)
    .then(loadDeepTab)
    .then(loadRepeatTab)
    .then(loadRootCauseTab)
    .then(loadTraceHost)
    .catch(() => undefined);
}
