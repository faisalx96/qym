import { Button, Select } from '@/ui';
import type { BestRunScopePayload } from '@/api/launch';
import { keyWords, runCount } from './lib';
import styles from './bestrun.module.css';

const ANY = '__any__';

export interface ScopeDraft {
  datasetId: string;
  versionId: string;
  versioning: Record<string, string>;
}

export const EMPTY_DRAFT: ScopeDraft = { datasetId: '', versionId: '', versioning: {} };

export function sameDraft(a: ScopeDraft | null, b: ScopeDraft): boolean {
  if (!a) return false;
  return (
    a.datasetId === b.datasetId &&
    (a.datasetId ? a.versionId === b.versionId : true) &&
    JSON.stringify(Object.entries(a.versioning).sort()) ===
      JSON.stringify(Object.entries(b.versioning).sort())
  );
}

/**
 * Dataset, version and versioning, asked before anything is retrieved (B15). Anything left on
 * "Any" is not filtered, so leaving everything on Any ranks every run of the environment.
 */
export function ScopePrompt({
  options,
  draft,
  onDraft,
  applied,
  onFind,
}: {
  options: BestRunScopePayload;
  draft: ScopeDraft;
  onDraft: (next: ScopeDraft) => void;
  /** The scope the table shows (null before the first Find). */
  applied: ScopeDraft | null;
  onFind: () => void;
}) {
  const datasets = options.datasets ?? [];
  const dataset = datasets.find((d) => d.id === draft.datasetId) ?? null;
  const versioning = options.versioning ?? {};
  const empty = !options.total_runs;
  return (
    <div data-best-run-scope>
      <div className={styles.row}>
        <Select
          className={styles.select}
          label="Dataset"
          items={[
            { key: ANY, label: 'Any dataset' },
            ...datasets.map((d) => ({ key: d.id, label: `${d.name} · ${runCount(d.run_count)}` })),
          ]}
          value={draft.datasetId || ANY}
          onChange={(k) =>
            onDraft({ ...draft, datasetId: k === ANY || k == null ? '' : String(k), versionId: '' })
          }
        />
        <Select
          className={styles.select}
          label="Dataset version"
          isDisabled={!dataset}
          items={[
            { key: ANY, label: 'Any version' },
            ...(dataset?.versions ?? []).map((v) => ({
              key: v.id,
              label: `${v.version} · ${runCount(v.run_count)}`,
            })),
          ]}
          value={dataset && draft.versionId ? draft.versionId : ANY}
          onChange={(k) => onDraft({ ...draft, versionId: k === ANY || k == null ? '' : String(k) })}
        />
        {Object.keys(versioning)
          .sort()
          .map((key) => {
            const words = keyWords(key);
            const label = words.charAt(0).toUpperCase() + words.slice(1);
            return (
              <Select
                key={key}
                className={styles.select}
                label={label}
                items={[
                  { key: ANY, label: `Any ${words}` },
                  ...(versioning[key] ?? []).map((v) => ({
                    key: v.value,
                    label: `${v.value} · ${runCount(v.run_count)}`,
                  })),
                ]}
                value={draft.versioning[key] ?? ANY}
                onChange={(k) => {
                  const next = { ...draft.versioning };
                  if (k == null || k === ANY) delete next[key];
                  else next[key] = String(k);
                  onDraft({ ...draft, versioning: next });
                }}
              />
            );
          })}
        <Button variant="accent" isDisabled={empty || sameDraft(applied, draft)} onPress={onFind}>
          {applied ? 'Update best runs' : 'Find best runs'}
        </Button>
      </div>
      {empty ? (
        <p className={styles.hint}>No official run of this environment has a score yet.</p>
      ) : !applied ? (
        <p className={styles.hint}>
          Choose a dataset, a version and versioning values, then Find best runs. Anything left on Any is not
          filtered, so leaving everything on Any ranks every run of this environment.
        </p>
      ) : null}
    </div>
  );
}
