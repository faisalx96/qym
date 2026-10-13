/** localStorage/sessionStorage with the legacy key names, safe in private mode. */
export const KEYS = {
  sidebarCollapsed: 'qym:sidebar-collapsed',
  lastProjectSlug: 'qym:last-project-slug',
  me: 'qym:me',
  dataTableWidths: (storageKey: string) => `qym:data-table:widths:${storageKey}`,
  /** DataTable v2: widths, hidden, pins, density, collapsed groups. */
  dataTableState: (storageKey: string) => `qym:data-table:v2:${storageKey}`,
  textMode: 'qym.textMode',
  singleKeyShortcuts: 'qym:single-key-shortcuts',
} as const;

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readLocal(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeLocal(key, JSON.stringify(value));
}
