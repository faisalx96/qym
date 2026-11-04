import { useId, useState, type ReactNode } from 'react';
import {
  failedCheckText,
  fieldStatus,
  workerDefaults,
  type LiveWorkerRead,
  type LiveWorkerSecrets,
  type LiveWorkerValues,
} from '@/api/liveWorker';
import { actionErrorMessage, ApiError, errorSentence, fieldErrorsOf } from '@/lib/http';
import {
  Button,
  ErrorState,
  NumberField,
  SectionHeader,
  Select,
  Switch,
  Tag,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

function SettingsSection({
  section,
  title,
  read,
  children,
}: {
  section: keyof LiveWorkerValues;
  title: string;
  read: LiveWorkerRead;
  children: ReactNode;
}) {
  const status = fieldStatus(section, read);
  const error = failedCheckText(section, read);
  return (
    <section className={styles.settingsSection} aria-label={title}>
      <SectionHeader
        level="lg"
        title={title}
        aside={
          <Tag
            tone={
              status === 'running'
                ? 'success'
                : status === 'pending'
                  ? 'warning'
                  : status === 'failed'
                    ? 'danger'
                    : undefined
            }
          >
            {status === 'waiting' ? 'waiting for version 1' : status}
          </Tag>
        }
      />
      {error ? (
        <Text as="p" tone="danger" dir="auto">
          {error}
        </Text>
      ) : null}
      <div className={styles.fields}>{children}</div>
    </section>
  );
}

export function SettingsForm({
  read,
  onSave,
  busy,
}: { read: LiveWorkerRead; busy?: boolean } & Pick<WorkerCallbacks, 'onSave'>) {
  const [values, setValues] = useState(() => read.settings?.values ?? workerDefaults());
  const [loaded, setLoaded] = useState(() => ({ version: read.settings?.version, values }));
  const [seenVersion, setSeenVersion] = useState(read.settings?.version);
  const [incoming, setIncoming] = useState<LiveWorkerRead['settings']>(null);
  const [secrets, setSecrets] = useState<LiveWorkerSecrets>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const modelsId = useId();
  const errors = fieldErrorsOf(error);
  const dirty =
    JSON.stringify(values) !== JSON.stringify(loaded.values) ||
    Object.values(secrets).some((value) => value !== '') ||
    note !== '';
  function initialise(version: number | undefined, nextValues: LiveWorkerValues) {
    setLoaded({ version, values: nextValues });
    setValues(nextValues);
    setSecrets({});
    setNote('');
    setError(null);
    setIncoming(null);
  }
  // Observe each incoming version once, keeping the draft's baseline until it is loaded or saved.
  if (read.settings?.version !== seenVersion) {
    setSeenVersion(read.settings?.version);
    if (!dirty) initialise(read.settings?.version, read.settings?.values ?? workerDefaults());
    else if (read.settings?.version !== loaded.version) setIncoming(read.settings);
  }
  function update<S extends keyof LiveWorkerValues, K extends keyof LiveWorkerValues[S]>(
    section: S,
    key: K,
    value: LiveWorkerValues[S][K],
  ) {
    setValues((previous) => ({ ...previous, [section]: { ...previous[section], [key]: value } }));
  }
  // Scope duplicate leaf names (host/database) using the full validation path when supplied.
  function fieldError(section: keyof LiveWorkerValues | 'secrets', key: string) {
    if (!(error instanceof ApiError)) return undefined;
    const detail = (error.body as { detail?: { loc?: unknown[] }[] } | undefined)?.detail;
    const scoped = Array.isArray(detail)
      ? detail.filter(
          (item) => item.loc?.at(-1) === key && (item.loc.at(-2) === section || item.loc.length <= 2),
        )
      : [];
    return fieldErrorsOf(new ApiError(error.status, error.detail, { body: { detail: scoped } }))[key];
  }
  function secret(key: keyof LiveWorkerSecrets, label: string, help?: string) {
    const hint = read.settings?.secret_hints[key];
    return (
      <TextField
        label={label}
        type="password"
        autoComplete="new-password"
        value={secrets[key] ?? ''}
        onChange={(value) => setSecrets((previous) => ({ ...previous, [key]: value }))}
        help={`${hint ? `set, ends in …${hint}` : 'not set'}${help ? ` · ${help}` : ''}`}
        errorMessage={fieldError('secrets', key)}
      />
    );
  }
  async function save() {
    setError(null);
    const typed = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value !== ''));
    try {
      const result = await onSave({
        values,
        ...(Object.keys(typed).length ? { secrets: typed } : {}),
        ...(note ? { note } : {}),
      });
      initialise(result.version, values);
      toast.show(`Saved as version ${result.version}`, { tone: 'success' });
    } catch (e) {
      setError(e);
      if (!(e instanceof ApiError && e.status === 422))
        toast.show(actionErrorMessage('save the settings', e), { tone: 'error' });
    }
  }
  return (
    <WorkerBlock name="settings" title="Settings">
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {incoming ? (
          <div className={styles.stack}>
            <Text as="p" tone="warning" dir="auto">
              Version {incoming.version} was saved by {incoming.created_by ?? 'another member'} while you were
              editing
            </Text>
            <div className={styles.inline}>
              <Button onPress={() => initialise(incoming.version, incoming.values)}>
                Load version {incoming.version}
              </Button>
              <Button onPress={() => setIncoming(null)}>Keep my draft</Button>
            </div>
          </div>
        ) : null}
        <SettingsSection section="evaluation" title="Evaluation" read={read}>
          {(
            [
              ['chart_vision_enabled', 'Chart vision'],
              ['chart_design_enabled', 'Chart design'],
              ['chart_images_upload', 'Upload chart images'],
              ['dataiku_execution', 'Dataiku execution'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Switch
                isSelected={values.evaluation[key]}
                onChange={(value) => update('evaluation', key, value)}
              >
                {label}
              </Switch>
              {fieldError('evaluation', key) ? (
                <Text tone="danger">{fieldError('evaluation', key)}</Text>
              ) : null}
            </div>
          ))}
          {(
            [
              ['parallel_turns', 'Parallel turns', 1, 8],
              ['poll_interval_s', 'Poll interval (seconds)', 15, 600],
              ['lookback_hours', 'Lookback (hours)', 0, 168],
            ] as const
          ).map(([key, label, min, max]) => (
            <NumberField
              key={key}
              label={label}
              value={values.evaluation[key]}
              onChange={(value) => update('evaluation', key, value)}
              minValue={min}
              maxValue={max}
              step={key === 'lookback_hours' ? 0.1 : 1}
              errorMessage={fieldError('evaluation', key)}
              isInvalid={Boolean(fieldError('evaluation', key))}
            />
          ))}
        </SettingsSection>
        <SettingsSection section="models" title="Models" read={read}>
          <Select
            label="Connection"
            items={read.connections.map((connection) => ({
              key: connection.id,
              label: `${connection.name} · …${connection.api_key_last4}`,
            }))}
            value={values.models.connection_id || null}
            onChange={(id) => update('models', 'connection_id', String(id ?? ''))}
            errorMessage={fieldError('models', 'connection_id')}
            wrapValue
            renderValue={(item) => (
              <span className={styles.wrap} dir="auto">
                {item.label}
              </span>
            )}
          />
          {(
            [
              ['judge_a', 'Judge A'],
              ['judge_b', 'Judge B'],
              ['vision_judge', 'Vision judge'],
              ['vision_extractor', 'Vision extractor'],
              ['vision_design_judge', 'Vision design judge'],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              list={modelsId}
              value={values.models[key]}
              onChange={(value) => update('models', key, value)}
              errorMessage={fieldError('models', key)}
            />
          ))}
          <datalist id={modelsId}>
            {read.model_ids.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </SettingsSection>
        <SettingsSection section="langfuse" title="Langfuse" read={read}>
          <TextField
            label="Langfuse host"
            value={values.langfuse.host}
            onChange={(value) => update('langfuse', 'host', value)}
            errorMessage={fieldError('langfuse', 'host')}
          />
          <TextField
            label="Public key"
            value={values.langfuse.public_key}
            onChange={(value) => update('langfuse', 'public_key', value)}
            errorMessage={fieldError('langfuse', 'public_key')}
          />
          {secret('langfuse_secret_key', 'Langfuse secret key')}
        </SettingsSection>
        <SettingsSection section="dataiku" title="Dataiku" read={read}>
          <TextField
            label="Dataiku URL"
            value={values.dataiku.url}
            onChange={(value) => update('dataiku', 'url', value)}
            errorMessage={fieldError('dataiku', 'url')}
          />
          <TextField
            label="Dataiku database"
            value={values.dataiku.database}
            onChange={(value) => update('dataiku', 'database', value)}
            errorMessage={fieldError('dataiku', 'database')}
          />
          {secret('dataiku_api_key', 'Dataiku API key', 'required when Dataiku execution is on')}
        </SettingsSection>
        <SettingsSection section="database" title="Database" read={read}>
          <TextField
            label="Database host"
            value={values.database.host}
            onChange={(value) => update('database', 'host', value)}
            errorMessage={fieldError('database', 'host')}
          />
          <NumberField
            label="Database port"
            value={values.database.port}
            onChange={(value) => update('database', 'port', value)}
            minValue={1}
            maxValue={65535}
            formatOptions={{ useGrouping: false }}
            errorMessage={fieldError('database', 'port')}
            isInvalid={Boolean(fieldError('database', 'port'))}
          />
          <TextField
            label="Database name"
            value={values.database.database}
            onChange={(value) => update('database', 'database', value)}
            errorMessage={fieldError('database', 'database')}
          />
          <TextField
            label="Database user"
            value={values.database.user}
            onChange={(value) => update('database', 'user', value)}
            errorMessage={fieldError('database', 'user')}
          />
          <Select
            label="SSL mode"
            value={values.database.sslmode}
            items={(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'] as const).map(
              (key) => ({ key, label: key }),
            )}
            onChange={(key) => {
              if (key) update('database', 'sslmode', key as LiveWorkerValues['database']['sslmode']);
            }}
            errorMessage={fieldError('database', 'sslmode')}
          />
          {secret('database_password', 'Database password')}
        </SettingsSection>
        <TextField label="Note" help="Optional" value={note} onChange={setNote} errorMessage={errors.note} />
        <div className={styles.inline}>
          <Button type="submit" variant="accent" isDisabled={busy} loading={busy}>
            Save
          </Button>
        </div>
        {error ? (
          <ErrorState
            compact
            error={error}
            title="Couldn’t save the settings"
            message={errorSentence(error)}
          />
        ) : null}
      </form>
    </WorkerBlock>
  );
}
