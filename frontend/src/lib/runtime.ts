/**
 * Runtime bootstrap injected by the platform into index.html
 * (qym_platform/api/spa.py). In `vite dev` nothing is injected and the
 * defaults below apply (proxy to FastAPI on the same origin).
 */
export type AuthMode = 'none' | 'proxy_headers' | 'oidc' | 'saml' | string;

export interface AppBootstrap {
  /** URL prefix the platform is mounted under ("" or "/qym"). */
  rootPath: string;
  /** QYM_AUTH_MODE as configured. */
  authMode: AuthMode;
  /** True when a login page exists (oidc or local password auth). */
  sessionAuth: boolean;
  /** QYM_ENVIRONMENT (dev, test, production, …). */
  environment: string;
}

declare global {
  interface Window {
    __QYM_APP__?: Partial<AppBootstrap>;
    __QYM_ROOT_PATH__?: string;
  }
}

const DEFAULTS: AppBootstrap = { rootPath: '', authMode: 'none', sessionAuth: false, environment: 'dev' };

let cached: AppBootstrap | null = null;

export function bootstrap(): AppBootstrap {
  if (cached) return cached;
  const injected = typeof window !== 'undefined' ? (window.__QYM_APP__ ?? {}) : {};
  const rootPath = String(injected.rootPath ?? window?.__QYM_ROOT_PATH__ ?? DEFAULTS.rootPath).replace(
    /\/+$/,
    '',
  );
  cached = {
    rootPath,
    authMode: injected.authMode ?? DEFAULTS.authMode,
    sessionAuth: Boolean(injected.sessionAuth ?? DEFAULTS.sessionAuth),
    environment: injected.environment ?? DEFAULTS.environment,
  };
  return cached;
}

/** Test helper: reset the cached bootstrap (vitest only). */
export function _resetBootstrap(): void {
  cached = null;
}

/** The SPA lives under `{root}/app`. React Router basename. */
export function appBase(): string {
  return `${bootstrap().rootPath}/app`;
}

/** Absolute URL for an API/platform path ("/v1/me" → "/qym/v1/me"). */
export function platformUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${bootstrap().rootPath}${path}`;
}

/** Absolute URL for an in-app route ("/projects/x" → "/qym/app/projects/x"). */
export function appUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${appBase()}${path === '/' ? '' : path}` || '/';
}

export const isDev = import.meta.env.DEV;
