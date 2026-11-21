/** /projects/:slug/factory[/:factoryId] URL contract: the list of connected datasets, or one factory and its tab. */
export type FactoryTab = 'rules' | 'categories' | 'generation' | 'access' | 'settings';
export const FACTORY_TABS: FactoryTab[] = ['rules', 'categories', 'generation', 'access', 'settings'];

export interface FactoryRoute {
  mode: 'list' | 'detail';
  factoryId: string | null;
  tab: FactoryTab;
}

export function parseFactoryRoute(splat: string | undefined, params: URLSearchParams): FactoryRoute {
  const rest = (splat ?? '').replace(/^\/+|\/+$/g, '');
  const tabRaw = params.get('tab') ?? '';
  const tab = (FACTORY_TABS.includes(tabRaw as FactoryTab) ? tabRaw : 'rules') as FactoryTab;
  if (!rest) return { mode: 'list', factoryId: null, tab };
  let factoryId = rest.split('/')[0]!;
  try {
    factoryId = decodeURIComponent(factoryId);
  } catch {
    /* keep the raw segment */
  }
  return { mode: 'detail', factoryId, tab };
}

export function factoryPath(slug: string, factoryId?: string, tab?: FactoryTab): string {
  const base = `/projects/${encodeURIComponent(slug)}/factory`;
  if (!factoryId) return base;
  return `${base}/${encodeURIComponent(factoryId)}${tab && tab !== 'rules' ? `?tab=${tab}` : ''}`;
}
