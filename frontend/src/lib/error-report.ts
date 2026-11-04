import { ApiError, classifyError } from './http';

/** Read only the public diagnostic identifiers from the API error envelope. */
export function errorIdentifiers(error: unknown): { code?: string; request_id?: string } {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return {};
  const envelope = (error.body as Record<string, unknown>).error;
  if (!envelope || typeof envelope !== 'object') return {};
  const fields = envelope as Record<string, unknown>;
  return {
    code: typeof fields.code === 'string' ? fields.code : undefined,
    request_id: typeof fields.request_id === 'string' ? fields.request_id : undefined,
  };
}
export function errorReport(error: unknown, context: { title?: string } = {}): string {
  const info = classifyError(error);
  const identifiers = errorIdentifiers(error);
  return Object.entries({
    Title: context.title ?? 'Couldn’t load this',
    'HTTP status': info.status,
    Detail: info.detail || info.message,
    Code: identifiers.code ?? (error instanceof ApiError ? error.code : undefined),
    'Request id': identifiers.request_id,
    'Time (UTC)': new Date().toISOString(),
  })
    .map(([key, value]) => `${key}: ${value ?? '—'}`)
    .join('\n');
}
