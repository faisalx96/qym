/**
 * Add environment (brief 06 §2.9): Connect -> Review settings -> Group LLM settings.
 * "Test & connect" POSTs the environment (the server tests the connection and stores the first
 * schema); the generated form is previewed; the LLM groups are confirmed or skipped.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCreateEnvironment, useEnvironmentForm, type EvalSlot } from '@/api/evalEnvironments';
import type { EvalEnvironment } from '@/api/evalCommon';
import { Button, Dialog, ErrorState, Skeleton, TextField, useToast } from '@/ui';
import { mapEnvironmentError, type EnvironmentField, type FieldErrors } from './fieldErrors';
import styles from './AddEnvironmentDialog.module.css';
import { FormPreview } from './FormPreview';
import { SlotEditor, useSlotEditor } from './SlotEditor';

const STEPS = ['Connect', 'Review settings', 'Group LLM settings'] as const;

export interface AddEnvironmentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the environment exists (after Skip, Confirm or closing at step 2/3). */
  onCreated?: (env: EvalEnvironment) => void;
  onGotoApiKeys?: () => void;
}

export function AddEnvironmentDialog(props: AddEnvironmentDialogProps) {
  // Remount on every open so no step, field or key survives a close.
  return <AddEnvironmentDialogInner key={props.open ? 'open' : 'closed'} {...props} />;
}

function AddEnvironmentDialogInner({
  projectId,
  open,
  onOpenChange,
  onCreated,
  onGotoApiKeys,
}: AddEnvironmentDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [env, setEnv] = useState<EvalEnvironment | null>(null);
  const [initialSlots, setInitialSlots] = useState<EvalSlot[]>([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const inputs = useRef<Partial<Record<EnvironmentField, HTMLInputElement | null>>>({});
  const create = useCreateEnvironment(projectId);
  const form = useEnvironmentForm(projectId, env?.id, Boolean(env));
  const editor = useSlotEditor(projectId, env?.id ?? '');
  const toast = useToast();
  const { load } = editor;

  const descriptor = form.data?.descriptor;
  const schemaId = form.data?.schema_id ?? env?.current_schema_id ?? '';
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!descriptor || !env || loadedFor.current === env.id) return;
    loadedFor.current = env.id; // a background refetch must not wipe the edits
    load({ slots: initialSlots, schemaId, descriptor });
  }, [descriptor, env, initialSlots, schemaId, load]);

  function close() {
    if (env) onCreated?.(env);
    onOpenChange(false);
  }

  async function connect(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    const missing: FieldErrors = {};
    if (!name.trim()) missing.name = 'Enter a name.';
    if (!baseUrl.trim()) missing.base_url = 'Enter the service base URL.';
    if (!apiKey.trim()) missing.api_key = 'Enter the API key.';
    setErrors(missing);
    const first = (['name', 'base_url', 'api_key'] as const).find((k) => missing[k]);
    if (first) {
      inputs.current[first]?.focus();
      return;
    }
    try {
      const r = await create.mutateAsync({
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      });
      setApiKey(''); // the key now lives only (encrypted) on the server
      setEnv(r.environment);
      setInitialSlots(r.slots ?? []);
      toast.show(`Connected “${r.environment.name}”`, { tone: 'success' });
      setStep(2);
    } catch (e) {
      const mapped = mapEnvironmentError(e);
      setErrors(mapped.fields);
      setError(
        mapped.general ||
          (Object.keys(mapped.fields).length ? '' : 'Could not connect to the Evaluation Service.'),
      );
      const first = (['name', 'base_url', 'api_key'] as const).find((k) => mapped.fields[k]);
      if (first) setTimeout(() => inputs.current[first]?.focus(), 0);
    }
  }

  async function confirm() {
    const result = await editor.save();
    if (!result || !env) return;
    toast.show(`LLM settings grouped for “${env.name}”`, { tone: 'success' });
    onCreated?.(env);
    onOpenChange(false);
  }

  function skip() {
    if (!env) return;
    toast.show(`“${env.name}” saved. Group its LLM settings from the environment page.`, { tone: 'info' });
    onCreated?.(env);
    onOpenChange(false);
  }

  const footer =
    step === 1 ? (
      <>
        <Button size="md" onPress={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="md" variant="primary" loading={create.isPending} onPress={() => void connect()}>
          Test &amp; connect
        </Button>
      </>
    ) : step === 2 ? (
      <>
        <span className={styles.note}>“{env?.name}” is saved.</span>
        <Button size="md" onPress={close}>
          Close
        </Button>
        <Button size="md" variant="primary" isDisabled={!descriptor} onPress={() => setStep(3)}>
          Next: group LLM settings
        </Button>
      </>
    ) : (
      <>
        <Button size="md" onPress={() => setStep(2)}>
          Back
        </Button>
        <Button size="md" onPress={skip}>
          Skip for now
        </Button>
        <Button size="md" variant="primary" loading={editor.busy} onPress={() => void confirm()}>
          Confirm
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Add environment"
      size="data"
      footer={footer}
      dismissOnBackdrop={false}
    >
      <ol className={styles.steps} aria-label="Steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={styles.step}
            aria-current={step === i + 1 ? 'step' : undefined}
            data-done={step > i + 1 ? '' : undefined}
          >
            <span className={styles.stepNum}>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 1 ? (
        <form className={styles.form} autoComplete="off" noValidate onSubmit={(e) => void connect(e)}>
          <div className={styles.callout} role="note">
            <strong>Ingest with this project&apos;s key.</strong> The deployment must send its runs to qym
            with an API key of <em>this</em> project (<code>QYM_API_KEY</code>), otherwise its results land in
            another project.{' '}
            {onGotoApiKeys ? (
              <Button variant="ghost" onPress={onGotoApiKeys}>
                Create a project API key
              </Button>
            ) : null}
          </div>
          <TextField
            label="Name"
            placeholder="e.g. staging"
            ref={(el) => {
              inputs.current.name = el;
            }}
            errorMessage={errors.name}
            value={name}
            onChange={(v) => {
              setName(v);
              setErrors((e) => ({ ...e, name: undefined }));
            }}
            maxLength={200}
            isRequired
            autoFocus
          />
          <TextField
            label="Base URL"
            mono
            type="url"
            placeholder="https://evals.example.com/api"
            ref={(el) => {
              inputs.current.base_url = el;
            }}
            errorMessage={errors.base_url}
            value={baseUrl}
            onChange={(v) => {
              setBaseUrl(v);
              setErrors((e) => ({ ...e, base_url: undefined }));
            }}
            maxLength={500}
            isRequired
            help={
              <>
                Include the service&apos;s <code>EVAL_SERVER_PREFIX</code>; qym appends <code>/evals</code>. A
                URL registered in another project is refused.
              </>
            }
          />
          <TextField
            label="API key"
            mono
            type="password"
            autoComplete="new-password"
            ref={(el) => {
              inputs.current.api_key = el;
            }}
            errorMessage={errors.api_key}
            value={apiKey}
            onChange={(v) => {
              setApiKey(v);
              setErrors((e) => ({ ...e, api_key: undefined }));
            }}
            maxLength={4096}
            isRequired
            help="Stored encrypted; only its last four characters are shown afterwards."
          />
          {error ? (
            <div className={styles.callout} data-tone="error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      ) : step === 2 ? (
        form.isError ? (
          <ErrorState
            error={form.error}
            title="Could not load the generated form"
            onRetry={() => void form.refetch()}
            compact
          />
        ) : descriptor ? (
          <FormPreview descriptor={descriptor} />
        ) : (
          <Skeleton kind="lines" rows={6} label="Loading the generated form" />
        )
      ) : (
        <>
          <p className={styles.intro}>
            One card per LLM the service can call. Confirm the grouping so the launch form can bind project
            models to each slot; fields left out stay plain inputs.
          </p>
          <SlotEditor controller={editor} />
        </>
      )}
    </Dialog>
  );
}
