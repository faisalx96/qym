/** Validation of the temporary-model form (services/eval_temporary_models.py rules, client side). */
export interface TemporaryModelValues {
  label: string;
  model: string;
  base_url: string;
  api_key: string;
}

export interface TemporaryModelInput extends TemporaryModelValues {
  saveToProject?: boolean;
}

export function validateTemporaryModel(
  v: TemporaryModelInput,
  opts: { keysAllowed: boolean; allowHttp: boolean },
): { ok: true; value: TemporaryModelValues & { saveToProject: boolean } } | { ok: false; error: string } {
  const model = v.model.trim();
  const baseUrl = v.base_url.trim().replace(/\/+$/, '');
  const apiKey = opts.keysAllowed ? v.api_key.trim() : '';
  if (!model) return { ok: false, error: 'Enter a model name.' };
  if (baseUrl) {
    if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) return { ok: false, error: 'The base URL must start with https://.' };
    if (!opts.allowHttp && !/^https:\/\//i.test(baseUrl)) return { ok: false, error: 'The base URL must use https://.' };
  }
  if (v.saveToProject && (!baseUrl || !apiKey)) {
    return { ok: false, error: 'A base URL and an API key are needed to save it to project models.' };
  }
  return {
    ok: true,
    value: { label: v.label.trim() || model, model, base_url: baseUrl, api_key: apiKey, saveToProject: Boolean(v.saveToProject) },
  };
}
