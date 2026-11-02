/**
 * A stored API key is bound to the scheme, host and port it was entered for (C004).
 *
 * Client mirror of `key_host_changed` in `llm_endpoint_security.py`. The edit forms of
 * LLM connections, environments and the feedback agent ask for the key again once the
 * base URL points to another host, because the server refuses to keep the stored key
 * there. A new path on the same host keeps the key. The server has the final say.
 */

const DEFAULT_PORTS: Record<string, string> = { 'https:': '443', 'http:': '80' };

export const KEY_FOR_NEW_HOST_PLACEHOLDER = 'Enter the key for the new host';
export const KEY_FOR_NEW_HOST_ERROR = 'Enter the API key again for the new host.';

function keyOrigin(value: string): string | null {
  try {
    const url = new URL(String(value || '').trim());
    const port = url.port || DEFAULT_PORTS[url.protocol] || '';
    return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
}

/** Whether moving a base URL from `stored` to `next` needs the API key again. */
export function keyHostChanged(stored: string, next: string): boolean {
  const a = keyOrigin(stored);
  const b = keyOrigin(next);
  if (a === null || b === null) return String(stored || '').trim() !== String(next || '').trim();
  return a !== b;
}
