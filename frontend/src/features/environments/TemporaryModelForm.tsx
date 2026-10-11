/**
 * "Temporary model" form of the launch form (plan §7.5). The API key lives only in this
 * component's state until submit/cancel, then is wiped; it is never rendered back, stored or logged.
 */
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, TextField } from '@/ui';
import { validateTemporaryModel, type TemporaryModelValues } from './temporaryModel';
import styles from './AddEnvironmentDialog.module.css';

export interface TemporaryModelFormProps {
  /** Receives the values once; the form clears its own copy of the key right after. */
  onSubmit: (values: TemporaryModelValues & { saveToProject: boolean }) => void;
  onCancel?: () => void;
  /** The environment accepts model API keys (default true). */
  keysAllowed?: boolean;
  keysReason?: string | null;
  canSaveToProject?: boolean;
  /** Private/local deployments (QYM_ALLOW_PRIVATE_LLM_BASE_URLS) may use http://. */
  allowHttp?: boolean;
}

export function TemporaryModelForm({
  onSubmit,
  onCancel,
  keysAllowed = true,
  keysReason,
  canSaveToProject,
  allowHttp = false,
}: TemporaryModelFormProps) {
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [save, setSave] = useState(false);
  const [error, setError] = useState('');

  function wipe() {
    setLabel('');
    setModel('');
    setBaseUrl('');
    setApiKey('');
    setSave(false);
    setError('');
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const result = validateTemporaryModel(
      { label, model, base_url: baseUrl, api_key: apiKey, saveToProject: save },
      { keysAllowed, allowHttp },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    wipe(); // the key never outlives the submit
    onSubmit(result.value);
  }

  return (
    <form className={styles.form} role="group" aria-label="Temporary model" autoComplete="off" noValidate onSubmit={submit}>
      <TextField label="Label" placeholder="mini trial" value={label} onChange={setLabel} maxLength={200} />
      <TextField label="Model" placeholder="gpt-4o-mini" value={model} onChange={setModel} maxLength={200} isRequired />
      <TextField
        label="Base URL"
        mono
        type="url"
        placeholder="https://api.example.com/v1"
        value={baseUrl}
        onChange={setBaseUrl}
        maxLength={500}
      />
      <TextField
        label="API key"
        mono
        type="password"
        autoComplete="off"
        placeholder={keysAllowed ? 'sk-…' : 'Not accepted by this environment'}
        value={apiKey}
        onChange={setApiKey}
        isDisabled={!keysAllowed}
        help={
          keysAllowed
            ? 'Used for this experiment only. The key is encrypted, never shown again, and deleted once every job has finished.'
            : keysReason || 'This environment does not accept model API keys.'
        }
      />
      {canSaveToProject ? (
        <Checkbox isSelected={save} onChange={setSave}>
          Save to project models
        </Checkbox>
      ) : null}
      {error ? (
        <div className={styles.callout} data-tone="error" role="alert">
          {error}
        </div>
      ) : null}
      <div>
        <Button
          variant="neutral"
          onPress={() => {
            wipe();
            onCancel?.();
          }}
        >
          Cancel
        </Button>{' '}
        <Button variant="accent" type="submit">
          Add model
        </Button>
      </div>
    </form>
  );
}
