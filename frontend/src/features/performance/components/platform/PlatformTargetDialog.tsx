import { useState } from 'react';
import { performanceError } from '@/api/performance';
import {
  PLATFORM_TARGET_SETTINGS,
  useSavePlatformTarget,
  useSavePlatformSessionCookie,
  type PlatformTarget,
} from '@/api/performancePlatform';
import { Button, Dialog, Disclosure, InlineNotice, NumberField, StateTag, Switch, TextField } from '@/ui';
import { PlatformSignIn } from './SessionDialog';
import { ROUTE_LABELS, PLATFORM_NAME, COOKIE_INSTRUCTIONS, signInError, platformError } from './words';
import styles from './platform.module.css';

export function PlatformTargetDialog({
  slug,
  target,
  onClose,
  onSaved,
  onChangeKind,
  maxUsersLimit,
}: {
  slug: string;
  target?: PlatformTarget | null;
  onClose: () => void;
  onSaved?: (target: PlatformTarget) => void;
  onChangeKind?: () => void;
  maxUsersLimit?: number;
}) {
  const [saved, setSaved] = useState(target ?? null);
  const [name, setName] = useState(target?.name ?? '');
  const [address, setAddress] = useState(target?.base_url ?? '');
  const [production, setProduction] = useState(target?.is_production ?? false);
  const [maxUsers, setMaxUsers] = useState(target?.max_users ?? NaN);
  const [minutes, setMinutes] = useState(target?.max_duration_s == null ? NaN : target.max_duration_s / 60);
  const [settings, setSettings] = useState(() =>
    structuredClone(target?.settings ?? PLATFORM_TARGET_SETTINGS),
  );
  const [cookie, setCookie] = useState('');
  const [cookieError, setCookieError] = useState<string>();
  const session = useSavePlatformSessionCookie(slug);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useSavePlatformTarget(slug);
  const [advanced, setAdvanced] = useState(false);
  async function submit(close: boolean) {
    setError(undefined);
    setFields({});
    try {
      const result = await save.mutateAsync({
        id: saved?.id,
        body: {
          kind: 'estishraf_platform',
          name: name.trim(),
          base_url: address.trim(),
          is_production: production,
          max_users: Number.isNaN(maxUsers) ? null : maxUsers,
          max_duration_s: Number.isNaN(minutes) ? null : minutes * 60,
          settings,
        },
      });
      setSaved(result);
      if (cookie.trim()) {
        const token = cookie;
        setCookie('');
        try {
          const hint = await session.mutateAsync({ targetId: result.id, body: { token, expires_at: null } });
          setSaved({ ...result, tokens: [hint], sign_in_ready: !hint.expired });
        } catch (caught) {
          setCookieError(signInError(caught));
          return;
        }
      }
      if (close) {
        onSaved?.(result);
        onClose();
      }
    } catch (caught) {
      const refusal = performanceError<{ status: number; code: string; message: string; details: unknown }>(
        caught,
      );
      const fieldMessage = refusal?.message ?? platformError(caught);
      const field =
        refusal?.code === 'target_address_has_path' || refusal?.code === 'target_address_taken'
          ? 'base_url'
          : refusal?.code === 'target_name_taken'
            ? 'name'
            : null;
      const detail =
        refusal?.details && !Array.isArray(refusal.details) && typeof refusal.details === 'object'
          ? (refusal.details as { field?: string; route?: string })
          : null;
      const namedField = detail?.field ?? (detail?.route ? `settings.routes.${detail.route}` : null);
      if (
        namedField &&
        ([
          'name',
          'base_url',
          'max_users',
          'max_duration_s',
          'settings.client_id',
          'settings.request_timeout_seconds',
        ].includes(namedField) ||
          namedField.startsWith('settings.routes.'))
      ) {
        setFields({ [namedField]: fieldMessage });
        if (namedField.startsWith('settings.') || namedField === 'max_duration_s') setAdvanced(true);
      } else if (field) setFields({ [field]: fieldMessage });
      else if (Array.isArray(refusal?.details)) {
        const errors: Record<string, string> = {};
        for (const issue of refusal.details as { loc?: string[]; msg?: string }[])
          if (issue.loc && issue.msg) errors[issue.loc.filter((key) => key !== 'body').join('.')] = issue.msg;
        setFields(errors);
        if (Object.keys(errors).some((key) => key.startsWith('settings') || key === 'max_duration_s'))
          setAdvanced(true);
        if (!Object.keys(errors).length) setError(platformError(caught));
      } else setError(platformError(caught));
    }
  }
  const valid = Boolean(name.trim() && address.trim());
  return (
    <Dialog
      open
      title={target ? 'Edit target' : 'Add a platform target'}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        <>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending || session.isPending}
            isDisabled={!valid}
            disabledReason="Enter a name and address"
            onPress={() => void submit(true)}
          >
            {target ? 'Save changes' : 'Save target'}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <div className={styles.row}>
          <StateTag tone="neutral">{PLATFORM_NAME}</StateTag>
          {!saved && onChangeKind ? (
            <Button onPress={onChangeKind}>Change kind</Button>
          ) : (
            <span className={styles.note}>Kind is set when the target is added.</span>
          )}
        </div>
        <TextField
          label="Name"
          isRequired
          value={name}
          onChange={setName}
          errorMessage={fields.name}
          help="What this environment is called in lists and reports."
        />
        <TextField
          label="Address"
          isRequired
          value={address}
          onChange={setAddress}
          errorMessage={fields.base_url}
          help="The address origin only. Put path prefixes in Advanced route settings."
        />
        {target || saved?.sign_in_ready ? (
          <PlatformSignIn slug={slug} target={saved ?? target!} />
        ) : (
          <div className={styles.stack}>
            <div className={styles.row}>
              <strong>Sign-in</strong>
              <StateTag tone="warning">Needed</StateTag>
            </div>
            <TextField
              label="Cookie header"
              type="password"
              autoComplete="off"
              value={cookie}
              onChange={setCookie}
              errorMessage={cookieError}
              help={COOKIE_INSTRUCTIONS}
            />
            <Button
              variant="accent"
              isDisabled={!valid || !cookie.trim()}
              disabledReason="Enter the target name, address and Cookie header first"
              loading={save.isPending || session.isPending}
              onPress={() => void submit(false)}
            >
              Save sign-in
            </Button>
            <p className={styles.note}>
              The value is hidden after saving. All users in the run share this sign-in.
            </p>
          </div>
        )}

        <NumberField
          label="Highest number of users allowed"
          value={maxUsers}
          onChange={setMaxUsers}
          minValue={1}
          maxValue={maxUsersLimit}
          isInvalid={Boolean(fields.max_users)}
          errorMessage={fields.max_users}
          help="A plan that goes higher cannot be started on this target."
        />
        <Switch isSelected={production} onChange={setProduction}>
          This is production
        </Switch>
        <p className={styles.note}>
          A run on production needs a manager and the target name typed as confirmation.
        </p>
        <Disclosure title="Advanced" open={advanced} onOpenChange={setAdvanced}>
          <div className={styles.stack}>
            {Object.entries(settings.routes).map(([key, value]) => (
              <TextField
                key={key}
                label={ROUTE_LABELS[key] ?? 'Route'}
                value={value}
                mono
                onChange={(next) =>
                  setSettings((old) => ({ ...old, routes: { ...old.routes, [key]: next } }))
                }
                errorMessage={fields[`settings.routes.${key}`]}
              />
            ))}
            <TextField
              label="Client id"
              value={settings.client_id}
              onChange={(client_id) => setSettings((old) => ({ ...old, client_id }))}
              errorMessage={fields['settings.client_id']}
            />
            <NumberField
              label="Request timeout, seconds"
              value={settings.request_timeout_seconds ?? NaN}
              onChange={(value) =>
                setSettings((old) => ({
                  ...old,
                  request_timeout_seconds: Number.isNaN(value) ? null : value,
                }))
              }
              help="Leave empty for automatic selection."
              isInvalid={Boolean(fields['settings.request_timeout_seconds'])}
              errorMessage={fields['settings.request_timeout_seconds']}
            />
            <NumberField
              label="Longest run, minutes"
              value={minutes}
              onChange={setMinutes}
              minValue={1}
              isInvalid={Boolean(fields.max_duration_s)}
              errorMessage={fields.max_duration_s}
              help="Leave empty to use the platform limit."
            />
          </div>
        </Disclosure>
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      </div>
    </Dialog>
  );
}
