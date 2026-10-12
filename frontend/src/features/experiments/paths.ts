/** URL builders for this area (the route contract lives in app/routes.ts). */
import { projectPath } from '@/app/routes';

export const experimentsPath = (slug: string) => projectPath(slug, 'experiments');
export const experimentPath = (slug: string, id: string) => projectPath(slug, `experiments/${encodeURIComponent(id)}`);
export const queuePath = (slug: string, query: Record<string, string | undefined> = {}) =>
  withQuery(projectPath(slug, 'experiments/queue'), query);
export const launchPath = (slug: string, query: Record<string, string | undefined> = {}) =>
  withQuery(projectPath(slug, 'experiments/new'), query);
export const environmentsPath = (slug: string) => projectPath(slug, 'environments');
export const environmentPath = (slug: string, envId: string) => projectPath(slug, `environments/${encodeURIComponent(envId)}`);
export const defaultPresetEditPath = (slug: string, envId: string, query: Record<string, string | undefined> = {}) =>
  withQuery(projectPath(slug, `environments/${encodeURIComponent(envId)}/default-preset/edit`), query);

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
