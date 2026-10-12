import { useState } from 'react';
import {
  useCompareVersions,
  useMergeVersions,
  usePublishVersion,
  type AnalysisScope,
  type MergeResolution,
  type MergeResponse,
  type RuleItem,
  type RuleVersion,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';
import { Badge, Button, Dialog, ErrorState, Select, Skeleton, Switch, Text, Textarea, TextField, useToast } from '@/ui';
import s from './rules.module.css';

const versionItems = (versions: RuleVersion[], except?: number) =>
  versions
    .filter((v) => v.version !== except && !v.is_deleted)
    .map((v) => ({ key: String(v.version), label: `v${v.version} · ${v.status}` }));

/* ───────────────────────── publish ───────────────────────── */

export function PublishDialog({
  scope,
  version,
  open,
  onOpenChange,
}: {
  scope: AnalysisScope;
  version: RuleVersion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const publish = usePublishVersion(scope);
  const toast = useToast();
  const [production, setProduction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await publish.mutateAsync({ version: version.version, production });
      toast.show(production ? `v${version.version} published and live` : `v${version.version} published`, {
        tone: 'success',
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail || e.message : 'Publishing failed.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Publish v${version.version}`}
      description="A published version is locked. You can promote it to production now or later."
      size="sm"
      footer={
        <>
          <Button size="md" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="md" variant="primary" loading={publish.isPending} onPress={() => void submit()}>
            Publish
          </Button>
        </>
      }
    >
      <Switch isSelected={production} onChange={setProduction}>
        Set as production
      </Switch>
      {error ? (
        <Text variant="base" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </Dialog>
  );
}

/* ───────────────────────── compare ───────────────────────── */

function RulePair({ before, after }: { before?: RuleItem; after?: RuleItem }) {
  return (
    <div className={s.diffPair}>
      <div>
        <Text variant="sm" tone="muted">
          Base
        </Text>
        <p dir="auto">{before ? `${before.title}\n${before.instruction}` : '—'}</p>
      </div>
      <div>
        <Text variant="sm" tone="muted">
          This version
        </Text>
        <p dir="auto">{after ? `${after.title}\n${after.instruction}` : '—'}</p>
      </div>
    </div>
  );
}

export function CompareDialog({
  scope,
  versions,
  target,
  open,
  onOpenChange,
}: {
  scope: AnalysisScope;
  versions: RuleVersion[];
  target: RuleVersion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const items = versionItems(versions, target.version);
  const [base, setBase] = useState<number | null>(null);
  const baseVersion = base ?? (items[0] ? Number(items[0].key) : null);
  const compare = useCompareVersions(scope, open ? target.version : null, baseVersion);
  const data = compare.data;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Compare v${target.version}`}
      description="See what changed between a base version and this one."
      size="data"
      footer={
        <Button size="md" onPress={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <Select
        label="Compare with"
        items={items}
        value={baseVersion != null ? String(baseVersion) : null}
        onChange={(k) => setBase(k == null ? null : Number(k))}
      />
      {compare.isError ? (
        <ErrorState error={compare.error} title="Couldn’t compare versions" onRetry={() => compare.refetch()} compact />
      ) : compare.isFetching && !data ? (
        <Skeleton kind="lines" rows={4} label="Comparing" />
      ) : data ? (
        <>
          <div className={s.sourceRow} data-testid="compare-summary">
            <Badge tone="success">{`${data.summary.added} added`}</Badge>
            <Badge tone="danger">{`${data.summary.removed} removed`}</Badge>
            <Badge tone="warning">{`${data.summary.changed} changed`}</Badge>
            <Badge tone="neutral">{`${data.summary.unchanged} unchanged`}</Badge>
          </div>
          <ul className={s.diffList}>
            {data.changed_rules.map((r) => (
              <li key={`c${r.id}`} className={s.diffItem}>
                <details>
                  <summary>{`Changed: ${r.after.title || r.before.title}`}</summary>
                  <RulePair before={r.before} after={r.after} />
                </details>
              </li>
            ))}
            {data.added_rules.map((r, i) => (
              <li key={`a${r.id ?? i}`} className={s.diffItem}>
                <details>
                  <summary>{`Added: ${r.title}`}</summary>
                  <RulePair after={r} />
                </details>
              </li>
            ))}
            {data.removed_rules.map((r, i) => (
              <li key={`r${r.id ?? i}`} className={s.diffItem}>
                <details>
                  <summary>{`Removed: ${r.title}`}</summary>
                  <RulePair before={r} />
                </details>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}

/* ───────────────────────── merge ───────────────────────── */

type Choice = 'target' | 'source' | 'custom';

export function MergeDialog({
  scope,
  versions,
  target,
  open,
  onOpenChange,
  onMerged,
}: {
  scope: AnalysisScope;
  versions: RuleVersion[];
  target: RuleVersion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (version: RuleVersion | undefined) => void;
}) {
  const merge = useMergeVersions(scope);
  const toast = useToast();
  const items = versionItems(versions, target.version);
  const [source, setSource] = useState<number | null>(null);
  const sourceVersion = source ?? (items[0] ? Number(items[0].key) : null);
  const [preview, setPreview] = useState<MergeResponse['preview'] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [custom, setCustom] = useState<Record<string, { title: string; instruction: string }>>({});
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (sourceVersion == null) return;
    setError(null);
    try {
      const res = await merge.mutateAsync({ target: target.version, source: sourceVersion, apply: false });
      setPreview(res.preview ?? { summary: { changed: 0, added: 0, removed: 0, conflicts: 0 }, conflicts: [] });
      setChoices({});
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError ? e.detail || e.message : 'The merge preview failed.');
    }
  }

  const conflicts = preview?.conflicts ?? [];
  const unresolved = conflicts.some((c) => !choices[c.key] || (choices[c.key] === 'custom' && !custom[c.key]?.title.trim()));

  async function apply() {
    if (sourceVersion == null) return;
    const resolutions: Record<string, MergeResolution> = {};
    for (const c of conflicts) {
      const choice = choices[c.key];
      if (choice === 'custom') resolutions[c.key] = custom[c.key] ?? { title: '', instruction: '' };
      else if (choice) resolutions[c.key] = choice;
    }
    try {
      const res = await merge.mutateAsync({
        target: target.version,
        source: sourceVersion,
        apply: true,
        resolutions,
      });
      toast.show("Versions merged", { tone: "success" });
      onMerged(res.version);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail || e.message : 'The merge failed.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge into v${target.version}`}
      description="Bring another version’s rule changes into this one. Preview first; conflicting rules need a decision."
      size="data"
      footer={
        <>
          <Button size="md" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="md" onPress={() => void runPreview()} loading={merge.isPending && !preview}>
            Preview merge
          </Button>
          <Button size="md" variant="primary" isDisabled={!preview || unresolved} loading={merge.isPending && Boolean(preview)} onPress={() => void apply()}>
            Apply merge
          </Button>
        </>
      }
    >
      <Select
        label="Merge from"
        items={items}
        value={sourceVersion != null ? String(sourceVersion) : null}
        onChange={(k) => {
          setSource(k == null ? null : Number(k));
          setPreview(null);
        }}
      />
      {error ? (
        <Text variant="base" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
      {preview ? (
        <div className={s.main} data-testid="merge-preview">
          <div className={s.sourceRow}>
            <Badge tone="success">{`${preview.summary.added} added`}</Badge>
            <Badge tone="danger">{`${preview.summary.removed} removed`}</Badge>
            <Badge tone="warning">{`${preview.summary.changed} changed`}</Badge>
            <Badge tone={conflicts.length ? 'danger' : 'neutral'}>{`${conflicts.length} conflicts`}</Badge>
          </div>
          {conflicts.map((c) => (
            <fieldset key={c.key} className={s.conflict}>
              <legend>
                <Text variant="md" weight={600}>{`Conflict: ${c.target.title || c.source.title}`}</Text>
              </legend>
              <RulePair before={c.target} after={c.source} />
              <div className={s.sourceRow} role="radiogroup" aria-label={`Resolve ${c.target.title}`}>
                {(
                  [
                    ['target', `Keep v${target.version}`],
                    ['source', `Take v${sourceVersion}`],
                    ['custom', 'Write my own'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`merge-${c.key}`}
                      checked={choices[c.key] === value}
                      onChange={() => setChoices((cur) => ({ ...cur, [c.key]: value }))}
                    />{' '}
                    {label}
                  </label>
                ))}
              </div>
              {choices[c.key] === 'custom' ? (
                <>
                  <TextField
                    label="Title"
                    value={custom[c.key]?.title ?? ''}
                    onChange={(v) => setCustom((cur) => ({ ...cur, [c.key]: { instruction: cur[c.key]?.instruction ?? '', title: v } }))}
                  />
                  <Textarea
                    label="Instruction"
                    rows={3}
                    value={custom[c.key]?.instruction ?? ""}
                    onChange={(v) =>
                      setCustom((cur) => ({
                        ...cur,
                        [c.key]: { title: cur[c.key]?.title ?? "", instruction: v },
                      }))
                    }
                  />
                </>
              ) : null}
            </fieldset>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
