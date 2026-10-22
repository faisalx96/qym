import { useState } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { AddEnvironmentDialog } from '@/features/environments/AddEnvironmentDialog';
import { SlotEditorDialog } from '@/features/environments/SlotEditor';
import { Button, Checkbox, Icon, LinkButton, Tag } from '@/ui';
import { environmentPath } from '../../paths';
import { pairCount, PSEUDO, pointerToFieldName, unitsFor } from '../model';
import { useLaunch } from '../LaunchContext';
import { EnvTask } from './TaskRow';
import { EnvVersions } from './VersionsBlock';
import styles from './entry.module.css';

/** What a ticked environment will receive when the experiment names two or more dataset versions. */
export function shapeTag(
  pairs: number,
  runShape: 'combined' | 'one_each',
  acceptsDatasets: boolean,
): { text: string; tone: 'info' | 'warning' } | null {
  const units = unitsFor(pairs, runShape, acceptsDatasets);
  if (units.mode === 'single') return null;
  if (units.mode === 'combined') return { text: '1 combined run', tone: 'info' };
  return units.reason === 'service_without_datasets'
    ? { text: `${units.units} runs, one per dataset version (older service)`, tone: 'warning' }
    : { text: `${units.units} runs, one per dataset version`, tone: 'info' };
}

function EnvironmentTags({
  env,
  checking,
  error,
  shape,
}: {
  env: EvalEnvironment;
  checking: boolean;
  error: string;
  shape: { text: string; tone: 'info' | 'warning' } | null;
}) {
  return (
    <span className={styles.envTags}>
      {env.health_status === 'ok' ? (
        <Tag tone="success">Healthy</Tag>
      ) : env.health_status === 'error' ? (
        <Tag tone="danger" title={env.health_error ?? undefined}>
          Unhealthy
        </Tag>
      ) : (
        <Tag>Not checked</Tag>
      )}
      {!env.current_schema_id ? <Tag tone="warning">No schema</Tag> : null}
      {env.model_slots?.needs_confirmation ? <Tag tone="warning">Needs LLM grouping</Tag> : null}
      {checking ? <Tag tone="info">Checking schema…</Tag> : null}
      {error ? (
        <Tag tone="danger" title={error}>
          Schema check failed
        </Tag>
      ) : null}
      <Tag>Priority up to {env.max_priority}</Tag>
      {env.official_preset_version != null ? (
        <Tag kind="version">Default preset v{env.official_preset_version}</Tag>
      ) : null}
      {shape ? (
        <Tag tone={shape.tone} data-testid="env-shape-tag">
          {shape.text}
        </Tag>
      ) : null}
    </span>
  );
}

/**
 * The environments checkbox list: health, schema, grouping and preset tags, "Details", "+ New environment".
 * A ticked environment's box also shows the Evaluation Service versions it would record (`EnvVersions`).
 */
export function EnvironmentPicker() {
  const {
    envRecords,
    doc,
    toggleEnv,
    schemaStatus,
    canManage,
    readOnly,
    projectId,
    slug,
    reloadSlots,
    registerField,
  } = useLaunch();
  const pairs = pairCount(doc);
  const [adding, setAdding] = useState(false);
  const [grouping, setGrouping] = useState<EvalEnvironment | null>(null);
  return (
    <fieldset
      className={styles.fieldset}
      ref={(el) => registerField(pointerToFieldName(PSEUDO.environments), el)}
      aria-describedby="launch-env-help"
    >
      <legend className={styles.legend}>Environments</legend>
      <ul className={styles.envList}>
        {envRecords.map((env) => {
          const selected = doc.environmentIds.includes(env.id);
          const status = schemaStatus[env.id];
          return (
            <li key={env.id} className={styles.env} data-selected={selected}>
              <Checkbox isSelected={selected} isDisabled={readOnly} onChange={(on) => toggleEnv(env.id, on)}>
                {env.name}
              </Checkbox>
              <EnvironmentTags
                env={env}
                checking={Boolean(status?.checking)}
                error={status?.error ?? ''}
                shape={
                  selected
                    ? shapeTag(pairs, doc.selection.runShape, Boolean(env.evaluator_capabilities?.datasets))
                    : null
                }
              />
              <span className={styles.envActions}>
                {canManage && env.model_slots?.needs_confirmation ? (
                  <Button size="sm" variant="neutral" onPress={() => setGrouping(env)}>
                    Group LLM settings
                  </Button>
                ) : null}
                <LinkButton
                  to={environmentPath(slug, env.id)}
                  variant="ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Details of ${env.name} (opens in a new tab)`}
                >
                  Details
                </LinkButton>
              </span>
              {selected ? <EnvVersions env={env} projectId={projectId} /> : null}
              {selected ? <EnvTask env={env} projectId={projectId} /> : null}
            </li>
          );
        })}
      </ul>
      <p id="launch-env-help" className={styles.help}>
        Pick several to run the same configuration on each. Settings are the union of their forms.
      </p>
      {canManage && !readOnly ? (
        <div>
          <Button size="sm" variant="neutral" icon={<Icon name="plus" />} onPress={() => setAdding(true)}>
            New environment
          </Button>
        </div>
      ) : null}
      {adding ? (
        <AddEnvironmentDialog
          projectId={projectId}
          open
          onOpenChange={setAdding}
          onCreated={(env) => toggleEnv(env.id, true)}
        />
      ) : null}
      {grouping ? (
        <SlotEditorDialog
          projectId={projectId}
          env={grouping}
          open
          onOpenChange={(open) => !open && setGrouping(null)}
          onSaved={() => void reloadSlots(grouping.id)}
        />
      ) : null}
    </fieldset>
  );
}
