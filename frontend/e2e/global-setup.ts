/**
 * Create the dev@local user once before the workers start: under
 * QYM_AUTH_MODE=none the first authenticated request inserts it, and two
 * workers racing on that insert make one of them fail with a 500.
 */
export default async function globalSetup(): Promise<void> {
  // Session-auth runs (QYM_E2E_AUTH_MODE=proxy_headers) have no implicit dev user: /v1/me is a 401 there.
  if ((process.env.QYM_E2E_AUTH_MODE ?? 'none') !== 'none') return;
  const port = process.env.QYM_VITE_PORT ?? '5800';
  const res = await fetch(`http://127.0.0.1:${port}/v1/me`);
  if (!res.ok) throw new Error(`e2e warm-up GET /v1/me failed: HTTP ${res.status}`);
}
