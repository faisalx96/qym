import { KEY_FOR_NEW_HOST_PLACEHOLDER } from '@/lib/keyHost';
import { TextField } from '@/ui';

/**
 * The fields of an LLM connection, one recipe for Project settings and Admin, Feedback assistant (C157): Base URL,
 * Model and API key, each with its own error in place of its help line. Server errors go under the field they concern.
 */
export type ConnectionField = 'baseUrl' | 'model' | 'key';
export type ConnectionErrors = Partial<Record<ConnectionField, string>>;

/** Which field a server message concerns, or null when it concerns the whole connection. */
export function connectionFieldOf(message: string): ConnectionField | null {
  const m = message.toLowerCase();
  if (/api key|\bkey\b/.test(m)) return 'key';
  if (/https?:|url|host|scheme|port|private|address|endpoint/.test(m)) return 'baseUrl';
  if (/\bmodel\b/.test(m)) return 'model';
  return null;
}

/** The https rule, checked before a submit: 'An https:// URL is required.' when it applies. */
export function httpsError(url: string, required: boolean): string | null {
  const value = url.trim();
  if (!required || !value) return null;
  return /^https:\/\//i.test(value) ? null : 'An https:// URL is required.';
}

/** Split a server message into a field error, or a message for the whole form. */
export function placeConnectionError(message: string): { errors: ConnectionErrors; formError: string } {
  const field = connectionFieldOf(message);
  return field ? { errors: { [field]: message }, formError: '' } : { errors: {}, formError: message };
}

export interface ConnectionFieldsProps {
  baseUrl: string;
  onBaseUrl: (v: string) => void;
  model: string;
  onModel: (v: string) => void;
  apiKey: string;
  onApiKey: (v: string) => void;
  /** The stored key cannot follow a new host (C004): the key is required again. */
  needsKey: boolean;
  storedKeyHint?: string | null;
  baseUrlHelp: string;
  modelHelp?: string;
  errors: ConnectionErrors;
}

export function ConnectionFields({
  baseUrl,
  onBaseUrl,
  model,
  onModel,
  apiKey,
  onApiKey,
  needsKey,
  storedKeyHint,
  baseUrlHelp,
  modelHelp,
  errors,
}: ConnectionFieldsProps) {
  return (
    <>
      <TextField
        label="Base URL"
        value={baseUrl}
        onChange={onBaseUrl}
        isRequired
        mono
        placeholder="https://api.openai.com/v1"
        help={errors.baseUrl ? undefined : baseUrlHelp}
        errorMessage={errors.baseUrl}
      />
      <TextField
        label="Model"
        value={model}
        onChange={onModel}
        isRequired
        mono
        placeholder="gpt-4.1"
        help={errors.model ? undefined : modelHelp}
        errorMessage={errors.model}
      />
      <TextField
        label="API key"
        type="password"
        value={apiKey}
        onChange={onApiKey}
        mono
        isRequired={needsKey}
        placeholder={
          needsKey
            ? KEY_FOR_NEW_HOST_PLACEHOLDER
            : storedKeyHint
              ? `Keep current (${storedKeyHint})`
              : 'API key'
        }
        autoComplete="new-password"
        errorMessage={errors.key}
      />
    </>
  );
}
