/**
 * /projects/:slug/factory[/:factoryId] URL contract: the list of connected datasets, or one factory and its tab;
 * `?job=` opens one generation attempt inside the Generation tab.
 */
export type FactoryTab = 'rules' | 'categories' | 'generation' | 'access' | 'settings';
export const FACTORY_TABS: FactoryTab[] = ['rules', 'categories', 'generation', 'access', 'settings'];

export interface FactoryRoute {
  mode: 'list' | 'detail';
  factoryId: string | null;
  tab: FactoryTab;
  /** The generation attempt open in the Generation tab, else null. */
  jobId: string | null;
}

export function parseFactoryRoute(splat: string | undefined, params: URLSearchParams): FactoryRoute {
  const rest = (splat ?? '').replace(/^\/+|\/+$/g, '');
  const tabRaw = params.get('tab') ?? '';
  const tab = (FACTORY_TABS.includes(tabRaw as FactoryTab) ? tabRaw : 'rules') as FactoryTab;
  const jobId = tab === 'generation' ? params.get('job') || null : null;
  if (!rest) return { mode: 'list', factoryId: null, tab, jobId: null };
  let factoryId = rest.split('/')[0]!;
  try {
    factoryId = decodeURIComponent(factoryId);
  } catch {
    /* keep the raw segment */
  }
  return { mode: 'detail', factoryId, tab, jobId };
}

export function factoryPath(slug: string, factoryId?: string, tab?: FactoryTab, jobId?: string | null): string {
  const base = `/projects/${encodeURIComponent(slug)}/factory`;
  if (!factoryId) return base;
  const params = new URLSearchParams();
  if (tab && tab !== 'rules') params.set('tab', tab);
  if (tab === 'generation' && jobId) params.set('job', jobId);
  const qs = params.toString();
  return `${base}/${encodeURIComponent(factoryId)}${qs ? `?${qs}` : ''}`;
}
