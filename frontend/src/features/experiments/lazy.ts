/**
 * The launch form and the detail page, fetched on first visit (C081): the list route then loads only its table.
 * The router's lazy pages and the "New experiment" prefetch share these imports (`once`, so the CSS is waited for).
 */
import { once } from '@/lib/once';

export const loadLaunchPage = once(() => import('./launch/LaunchPage'));
export const loadExperimentDetailPage = once(() => import('./detail/ExperimentDetailPage'));
