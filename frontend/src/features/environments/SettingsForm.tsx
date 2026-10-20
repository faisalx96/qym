/**
 * Ranking, Policies and Connection of an environment, with the sticky Delete / Save footer.
 * The draft lives in this component's state, apart from the server record, so background
 * refetches and Test/Re-enable never overwrite unsaved edits; server errors land on fields.
 */
import { useMemo, useState } from 'react';
import { useDeleteEnvironment, useUpdateEnvironment, type EnvironmentUpdate } from '@/api/evalEnvironments';
import { PRIORITIES, type EvalEnvironment, type EvalPriority, type LatencyMinRole } from '@/api/evalCommon';
import { Button, Checkbox, ConfirmDialog, NumberField, Select, Tag, TextField, useToast } from '@/ui';
import { connectionKeysBodyValue, connectionKeysView } from './environmentUrl';
import { LATENCY_ROLE_HELP, LATENCY_ROLE_ITEMS, LATENCY_ROLE_LABEL } from './copy';
import { mapEnvironmentError, type FieldErrors } from './fieldErrors';
import { highPriorityWarning } from './format';
import styles from './EnvironmentPage.module.css';
import { Section } from './Section';

interface Draft {
  name: string;
  base_url: string;
  api_key: string;
  ranking_metric: string;
  ranking_k: number;
  max_priority: EvalPriority;
  default_priority: EvalPriority;
  latency_min_role: LatencyMinRole;
  allow_keys: boolean;
  keysTouched: boolean;
}

function draftFrom(env: EvalEnvironment): Draft {
  return {
    name: env.name,
    base_url: env.base_url,
    api_key: '',
    ranking_metric: env.ranking_metric ?? '',
    ranking_k: env.ranking_k ?? NaN,
    max_priority: env.max_priority,
    default_priority: env.default_priority,
    latency_min_role: env.latency_sensitive_min_role ?? 'member',
    allow_keys: env.allow_connection_keys,
    keysTouched: false,
  };
}

const PRIORITY_ITEMS = PRIORITIES.map((p) => ({ key: p, label: p }));

export interface SettingsFormProps {
  projectId: string;
  env: EvalEnvironment;
  canEdit: boolean;
  /** Show the Close button next to Save (drawer). */
  onClose?: () => void;
  onDeleted: () => void;
}

export function SettingsForm({ projectId, env, canEdit, onClose, onDeleted }: SettingsFormProps) {
  const update = useUpdateEnvironment(projectId, env.id);
  const remove = useDeleteEnvironment(projectId, env.id);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(env));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const keys = connectionKeysView({
    storedUrl: env.base_url,
    draftUrl: draft.base_url,
    storedAllow: env.allow_connection_keys,
    touched: draft.keysTouched,
    draftChecked: draft.allow_keys,
  });
  const dirty = useMemo(() => {
    const a = draftFrom(env);
    return (
      draft.name !== a.name ||
      draft.base_url !== a.base_url ||
      draft.api_key !== '' ||
      draft.ranking_metric !== a.ranking_metric ||
      !(
        Object.is(draft.ranking_k, a.ranking_k) ||
        (Number.isNaN(draft.ranking_k) && Number.isNaN(a.ranking_k))
      ) ||
      draft.max_priority !== a.max_priority ||
      draft.default_priority !== a.default_priority ||
      draft.latency_min_role !== a.latency_min_role ||
      draft.keysTouched
    );
  }, [draft, env]);

  function patch(next: Partial<Draft>, clear?: keyof FieldErrors) {
    setDraft((d) => ({ ...d, ...next }));
    if (clear && errors[clear]) setErrors((e) => ({ ...e, [clear]: undefined }));
  }

  async function save() {
    const next: FieldErrors = {};
    const name = draft.name.trim();
    const baseUrl = draft.base_url.trim();
    if (!name) next.name = 'A name is required.';
    if (!baseUrl) next.base_url = 'A base URL is required.';
    if (
      !Number.isNaN(draft.ranking_k) &&
      (!Number.isInteger(draft.ranking_k) || draft.ranking_k < 1 || draft.ranking_k > 1000)
    ) {
      next.ranking_k = 'k must be a whole number from 1 to 1000.';
    }
    setErrors(next);
    setGeneral('');
    if (Object.keys(next).length) return;
    const body: EnvironmentUpdate = {
      name,
      base_url: baseUrl,
      ranking_metric: draft.ranking_metric.trim() || null,
      ranking_k: Number.isNaN(draft.ranking_k) ? null : draft.ranking_k,
      max_priority: draft.max_priority,
      default_priority: draft.default_priority,
      latency_sensitive_min_role: draft.latency_min_role,
    };
    // A moved URL without an explicit re-opt-in omits the flag, so the backend turns connection keys off.
    const allow = connectionKeysBodyValue({
      storedUrl: env.base_url,
      draftUrl: baseUrl,
      touched: draft.keysTouched,
      draftChecked: keys.checked,
    });
    if (allow !== undefined) body.allow_connection_keys = allow;
    if (draft.api_key.trim()) body.api_key = draft.api_key.trim(); // omitted: the stored key is kept
    try {
      const saved = await update.mutateAsync(body);
      setDraft(draftFrom(saved)); // the key never outlives the request
      toast.show(`Saved “${saved.name}”`, { tone: 'success' });
    } catch (e) {
      const mapped = mapEnvironmentError(e);
      setErrors(mapped.fields);
      setGeneral(mapped.general);
    }
  }

  async function doDelete() {
    try {
      const r = await remove.mutateAsync();
      toast.show(r.deleted ? `Deleted “${env.name}”` : `“${env.name}” is in use, so it was disabled`, {
        tone: 'success',
      });
      onDeleted();
    } catch (e) {
      setGeneral(mapEnvironmentError(e).general || 'Could not delete the environment.');
      throw e;
    }
  }

  const disabled = !canEdit;
  return (
    <>
      <Section id="env-ranking" title="Ranking" description="How best runs on this environment are ranked.">
        <div className={styles.formGrid}>
          <TextField
            label="Ranking metric"
            mono
            placeholder="Project default"
            value={draft.ranking_metric}
            maxLength={200}
            isDisabled={disabled}
            errorMessage={errors.ranking_metric}
            onChange={(v) => patch({ ranking_metric: v }, 'ranking_metric')}
          />
          <NumberField
            label="k"
            value={draft.ranking_k}
            minValue={1}
            maxValue={1000}
            step={1}
            steppers={false}
            placeholder="—"
            isDisabled={disabled}
            errorMessage={errors.ranking_k}
            onChange={(v) => patch({ ranking_k: v }, 'ranking_k')}
          />
        </div>
      </Section>
      <Section
        id="env-policies"
        title="Policies"
        description="Limits applied to experiments launched on this environment."
      >
        <div className={styles.formGrid}>
          <Select
            label="Max priority"
            items={PRIORITY_ITEMS}
            value={draft.max_priority}
            isDisabled={disabled}
            searchable={false}
            errorMessage={errors.max_priority}
            onChange={(k) => k && patch({ max_priority: String(k) as EvalPriority }, 'max_priority')}
          />
          <Select
            label="Default priority"
            items={PRIORITY_ITEMS}
            value={draft.default_priority}
            isDisabled={disabled}
            searchable={false}
            errorMessage={errors.default_priority}
            onChange={(k) => k && patch({ default_priority: String(k) as EvalPriority }, 'default_priority')}
          />
          <Select
            label={LATENCY_ROLE_LABEL}
            items={LATENCY_ROLE_ITEMS.map((i) => ({ ...i }))}
            value={draft.latency_min_role}
            isDisabled={disabled}
            searchable={false}
            help={LATENCY_ROLE_HELP}
            errorMessage={errors.latency_sensitive_min_role}
            onChange={(k) =>
              k && patch({ latency_min_role: String(k) as LatencyMinRole }, 'latency_sensitive_min_role')
            }
          />
        </div>
        {draft.max_priority === 'HIGH' ? (
          <div className={styles.callout} data-tone="warning" role="note">
            {highPriorityWarning(env.name)}
          </div>
        ) : null}
        <div>
          <Checkbox
            isSelected={keys.checked}
            isDisabled={disabled}
            onChange={(checked) => patch({ allow_keys: checked, keysTouched: true })}
          >
            Allow connection keys
          </Checkbox>
          <p className={styles.checkHelp} data-keys-help>
            {keys.help}
          </p>
        </div>
      </Section>
      {canEdit ? (
        <Section
          id="env-connection"
          title="Connection"
          description="Changing the URL or key resets health until the next test."
        >
          <TextField
            label="Name"
            value={draft.name}
            maxLength={200}
            errorMessage={errors.name}
            onChange={(v) => patch({ name: v }, 'name')}
          />
          <TextField
            label="Base URL"
            mono
            type="url"
            value={draft.base_url}
            maxLength={500}
            errorMessage={errors.base_url}
            onChange={(v) => patch({ base_url: v }, 'base_url')}
          />
          <TextField
            label="API key"
            mono
            type="password"
            autoComplete="new-password"
            value={draft.api_key}
            maxLength={4096}
            placeholder={
              env.api_key_set
                ? `Leave blank to keep ${env.api_key_hint || 'the stored key'}`
                : 'Paste the service API key'
            }
            errorMessage={errors.api_key}
            onChange={(v) => patch({ api_key: v }, 'api_key')}
          />
          {general ? (
            <div className={styles.callout} data-tone="error" role="alert">
              {general}
            </div>
          ) : null}
        </Section>
      ) : null}
      {canEdit ? (
        <div className={styles.footer}>
          <Button variant="danger" size="md" onPress={() => setConfirmDelete(true)}>
            Delete environment
          </Button>
          <span className={styles.footerSpacer} />
          {dirty ? <Tag tone="warning">Unsaved changes</Tag> : null}
          {onClose ? (
            <Button variant="neutral" size="md" onPress={onClose}>
              Close
            </Button>
          ) : null}
          <Button variant="primary" size="md" loading={update.isPending} onPress={() => void save()}>
            Save changes
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete environment?"
        description={[
          `Delete “${env.name}” and its stored schemas and LLM slots.`,
          'If experiments or presets use it, it is disabled instead so their history stays intact.',
        ]}
        confirmLabel="Delete environment"
        tone="danger"
        onConfirm={doDelete}
      />
    </>
  );
}
