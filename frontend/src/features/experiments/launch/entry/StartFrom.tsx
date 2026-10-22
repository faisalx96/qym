import { useLatestExperiment } from '@/api/launch';
import { Select } from '@/ui';
import { launchPath } from '../../paths';
import { datasetEntries } from '../model';
import { useLaunch, type BaseChoice } from '../LaunchContext';
import { BestRunPicker } from '../sections/BestRunPicker';
import { BaseStatus } from './BaseStatus';
import { StartCard } from './StartCard';
import styles from './entry.module.css';

/** The "Start from" cards (three big, then saved presets and scratch), the preset selects and the base status. */
export function StartFrom() {
  const { doc, baseState, chooseBase, selectedEnvs, projectId, slug, readOnly } = useLaunch();
  const baseRecord = selectedEnvs.find((e) => e.id === baseState.envId);
  const hasEnv = selectedEnvs.length > 0;
  const latest = useLatestExperiment(projectId, !doc.clone && hasEnv);
  const version = baseRecord?.official_preset_version;
  const kind = doc.base.kind;
  const defaultAvail = baseState.available('default');
  const bestAvail = baseState.available('best_run');
  const showEnvSelect =
    selectedEnvs.length > 1 && (kind === 'default' || kind === 'saved' || kind === 'best_run');
  const envNames = (ids: string[]) =>
    ids.map((id) => selectedEnvs.find((e) => e.id === id)?.name).filter(Boolean);
  const pick = (k: BaseChoice) => void chooseBase(k);
  const savedChecked = (id: string) =>
    kind === 'saved' && (doc.base.presetId ?? baseState.savedPresets[0]?.id) === id;
  return (
    <div className={styles.stack}>
      <div className={styles.legend} id="launch-start-label">
        Start from
      </div>
      <div role="radiogroup" aria-labelledby="launch-start-label" className={styles.startStack}>
        <div className={styles.startGrid}>
          <StartCard
            eyebrow={defaultAvail.ok ? 'Recommended' : undefined}
            title={version != null ? `Default preset v${version}` : 'Default preset'}
            body={
              defaultAvail.ok
                ? 'What this environment’s managers published.'
                : (defaultAvail.reason ?? 'Not available.')
            }
            meta={kind === 'default' ? doc.base.releaseNotes || undefined : undefined}
            checked={kind === 'default'}
            disabled={readOnly || !defaultAvail.ok}
            titleAttr={!defaultAvail.ok ? defaultAvail.reason : undefined}
            onSelect={() => pick('default')}
          />
          <StartCard
            eyebrow="Best past run"
            title="Top-scoring run"
            body={
              bestAvail.ok
                ? `The configuration of a top-scoring official run${bestRunDatasets(doc)}.`
                : (bestAvail.reason ?? 'Not available.')
            }
            meta={bestAvail.ok ? 'Choose what “best” means after picking it.' : undefined}
            checked={kind === 'best_run'}
            disabled={readOnly || !bestAvail.ok}
            titleAttr={!bestAvail.ok ? bestAvail.reason : undefined}
            onSelect={() => pick('best_run')}
          />
          {doc.clone ? (
            <StartCard
              eyebrow="Copy an experiment"
              title={doc.clone.sourceName ? `“${doc.clone.sourceName}”` : 'Copy of experiment'}
              body="Its configuration, ready to change."
              checked={kind === 'clone'}
              onSelect={() => pick('clone')}
            />
          ) : latest.data ? (
            <StartCard
              eyebrow="Copy an experiment"
              title={latest.data.name}
              body="Your most recent experiment."
              meta={envNames(latest.data.environment_ids).join(', ') || undefined}
              to={launchPath(slug, { clone: latest.data.id })}
            />
          ) : null}
        </div>
        {baseState.savedPresets.length ? (
          <>
            <div className={styles.startSub}>Saved presets</div>
            <div className={styles.startGridCompact}>
              {baseState.savedPresets.map((p) => (
                <StartCard
                  key={p.id}
                  compact
                  title={p.name}
                  body={`v${p.current_version?.version ?? 1}${p.created_by?.name ? ` · by ${p.created_by.name}` : ''}`}
                  checked={savedChecked(p.id)}
                  disabled={readOnly}
                  onSelect={() => void chooseBase('saved', { presetId: p.id })}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className={styles.startSub}>Other</div>
        <div className={styles.startGridCompact}>
          <StartCard
            compact
            title="From scratch"
            body="The environment’s own settings."
            checked={hasEnv && kind === 'scratch'}
            disabled={readOnly || !hasEnv}
            onSelect={() => pick('scratch')}
          />
        </div>
      </div>
      {showEnvSelect ? (
        <Select
          label={kind === 'best_run' ? 'Runs of environment' : 'Presets of environment'}
          items={selectedEnvs.map((e) => ({ key: e.id, label: e.name }))}
          value={baseState.envId}
          onChange={(key) => key != null && void chooseBase(kind as BaseChoice, { envId: String(key) })}
        />
      ) : null}
      {kind === 'best_run' ? <BestRunPicker /> : null}
      <BaseStatus />
    </div>
  );
}

/** " on support-tickets" / " on support-tickets and 1 more dataset": the first dataset names the scope (QD-D9). */
function bestRunDatasets(doc: Parameters<typeof datasetEntries>[0]): string {
  const entries = datasetEntries(doc);
  const first = entries[0]?.name;
  if (!first) return '';
  const more = entries.length - 1;
  return ` on ${first}${more > 0 ? ` and ${more} more dataset${more === 1 ? '' : 's'}` : ''}`;
}
