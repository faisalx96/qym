/** Default preset (current version + history) and saved presets of one environment. */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useModelOptions,
  usePresets,
  usePresetVersions,
  type PresetConfig,
  type PresetVersion,
  type PresetWarning,
  type Preset,
} from '@/api/evalEnvironments';
import type { EvalEnvironment } from '@/api/evalCommon';
import { Button, DataTable, ErrorState, JsonTree, Skeleton, Tag, type Column } from '@/ui';
import { defaultPresetEditPath, launchPath } from '@/features/experiments/paths';
import { absTime, relTime, shortHash } from './format';
import styles from './EnvironmentPage.module.css';
import { Section } from './Section';

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** env_overrides -> [["A.B", value]] for the read-only view. */
export function flattenSettings(
  node: unknown,
  prefix = '',
  out: [string, unknown][] = [],
): [string, unknown][] {
  if (!isObject(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isObject(value) && !(Object.keys(value).length === 1 && Array.isArray(value.sweep)))
      flattenSettings(value, name, out);
    else out.push([name, value]);
  }
  return out;
}

const formatValue = (v: unknown) => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function Warnings({ warnings }: { warnings: PresetWarning[] | undefined }) {
  const items = (warnings ?? []).map((w) => w?.message).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className={styles.callout} data-tone="warning" role="note">
      <strong>Check before launching</strong>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function KvList({ rows }: { rows: [string, unknown][] }) {
  if (!rows.length) return <span className={styles.muted}>None</span>;
  return (
    <ul className={styles.kvList}>
      {rows.map(([name, value]) => (
        <li key={name}>
          <span className={styles.kvName}>{name}</span> ={' '}
          <span className={styles.kvValue}>{formatValue(value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Read-only view of one stored version (history is never edited). */
export function VersionView({
  version,
  modelNames,
}: {
  version: PresetVersion;
  modelNames: Record<string, string>;
}) {
  const config: PresetConfig = isObject(version.config) ? version.config : {};
  const evaluator = isObject(config.evaluator) ? config.evaluator : {};
  const bindings = isObject(config.slot_bindings) ? config.slot_bindings : {};
  const models = Object.entries(bindings).map(([key, b]) => {
    let text = 'Inherit';
    if (isObject(b) && typeof b.connection_id === 'string')
      text = modelNames[b.connection_id] || (typeof b.name === 'string' ? b.name : b.connection_id);
    else if (isObject(b) && isObject(b.temporary))
      text = `Temporary: ${String(b.temporary.label || b.temporary.model || key)}`;
    return `${key}: ${text}`;
  });
  const inputs = isObject(evaluator.config) ? flattenSettings(evaluator.config) : [];
  const settings = flattenSettings(config.env_overrides);
  const dataset =
    typeof evaluator.dataset === 'string' && evaluator.dataset
      ? evaluator.dataset + (evaluator.dataset_version ? ` · ${String(evaluator.dataset_version)}` : '')
      : 'None';
  return (
    <div className={styles.body}>
      <dl className={styles.kv}>
        <dt>Dataset</dt>
        <dd className={styles.mono}>{dataset}</dd>
        <dt>Models</dt>
        <dd>{models.join('; ') || 'Inherit'}</dd>
        <dt>Inputs</dt>
        <dd>
          <KvList rows={inputs} />
        </dd>
        <dt>Settings</dt>
        <dd>
          <KvList rows={settings} />
        </dd>
        <dt>Schema</dt>
        <dd>
          <span className={styles.mono} title={version.schema_hash}>
            {shortHash(version.schema_hash) || '—'}
          </span>{' '}
          {version.schema_current === false ? (
            <Tag tone="warning" title="Re-mapped onto the current schema when used">
              older schema
            </Tag>
          ) : null}
        </dd>
      </dl>
      <details className={styles.jsonDetails}>
        <summary>Config document (read-only)</summary>
        <JsonTree data={config} expandDepth={1} label={`Config of v${version.version}`} />
      </details>
    </div>
  );
}

function VersionItem({
  version,
  isCurrent,
  modelNames,
  writable,
  onEditFrom,
}: {
  version: PresetVersion;
  isCurrent: boolean;
  modelNames: Record<string, string>;
  writable: boolean;
  onEditFrom: (version: number) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={styles.version}
      data-version={version.version}
      onToggle={(e) => e.currentTarget.open && setOpened(true)}
    >
      <summary className={styles.versionSummary}>
        <Tag kind="version">v{version.version}</Tag>
        {isCurrent ? <Tag tone="success">current</Tag> : null}
        <span>{version.published_by?.name || 'Unknown'}</span>
        <span className={styles.mono} title={absTime(version.published_at)}>
          {relTime(version.published_at)}
        </span>
        <span className={styles.versionNotes}>{version.notes || ''}</span>
      </summary>
      {opened ? (
        <div className={styles.versionBody}>
          {version.notes ? <div>{version.notes}</div> : null}
          <Warnings warnings={version.warnings} />
          <VersionView version={version} modelNames={modelNames} />
          {writable && !isCurrent ? (
            <div>
              <Button
                variant="neutral"
                onPress={() => onEditFrom(version.version)}
                aria-label={`Open the editor with v${version.version} as a draft; nothing is published until you publish`}
              >
                Edit from v{version.version}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function PresetsSection({
  projectId,
  slug,
  env,
  canEdit,
}: {
  projectId: string;
  slug: string;
  env: EvalEnvironment;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const presets = usePresets(projectId, env.id);
  const options = useModelOptions(projectId, env.id);
  const official = presets.data?.presets.find((p) => p.kind === 'official') ?? null;
  const saved = useMemo(
    () => (presets.data?.presets ?? []).filter((p) => p.kind === 'saved'),
    [presets.data],
  );
  const versions = usePresetVersions(projectId, env.id, official?.id);
  const modelNames = useMemo(
    () => Object.fromEntries((options.data?.connections ?? []).map((c) => [c.connection_id, c.name])),
    [options.data],
  );
  const canPublish =
    Boolean(presets.data?.can_publish_official) &&
    (official ? official.can_publish !== false : true) &&
    canEdit;
  const writable = canPublish && env.is_active !== false;
  const current = official?.current_version ?? null;
  const edit = (query: Record<string, string | undefined> = {}) =>
    navigate(defaultPresetEditPath(slug, env.id, query));

  if (presets.isError) {
    return (
      <Section id="env-presets" title="Presets">
        <ErrorState
          error={presets.error}
          title="Failed to load presets"
          onRetry={() => void presets.refetch()}
          compact
        />
      </Section>
    );
  }
  if (presets.isPending) {
    return (
      <Section id="env-presets" title="Presets">
        <Skeleton kind="lines" rows={4} label="Loading presets" />
      </Section>
    );
  }

  const savedColumns: Column<Preset>[] = [
    {
      id: 'name',
      label: 'Name',
      flex: true,
      minWidth: 160,
      cell: (p) => (
        <span>
          {p.name} {p.current_version ? <Tag kind="version">v{p.current_version.version}</Tag> : null}
        </span>
      ),
    },
    { id: 'author', label: 'Author', width: 140, cell: (p) => p.created_by?.name || 'Unknown' },
    {
      id: 'updated',
      label: 'Updated',
      width: 110,
      mono: true,
      cell: (p) => <span title={absTime(p.updated_at)}>{relTime(p.updated_at) || '—'}</span>,
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 330,
      resizable: false,
      cell: (p) => (
        <span className={styles.sectionActions}>
          {env.is_active !== false && p.current_version ? (
            <Button
              variant="neutral"
              aria-label={`Open ${p.name} in the launch form`}
              onPress={() => navigate(launchPath(slug, { env: env.id, base: 'saved', preset: p.id }))}
            >
              Open in launch form
            </Button>
          ) : null}
          {writable && p.current_version ? (
            <Button
              variant="neutral"
              aria-label={`Promote ${p.name} to default preset; nothing is published until you publish`}
              onPress={() => edit({ promote: 'saved', id: p.id })}
            >
              Promote to default preset
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const officialBody: ReactNode = (
    <>
      {!presets.data.can_publish_official ? (
        <p className={styles.muted}>
          Only project managers publish the default preset. You can view every version.
        </p>
      ) : env.is_active === false ? (
        <p className={styles.muted}>Re-enable this environment to publish.</p>
      ) : null}
      {!current ? (
        <div className={styles.empty}>
          No default preset yet. Launches on this environment start from Blank.
        </div>
      ) : (
        <>
          <dl className={styles.kv}>
            <dt>Current</dt>
            <dd>
              <Tag kind="version">v{current.version}</Tag>
            </dd>
            <dt>Published</dt>
            <dd>
              {current.published_by?.name || 'Unknown'} ·{' '}
              <span className={styles.mono} title={absTime(current.published_at)}>
                {relTime(current.published_at) || '—'}
              </span>
            </dd>
            <dt>Release notes</dt>
            <dd>{current.notes || '—'}</dd>
          </dl>
          <Warnings warnings={current.warnings} />
          <div className={styles.history}>
            <div className={styles.subtitle}>
              Version history <Tag kind="count">{versions.data?.versions.length ?? 0}</Tag>
            </div>
            {versions.isError ? (
              <ErrorState
                error={versions.error}
                title="Failed to load the version history"
                onRetry={() => void versions.refetch()}
                compact
              />
            ) : (
              (versions.data?.versions ?? []).map((v) => (
                <VersionItem
                  key={v.id}
                  version={v}
                  isCurrent={v.id === official?.current_version_id}
                  modelNames={modelNames}
                  writable={writable}
                  onEditFrom={(n) => edit({ from: `v${n}` })}
                />
              ))
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <Section
        id="env-default-preset"
        title="Default preset"
        description="The default base of every launch on this environment. Each publish adds a version; earlier versions never change."
        actions={
          writable ? (
            <Button variant="accent" onPress={() => edit()}>
              {current ? 'Edit and publish' : 'Publish v1'}
            </Button>
          ) : null
        }
      >
        {officialBody}
      </Section>
      <Section
        id="env-saved-presets"
        title="Saved presets"
        description="Named starting points saved on this environment. Open one in the launch form to start from it."
      >
        {saved.length ? (
          <DataTable
            aria-label="Saved presets"
            columns={savedColumns}
            rows={saved}
            rowKey={(p) => p.id}
            minWidth={640}
            stickyHeader={false}
          />
        ) : (
          <div className={styles.empty}>No saved presets yet.</div>
        )}
      </Section>
    </>
  );
}
