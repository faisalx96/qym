/**
 * The moved-URL rule of the environment settings (eval_environments.js ~l.1595).
 *
 * The "Allow connection keys" opt-in was given for the stored host. While the URL input
 * points elsewhere the checkbox shows off unless the manager ticks it again; on save a moved
 * URL without an explicit re-opt-in omits the flag, so the backend turns connection keys off
 * for the new host.
 */

/** Loose client-side mirror of `normalize_environment_url`, for comparison only. */
export function normalizeEnvironmentUrl(value: string): string {
  let url = String(value || '').trim();
  try {
    const parsed = new URL(url);
    const defaultPort = (parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80');
    const port = parsed.port && !defaultPort ? `:${parsed.port}` : '';
    url = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${parsed.pathname}`;
  } catch {
    // compare the raw text
  }
  url = url.replace(/\/+$/, '');
  while (/\/evals$/i.test(url)) url = url.replace(/\/evals$/i, '').replace(/\/+$/, '');
  return url;
}

export function urlMoved(next: string, stored: string): boolean {
  return normalizeEnvironmentUrl(next) !== normalizeEnvironmentUrl(stored);
}

export const KEYS_HELP = 'Send project LLM connection API keys to this service when a slot is bound to a connection.';
export const KEYS_HELP_MOVED = 'Turned off because the URL changed. Tick it again to send connection keys to the new host.';

export interface ConnectionKeysView {
  /** What the checkbox shows. */
  checked: boolean;
  help: string;
  moved: boolean;
}

/**
 * @param touched whether the manager ticked/unticked the box themselves since loading
 * @param draftChecked the box value when `touched`
 */
export function connectionKeysView(opts: {
  storedUrl: string;
  draftUrl: string;
  storedAllow: boolean;
  touched: boolean;
  draftChecked: boolean;
}): ConnectionKeysView {
  const moved = urlMoved(opts.draftUrl, opts.storedUrl);
  if (opts.touched) return { checked: opts.draftChecked, help: KEYS_HELP, moved };
  return {
    checked: moved ? false : opts.storedAllow,
    help: moved && opts.storedAllow ? KEYS_HELP_MOVED : KEYS_HELP,
    moved,
  };
}

/** The `allow_connection_keys` field of the PUT body, or undefined to omit it. */
export function connectionKeysBodyValue(opts: {
  storedUrl: string;
  draftUrl: string;
  touched: boolean;
  draftChecked: boolean;
}): boolean | undefined {
  if (!urlMoved(opts.draftUrl, opts.storedUrl) || opts.touched) return opts.draftChecked;
  return undefined;
}
