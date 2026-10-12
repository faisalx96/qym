import { Link } from 'react-router-dom';
import { useLatestExperiment } from '@/api/launch';
import { Select, Tag } from '@/ui';
import { launchPath } from '../../paths';
import { useLaunch, type BaseChoice } from '../LaunchContext';
import { BestRunPicker } from '../sections/BestRunPicker';
import { BaseStatus } from './BaseStatus';
import styles from './entry.module.css';

interface Card {
  kind: BaseChoice;
  title: string;
  hint: string;
  recommended?: boolean;
}

/** The "Start from" cards, the preset selects and the base status line. */
export function StartFrom() {
  const { doc, baseState, chooseBase, selectedEnvs, projectId, slug, readOnly } = useLaunch();
  const baseRecord = selectedEnvs.find((e) => e.id === baseState.envId);
  const hasEnv = selectedEnvs.length > 0;
  const latest = useLatestExperiment(projectId, !doc.clone && hasEnv);
  const version = baseRecord?.official_preset_version;
  const cards: Card[] = [
    {
      kind: 'default',
      title: version != null ? `Default preset v${version}` : 'Default preset',
      hint: 'The environment’s published configuration',
      recommended: true,
    },
    { kind: 'best_run', title: 'Best run', hint: 'The top-scoring past run' },
    {
      kind: 'saved',
      title: 'Saved preset',
      hint: baseState.savedPresets.length
        ? `${baseState.savedPresets.length} saved`
        : 'A configuration saved earlier',
    },
  ];
  if (doc.clone) {
    cards.push({
      kind: 'clone',
      title: 'Copy of experiment',
      hint: doc.clone.sourceName ? `“${doc.clone.sourceName}”` : 'Its configuration, ready to change',
    });
  }
  cards.push({ kind: 'scratch', title: 'From scratch', hint: 'Only the environment defaults' });
  const kind = doc.base.kind;
  const showEnvSelect =
    selectedEnvs.length > 1 && (kind === 'default' || kind === 'saved' || kind === 'best_run');
  return (
    <div className={styles.stack}>
      <div className={styles.legend} id="launch-start-label">
        Start from
      </div>
      <div className={styles.cards}>
        <div role="radiogroup" aria-labelledby="launch-start-label" className={styles.group}>
          {cards.map((card) => {
            const availability = card.kind === 'clone' ? { ok: true } : baseState.available(card.kind);
            const disabled = readOnly || !availability.ok;
            return (
              <button
                key={card.kind}
                type="button"
                role="radio"
                aria-checked={kind === card.kind}
                aria-disabled={disabled || undefined}
                title={!availability.ok ? availability.reason : undefined}
                className={styles.card}
                onClick={() => {
                  if (!disabled) void chooseBase(card.kind);
                }}
              >
                <span className={styles.cardTitle}>
                  {card.title}
                  {card.recommended && availability.ok ? <Tag tone="success">Recommended</Tag> : null}
                </span>
                <span className={styles.cardHint}>{availability.ok ? card.hint : availability.reason}</span>
              </button>
            );
          })}
        </div>
        {!doc.clone && latest.data ? (
          <Link className={styles.card} to={launchPath(slug, { clone: latest.data.id })}>
            <span className={styles.cardTitle}>Copy an experiment</span>
            <span className={styles.cardHint}>The most recent: “{latest.data.name}”</span>
          </Link>
        ) : null}
      </div>
      {showEnvSelect ? (
        <Select
          label={kind === 'best_run' ? 'Runs of environment' : 'Presets of environment'}
          items={selectedEnvs.map((e) => ({ key: e.id, label: e.name }))}
          value={baseState.envId}
          onChange={(key) => key != null && void chooseBase(kind as BaseChoice, { envId: String(key) })}
        />
      ) : null}
      {kind === 'saved' && baseState.savedPresets.length ? (
        <Select
          label="Saved preset"
          items={baseState.savedPresets.map((p) => ({
            key: p.id,
            label: `${p.name} · v${p.current_version?.version ?? 1}`,
          }))}
          value={doc.base.presetId ?? baseState.savedPresets[0]?.id ?? null}
          onChange={(key) => key != null && void chooseBase('saved', { presetId: String(key) })}
        />
      ) : null}
      {kind === 'best_run' ? <BestRunPicker /> : null}
      <BaseStatus />
    </div>
  );
}
