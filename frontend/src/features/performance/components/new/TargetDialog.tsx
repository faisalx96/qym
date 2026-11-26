/**
 * Add or edit a target: a name and an address, nothing is built in. Self-contained: it checks what was typed,
 * saves through the area's own write and tells the caller which target was saved. Only a project manager
 * may save; the caller opens it only for one, and the API refuses anyone else.
 */
import { useState } from 'react';
import {
  performanceError,
  useSavePerformanceTarget,
  type PerformanceSetupTarget,
  type PerformanceTarget,
  type SaveTargetRequest,
  type SaveTargetError,
} from '@/api/performance';
import { Button, Dialog, Disclosure, InlineNotice, NumberField, Switch, TextField } from '@/ui';
import { saveTargetErrorWords } from './errors';
import { span } from '../../lib/format';
import styles from './newRun.module.css';

export const DEFAULT_CHAT_PATH = '/change/api/chat';
export const DEFAULT_TOKEN_PATH = '/auth/token';
// PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME in db/models.py.
export const DEFAULT_REFRESH_COOKIE_NAME = 'estishraf_rt';

type KnownTarget = Pick<PerformanceSetupTarget, 'id' | 'name' | 'base_url'>;

export interface TargetDialogProps {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The target to change; absent or null: a new one. */
  target?: PerformanceSetupTarget | null;
  /** The targets that exist, for the "name taken" check. The API checks names and addresses again. */
  targets?: KnownTarget[];
  /** The platform's highest number of users; a target's own limit cannot be above it. */
  maxUsersLimit?: number;
  /** Called with the saved target, after the area was read again. */
  onSaved?: (target: PerformanceTarget) => void;
  /** What the form of a new target holds when it opens (the gallery, a test); empty otherwise. */
  initialForm?: Partial<TargetForm>;
}

export interface TargetForm {
  name: string;
  address: string;
  chatPath: string;
  tokenPath: string;
  /** NaN when the field is empty: no limit of its own. */
  maxUsers: number;
  production: boolean;
  authServer: string;
  cookieName: string;
  maxDurationMinutes: number;
}

export interface TargetFormCheck {
  /** Everything needed is there and nothing is wrong: Save is on. */
  ok: boolean;
  /** The original address for the API to validate; null while empty. */
  baseUrl: string | null;
  nameError: string | null;
  addressError: string | null;
  pathError: string | null;
  limitError: string | null;
  durationError: string | null;
  warnings: string[];
}

// Parsing here is only for warnings. The API validates and normalizes the original address.
function parseAddress(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const origin = (address: string) => parseAddress(address)?.origin.toLowerCase() ?? address.toLowerCase();

/** What is wrong with the form, and what the person should know before saving. */
export function checkTargetForm(
  form: TargetForm,
  {
    target = null,
    targets = [],
    maxUsersLimit,
  }: { target?: PerformanceSetupTarget | null; targets?: KnownTarget[]; maxUsersLimit?: number } = {},
): TargetFormCheck {
  const name = form.name.trim();
  const raw = form.address.trim();
  const others = targets.filter((other) => other.id !== target?.id);
  const warnings: string[] = [];
  const url = raw ? parseAddress(raw) : null;
  const addressError = null;
  if (url) {
    if (url.protocol === 'http:') warnings.push('This address is not encrypted (http).');
    if (target && target.tokens.length && origin(target.base_url) !== url.origin.toLowerCase())
      warnings.push(
        'The address changes, so the saved sign-in of this target is cleared. Paste the tokens of the new address after saving.',
      );
    else if (target && target.tokens.length && form.tokenPath.trim() !== target.token_refresh_path)
      warnings.push(
        'The sign-in renewal path changes, so the saved sign-in of this target is cleared. Paste the tokens again after saving.',
      );
  }
  if (
    target?.tokens.length &&
    (form.authServer.trim() !== (target.settings.auth_server ?? '') ||
      (form.cookieName.trim() || DEFAULT_REFRESH_COOKIE_NAME) !== target.settings.refresh_cookie_name)
  )
    warnings.push(
      'The sign-in settings change, so the saved sign-in of this target is cleared. Paste the tokens again after saving.',
    );
  const nameError =
    name.length > 200
      ? 'A name has at most 200 characters.'
      : name && others.some((other) => other.name.trim().toLowerCase() === name.toLowerCase())
        ? 'Another target already has this name.'
        : null;
  const pathError = [form.chatPath, form.tokenPath].every((path) => /^\/\S*$/.test(path.trim()))
    ? null
    : 'A path starts with / and has no spaces.';
  const limit = form.maxUsers;
  const limitError = Number.isNaN(limit)
    ? null
    : limit < 1 || !Number.isInteger(limit)
      ? 'Enter a whole number of users, 1 or more, or leave the field empty.'
      : maxUsersLimit !== undefined && limit > maxUsersLimit
        ? `The platform allows at most ${maxUsersLimit} users.`
        : null;
  const durationError =
    Number.isNaN(form.maxDurationMinutes) ||
    (Number.isInteger(form.maxDurationMinutes) && form.maxDurationMinutes >= 1)
      ? null
      : 'Enter whole minutes, 1 or more, or leave the field empty.';
  return {
    ok: Boolean(name && raw && !nameError && !pathError && !limitError && !durationError),
    baseUrl: raw || null,
    nameError,
    addressError,
    pathError,
    limitError,
    durationError,
    warnings,
  };
}

const formOf = (target: PerformanceSetupTarget | null | undefined): TargetForm => ({
  name: target?.name ?? '',
  address: target?.base_url ?? '',
  chatPath: target?.chat_path ?? DEFAULT_CHAT_PATH,
  tokenPath: target?.token_refresh_path ?? DEFAULT_TOKEN_PATH,
  maxUsers: target?.max_users ?? Number.NaN,
  production: target?.is_production ?? false,
  authServer: target?.settings.auth_server ?? '',
  cookieName: target?.settings.refresh_cookie_name ?? '',
  maxDurationMinutes: target?.max_duration_s == null ? Number.NaN : Math.ceil(target.max_duration_s / 60),
});

export function TargetDialog(props: TargetDialogProps) {
  // A new body on every opening, so what was typed last time is gone.
  return props.open ? <TargetDialogBody key={props.target?.id ?? 'new'} {...props} /> : null;
}

function TargetDialogBody({
  slug,
  open,
  onOpenChange,
  target = null,
  targets = [],
  maxUsersLimit,
  onSaved,
  initialForm,
}: TargetDialogProps) {
  const [form, setForm] = useState(() => ({ ...formOf(target), ...(target ? {} : initialForm) }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof TargetForm, string>>>({});
  const [durationEdited, setDurationEdited] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    Boolean(form.authServer || form.cookieName || !Number.isNaN(form.maxDurationMinutes)),
  );
  const save = useSavePerformanceTarget(slug);
  const check = checkTargetForm(form, { target, targets, maxUsersLimit });
  const set = <K extends keyof TargetForm>(key: K, value: TargetForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'maxDurationMinutes') setDurationEdited(true);
  };
  const chat = form.chatPath.trim();
  const token = form.tokenPath.trim();

  async function submit() {
    if (!check.ok || !check.baseUrl || save.isPending) return;
    const body: SaveTargetRequest = {
      name: form.name.trim(),
      is_production: form.production,
      base_url: check.baseUrl,
      chat_path: chat,
      token_refresh_path: token,
      max_users: Number.isNaN(form.maxUsers) ? null : form.maxUsers,
      max_duration_s:
        target && !durationEdited
          ? target.max_duration_s
          : Number.isNaN(form.maxDurationMinutes)
            ? null
            : form.maxDurationMinutes * 60,
      settings: {
        auth_server: form.authServer.trim() || null,
        refresh_cookie_name: form.cookieName.trim() || DEFAULT_REFRESH_COOKIE_NAME,
      },
    };
    try {
      const saved = await save.mutateAsync({ id: target?.id, body });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (refused) {
      const failure = performanceError<SaveTargetError>(refused);
      const fields: Record<string, keyof TargetForm> = {
        name: 'name',
        base_url: 'address',
        chat_path: 'chatPath',
        token_refresh_path: 'tokenPath',
        'settings.auth_server': 'authServer',
        'settings.refresh_cookie_name': 'cookieName',
        max_users: 'maxUsers',
        max_duration_s: 'maxDurationMinutes',
      };
      const errors: Partial<Record<keyof TargetForm, string>> = {};
      if (failure?.code === 'validation' && Array.isArray(failure.details)) {
        for (const detail of failure.details) {
          const field = fields[detail.loc.filter((part) => part !== 'body').join('.')];
          if (field) errors[field] = detail.msg;
        }
      } else if (failure?.code === 'over_platform_limit') {
        const field = fields[failure.details.field];
        if (field) errors[field] = failure.message;
      } else if (failure?.code === 'target_address_taken') {
        errors.address = failure.message;
      }
      setFieldErrors(errors);
      if (errors.authServer || errors.cookieName || errors.maxDurationMinutes) setAdvancedOpen(true);
      setError(Object.keys(errors).length ? null : saveTargetErrorWords(refused));
    }
  }

  const missing = !form.name.trim()
    ? 'Type a name first'
    : !form.address.trim()
      ? 'Type the address first'
      : 'Fix what is marked first';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={target ? 'Edit target' : 'Add a target'}
      footer={
        <>
          <Button size="md" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="md"
            variant="primary"
            onPress={() => void submit()}
            isDisabled={!check.ok}
            disabledReason={missing}
            loading={save.isPending}
          >
            {target ? 'Save changes' : 'Save target'}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-performance-block="target-form">
        <TextField
          label="Name"
          isRequired
          autoFocus
          value={form.name}
          onChange={(value) => set('name', value)}
          placeholder="Playground 31"
          autoComplete="off"
          help="What this environment is called in lists and reports."
          errorMessage={fieldErrors.name ?? check.nameError ?? undefined}
        />
        <TextField
          label="Address"
          isRequired
          mono
          value={form.address}
          onChange={(value) => set('address', value)}
          placeholder="https://insightor.playground31.example.org"
          autoComplete="off"
          help="The address Insightor opens at in the browser on this environment."
          errorMessage={fieldErrors.address ?? check.addressError ?? undefined}
        />
        <div className={styles.tight}>
          <div className={styles.formPair}>
            <TextField
              label="Chat path"
              mono
              value={form.chatPath}
              onChange={(value) => set('chatPath', value)}
              errorMessage={fieldErrors.chatPath}
              autoComplete="off"
            />
            <TextField
              label="Sign-in renewal path"
              mono
              value={form.tokenPath}
              onChange={(value) => set('tokenPath', value)}
              errorMessage={fieldErrors.tokenPath}
              autoComplete="off"
            />
          </div>
          {check.pathError ? (
            <p className={styles.note} role="alert">
              {check.pathError}
            </p>
          ) : null}
        </div>
        <NumberField
          label="Highest number of users allowed"
          value={form.maxUsers}
          onChange={(value) => set('maxUsers', value)}
          minValue={1}
          maxValue={maxUsersLimit}
          help="Leave empty for no limit of its own. A plan that goes higher cannot be started on this target."
          isInvalid={Boolean(fieldErrors.maxUsers ?? check.limitError)}
          errorMessage={fieldErrors.maxUsers ?? check.limitError ?? undefined}
        />
        <div className={styles.tight}>
          <Switch isSelected={form.production} onChange={(value) => set('production', value)}>
            This is production
          </Switch>
          <p className={styles.note}>
            A run on it then needs a manager, and the name of the target typed as a confirmation.
          </p>
        </div>
        <Disclosure title="Advanced" open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className={styles.form}>
            <TextField
              label="Sign-in server"
              mono
              value={form.authServer}
              onChange={(value) => set('authServer', value)}
              autoComplete="off"
              help="Only when sign-in is on another address than the chat. Empty: the address above."
              errorMessage={fieldErrors.authServer}
            />
            <TextField
              label="Sign-in cookie name"
              mono
              value={form.cookieName}
              onChange={(value) => set('cookieName', value)}
              autoComplete="off"
              placeholder={DEFAULT_REFRESH_COOKIE_NAME}
              help="The cookie that carries the refresh token. Empty: the default."
              errorMessage={fieldErrors.cookieName}
            />
            <NumberField
              label="Longest run, minutes"
              value={form.maxDurationMinutes}
              onChange={(value) => set('maxDurationMinutes', value)}
              minValue={1}
              step={1}
              help={
                <>
                  Runs longer than this cannot be started against this target. Whole minutes only; leave empty
                  for no limit of its own.
                  {target?.max_duration_s && target.max_duration_s % 60 && !durationEdited
                    ? ` Saved limit: ${span(target.max_duration_s)}; kept unless you change this field.`
                    : null}
                </>
              }
              isInvalid={Boolean(fieldErrors.maxDurationMinutes ?? check.durationError)}
              errorMessage={fieldErrors.maxDurationMinutes ?? check.durationError ?? undefined}
            />
          </div>
        </Disclosure>
        {check.warnings.map((warning) => (
          <InlineNotice key={warning} tone="warning">
            {warning}
          </InlineNotice>
        ))}
        {check.baseUrl && !check.addressError && !check.pathError ? (
          <dl className={`${styles.facts} ${styles.rule}`}>
            <dt>Questions go to</dt>
            <dd className={styles.host}>
              {check.baseUrl}
              {chat}
            </dd>
            <dt>Sign-in is renewed at</dt>
            <dd className={styles.host}>
              {form.authServer.trim() || check.baseUrl}
              {token}
            </dd>
          </dl>
        ) : (
          <p className={`${styles.note} ${styles.rule}`}>
            Type a name and the address to see where the questions will go.
          </p>
        )}
        <p className={styles.note}>
          {target
            ? 'Runs that already finished keep the address they ran against.'
            : 'After saving, paste the sign-in tokens of this environment. Then it can be used for runs.'}
        </p>
        {error ? (
          <InlineNotice tone="danger" lead="Not saved.">
            {error}
          </InlineNotice>
        ) : null}
      </div>
    </Dialog>
  );
}
