/** Maps an environment save/create error onto the form field it is about (RHF `setError` equivalent). */
import { ApiError } from '@/lib/http';
import { errorMessage } from '@/api/evalCommon';

export type EnvironmentField =
  'name' | 'base_url' | 'api_key' | 'ranking_metric' | 'ranking_k' | 'max_priority' | 'default_priority';
export type FieldErrors = Partial<Record<EnvironmentField, string>>;

const FIELDS: EnvironmentField[] = [
  'name',
  'base_url',
  'api_key',
  'ranking_metric',
  'ranking_k',
  'max_priority',
  'default_priority',
];

function fieldFromText(message: string): EnvironmentField | null {
  const text = message.toLowerCase();
  if (/\b(base )?url\b|https:\/\/|query string|registered in another project|host/.test(text))
    return 'base_url';
  if (/api key|key encryption|whitespace or control/.test(text)) return 'api_key';
  if (/default priority/.test(text)) return 'default_priority';
  if (/max(imum)? priority|priority/.test(text)) return 'max_priority';
  if (/ranking_k|\bk must|ranking k/.test(text)) return 'ranking_k';
  if (/ranking metric/.test(text)) return 'ranking_metric';
  if (/\bname\b/.test(text)) return 'name';
  return null;
}

/** `{field: message}` for what can be placed on a field; the rest comes back as `general`. */
export function mapEnvironmentError(error: unknown): { fields: FieldErrors; general: string } {
  const fields: FieldErrors = {};
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    if (body && Array.isArray(body.detail)) {
      const rest: string[] = [];
      for (const item of body.detail) {
        if (!item || typeof item !== 'object') continue;
        const loc = Array.isArray((item as { loc?: unknown[] }).loc) ? (item as { loc: unknown[] }).loc : [];
        const last = String(loc[loc.length - 1] ?? '');
        const msg = String((item as { msg?: unknown }).msg ?? '');
        if ((FIELDS as string[]).includes(last)) fields[last as EnvironmentField] = msg;
        else if (msg) rest.push(msg);
      }
      return { fields, general: rest.join('; ') };
    }
  }
  const message = errorMessage(error);
  const field = fieldFromText(message);
  if (field) {
    fields[field] = message;
    return { fields, general: '' };
  }
  return { fields, general: message };
}
