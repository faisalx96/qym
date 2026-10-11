/** Status, Schema and LLM model groups sections of an environment. */
import { useState } from 'react';
import {
  useEnvironmentForm,
  useModelSlots,
  useRefreshSchema,
  useTestEnvironment,
  useUpdateEnvironment,
  type SchemaDiff,
} from '@/api/evalEnvironments';
import { errorMessage, type EvalEnvironment } from '@/api/evalCommon';
import { Button, ErrorState, Skeleton, Tag, useToast } from '@/ui';
import { DefaultPresetTag, HealthCell } from './cells';
import { absTime, relTime, shortHash } from './format';
import styles from './EnvironmentPage.module.css';
import { Section } from './Section';
import { SlotCard, SlotEditorDialog } from './SlotEditor';
import { countFields } from './slotLogic';

interface BaseProps {
  projectId: string;
  env: EvalEnvironment;
  canEdit: boolean;
}

// ------------------------------------------------------------------ Status

export function StatusSection({ projectId, env, canEdit }: BaseProps) {
  const test = useTestEnvironment(projectId);
  const update = useUpdateEnvironment(projectId, env.id);
  const toast = useToast();

  async function runTest() {
    try {
      const r = await test.mutateAsync(env.id);
      if (r.ok) {
        toast.show(
          r.schema_changed
            ? `“${env.name}” is healthy; its schema changed, refresh it to update the form.`
            : `“${env.name}” is healthy`,
          { tone: 'success' },
        );
      } else
        toast.show(`“${env.name}” failed: ${r.error || 'unreachable'}`, { tone: 'error', timeout: 8000 });
    } catch (e) {
      toast.show(errorMessage(e) || 'Test failed', { tone: 'error', timeout: 8000 });
    }
  }

  async function reactivate() {
    try {
      await update.mutateAsync({ is_active: true });
      toast.show(`“${env.name}” re-enabled`, { tone: 'success' });
    } catch (e) {
      toast.show(errorMessage(e) || 'Could not re-enable the environment.', { tone: 'error' });
    }
  }

  return (
    <Section
      id="env-status"
      title="Status"
      actions={
        canEdit ? (
          <>
            {!env.is_active ? (
              <Button variant="accent" loading={update.isPending} onPress={() => void reactivate()}>
                Re-enable
              </Button>
            ) : null}
            <Button variant="neutral" loading={test.isPending} onPress={() => void runTest()}>
              Test connection
            </Button>
          </>
        ) : null
      }
    >
      <dl className={styles.kv}>
        <dt>State</dt>
        <dd>{env.is_active ? 'Active' : <Tag tone="warning">Disabled</Tag>}</dd>
        <dt>Health</dt>
        <dd>
          <HealthCell env={env} />
          {env.health_status === 'error' && env.health_error ? (
            <div className={styles.errorText}>{env.health_error}</div>
          ) : null}
        </dd>
        <dt>API key</dt>
        <dd>
          {env.api_key_set ? (
            <span className={styles.mono}>{env.api_key_hint || 'set'}</span>
          ) : (
            <Tag tone="warning">Not set</Tag>
          )}
        </dd>
        <dt>Default preset</dt>
        <dd>
          <DefaultPresetTag env={env} />
        </dd>
        <dt>Created</dt>
        <dd>
          <span className={styles.mono}>{absTime(env.created_at) || '—'}</span>
        </dd>
      </dl>
    </Section>
  );
}

// ------------------------------------------------------------------ Schema

const DIFF_LIMIT = 50;

export function SchemaDiffBlock({ diff }: { diff: SchemaDiff }) {
  if (!diff.changed) {
    return (
      <div className={styles.callout} role="status">
        Schema unchanged <span className={styles.mono}>{shortHash(diff.schema_hash)}</span>.
      </div>
    );
  }
  const first = !diff.previous_schema_id;
  const lines: { kind: 'added' | 'removed' | 'changed'; mark: string; text: string; meta?: string }[] = [
    ...diff.added.map((p) => ({ kind: 'added' as const, mark: '+', text: p })),
    ...diff.removed.map((p) => ({ kind: 'removed' as const, mark: '−', text: p })),
    ...diff.changed_types.map((c) => ({
      kind: 'changed' as const,
      mark: '~',
      text: c.pointer,
      meta: `${c.from} → ${c.to}`,
    })),
  ];
  return (
    <div className={styles.diff} role="status">
      <div className={styles.diffSummary}>
        {first ? 'First schema stored' : 'Schema changed'} ·{' '}
        <span className={styles.mono}>{shortHash(diff.schema_hash)}</span> · {diff.added.length} added ·{' '}
        {diff.removed.length} removed · {diff.changed_types.length} type changes
      </div>
      <ul className={styles.diffList}>
        {lines.slice(0, DIFF_LIMIT).map((l, i) => (
          <li key={i} data-kind={l.kind}>
            <span aria-hidden="true">{l.mark}</span> {l.text}{' '}
            {l.meta ? <span className={styles.muted}>{l.meta}</span> : null}
          </li>
        ))}
        {lines.length > DIFF_LIMIT ? (
          <li className={styles.muted}>and {lines.length - DIFF_LIMIT} more</li>
        ) : null}
      </ul>
    </div>
  );
}

export function SchemaSection({
  projectId,
  env,
  canEdit,
  onNeedsGrouping,
}: BaseProps & { onNeedsGrouping?: () => void }) {
  const form = useEnvironmentForm(projectId, env.id);
  const refresh = useRefreshSchema(projectId, env.id);
  const toast = useToast();
  const [diff, setDiff] = useState<SchemaDiff | null>(null);

  async function run() {
    try {
      const result = await refresh.mutateAsync();
      setDiff(result);
      if (canEdit && result.needs_confirmation) onNeedsGrouping?.();
    } catch (e) {
      toast.show(errorMessage(e) || 'Schema refresh failed', { tone: 'error', timeout: 8000 });
    }
  }

  return (
    <Section
      id="env-schema"
      title="Schema"
      description="The launch form is generated from the service's env-overrides schema."
      actions={
        canEdit ? (
          <Button variant="neutral" loading={refresh.isPending} onPress={() => void run()}>
            Refresh schema
          </Button>
        ) : null
      }
    >
      <dl className={styles.kv}>
        <dt>Hash</dt>
        <dd>
          {env.schema_hash ? (
            <span className={styles.mono} title={env.schema_hash}>
              {shortHash(env.schema_hash)}
            </span>
          ) : (
            '—'
          )}
        </dd>
        <dt>Fetched</dt>
        <dd>
          <span className={styles.mono} title={absTime(env.schema_fetched_at)}>
            {relTime(env.schema_fetched_at) || '—'}
          </span>
        </dd>
        <dt>Settings</dt>
        <dd>
          <span className={styles.mono}>{form.data ? countFields(form.data.descriptor) : '—'}</span>
        </dd>
      </dl>
      {diff ? <SchemaDiffBlock diff={diff} /> : null}
    </Section>
  );
}

// ------------------------------------------------------------------ LLM groups

export function SlotsSection({
  projectId,
  env,
  canEdit,
  dialogOpen,
  onDialogOpenChange,
}: BaseProps & { dialogOpen: boolean; onDialogOpenChange: (open: boolean) => void }) {
  const slots = useModelSlots(projectId, env.id);
  const form = useEnvironmentForm(projectId, env.id);
  const needs = (slots.data?.slots ?? []).some((s) => s.status !== 'confirmed');
  return (
    <Section
      id="env-slots"
      title="LLM model groups"
      description="Each group is one LLM picked at launch, and the sets of keys its model fills."
      actions={
        canEdit && form.data ? (
          <Button variant={needs ? 'accent' : 'neutral'} onPress={() => onDialogOpenChange(true)}>
            {needs ? 'Group LLM settings' : 'Edit groups'}
          </Button>
        ) : null
      }
    >
      {slots.isError ? (
        <ErrorState
          error={slots.error}
          title="Could not load the LLM groups"
          onRetry={() => void slots.refetch()}
          compact
        />
      ) : slots.isPending ? (
        <Skeleton kind="cards" count={2} label="Loading LLM groups" />
      ) : (
        <>
          {needs ? (
            <div className={styles.callout} data-tone="warning" role="note">
              Group LLM settings to pick project models. Until then the launch form shows LLM fields as raw
              inputs.
            </div>
          ) : null}
          {slots.data.slots.length ? (
            slots.data.slots.map((slot) => <SlotCard key={slot.slot_key} slot={slot} />)
          ) : (
            <div className={styles.empty}>No LLM settings detected in this schema.</div>
          )}
        </>
      )}
      {canEdit ? (
        <SlotEditorDialog
          projectId={projectId}
          env={env}
          open={dialogOpen}
          onOpenChange={onDialogOpenChange}
        />
      ) : null}
    </Section>
  );
}
