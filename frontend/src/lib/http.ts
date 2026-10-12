/**
 * One API client. Cookie auth, same origin, JSON in/out, typed failures,
 * and the 401 → login redirect (brief 01 §8.3). No bearer tokens.
 */
import { appUrl, bootstrap, platformUrl } from './runtime';

export type ErrorKind =
  'abort' | 'auth' | 'forbidden' | 'not_found' | 'server' | 'client' | 'network' | 'unknown';

export const REQUEST_ERROR_COPY: Record<Exclude<ErrorKind, 'abort'>, string> = {
  auth: 'Your session has ended. Sign in again to continue.',
  forbidden: 'You do not have access to this. Ask a project admin for access.',
  not_found: 'It may have been deleted, or the link is wrong.',
  server: 'The server had a problem. Nothing was changed. Try again in a moment.',
  network: 'The server could not be reached. Check your connection and try again.',
  client: 'The request was not accepted.',
  unknown: 'Something went wrong while loading. Try again.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly code: string | undefined;
  readonly kind: ErrorKind;
  readonly headers: Headers | undefined;
  readonly body: unknown;

  constructor(
    status: number,
    detail: string,
    opts: { code?: string; headers?: Headers; body?: unknown } = {},
  ) {
    super(detail || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = opts.code;
    this.headers = opts.headers;
    this.body = opts.body;
    this.kind = classifyError({ status }).kind;
  }
}

export interface ClassifiedError {
  kind: ErrorKind;
  status: number;
  message: string;
  detail: string;
}

export function classifyError(error: unknown): ClassifiedError {
  const e = (error ?? {}) as {
    status?: unknown;
    response?: { status?: unknown };
    name?: string;
    message?: string;
    detail?: string;
    kind?: string;
  };
  let status = 0;
  if (typeof e.status === 'number') status = e.status;
  else if (e.response && typeof e.response.status === 'number') status = e.response.status;
  let kind: ErrorKind;
  if (e.name === 'AbortError') kind = 'abort';
  else if (status === 401) kind = 'auth';
  else if (status === 403) kind = 'forbidden';
  else if (status === 404) kind = 'not_found';
  else if (status >= 500) kind = 'server';
  else if (status >= 400) kind = 'client';
  else if (e.name === 'TypeError' && /fetch|network|load failed/i.test(String(e.message ?? '')))
    kind = 'network';
  else if (e.kind && e.kind in REQUEST_ERROR_COPY) kind = e.kind as ErrorKind;
  else kind = 'unknown';
  const detail = e.detail ? String(e.detail) : e.message ? String(e.message) : '';
  const message = kind === 'abort' ? '' : REQUEST_ERROR_COPY[kind];
  return { kind, status, message, detail };
}

/** `{root}/login?next=<current app path>` (or a custom next). */
export function loginUrl(next?: string): string {
  const target = next ?? `${window.location.pathname}${window.location.search}`;
  return `${appUrl('/login')}?next=${encodeURIComponent(target)}`;
}

export function redirectToLogin(next?: string): void {
  window.location.assign(loginUrl(next));
}

/** Only same-site absolute paths are followed after sign-in (mirrors sanitize_next). */
export function sameOriginTarget(next: string | null | undefined, fallback = appUrl('/')): string {
  const value = String(next ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

let onUnauthorized: ((path: string) => void) | null = (path) => {
  if (path.startsWith('/v1/auth/')) return;
  if (!bootstrap().sessionAuth) return; // nothing to redirect to; the shell shows a panel
  redirectToLogin();
};

/** Override the 401 handler (tests, or the proxy_headers panel). */
export function setUnauthorizedHandler(handler: ((path: string) => void) | null): void {
  onUnauthorized = handler;
}

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the global 401 handling for this call. */
  silent401?: boolean;
}

/**
 * fetch + JSON with typed failures. Throws ApiError for every non-2xx.
 * Relative paths are resolved under the platform root path.
 */
export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { body, silent401, headers, ...rest } = init;
  const url = /^https?:/.test(path) ? path : platformUrl(path);
  const h = new Headers(headers);
  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) {
      payload = body as BodyInit;
    } else {
      h.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
  }
  const response = await fetch(url, { credentials: 'same-origin', ...rest, headers: h, body: payload });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    let detail = obj ? (obj.detail ?? obj.error ?? '') : '';
    if (detail && typeof detail !== 'string') detail = formatDetail(detail);
    const code = obj && typeof obj.code === 'string' ? obj.code : undefined;
    const err = new ApiError(
      response.status,
      String(detail || (typeof data === 'string' ? data.slice(0, 200) : '')),
      {
        code,
        headers: response.headers,
        body: data,
      },
    );
    if (response.status === 401 && !silent401 && onUnauthorized) onUnauthorized(path);
    throw err;
  }
  return data as T;
}

/** Render a FastAPI/Pydantic `detail` (string, array of `{loc,msg}`, or object) as readable text. */
export function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as { loc?: unknown; msg?: unknown };
          if (typeof o.msg === 'string') {
            const loc = Array.isArray(o.loc)
              ? o.loc.filter((p) => p !== 'body' && p !== 'query' && p !== 'path').join('.')
              : '';
            return loc ? `${loc}: ${o.msg}` : o.msg;
          }
        }
        return typeof item === 'string' ? item : JSON.stringify(item);
      })
      .join('\n');
  }
  return JSON.stringify(detail);
}

export const api = {
  get: <T>(path: string, init?: ApiFetchInit) => apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: ApiFetchInit) =>
    apiFetch<T>(path, { ...init, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, init?: ApiFetchInit) =>
    apiFetch<T>(path, { ...init, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, init?: ApiFetchInit) =>
    apiFetch<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T>(path: string, init?: ApiFetchInit) => apiFetch<T>(path, { ...init, method: 'DELETE' }),
};

/** 409 "archived" from the server means the project became read-only. */
export function isArchivedConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /archiv/i.test(error.detail);
}
