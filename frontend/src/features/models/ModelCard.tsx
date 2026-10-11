import { useNavigate } from 'react-router-dom';
import type { ModelStats } from '@/api/dashboardModels';
import { ROUTES } from '@/app/routes';
import { metricBand, type MetricDirection } from '@/lib/metrics';
import { Button, HelpMarker, Tag } from '@/ui';
import { DistributionBar } from './DistributionBar';
import { formatStat, parseModelKey, statTiles, type MetricKind } from './modelsLogic';
import styles from './Models.module.css';

export interface ModelCardProps {
  modelKey: string;
  colorIndex: number;
  stats: ModelStats & { totalRetries?: number };
  selectedCount: number;
  availableCount: number;
  k: number;
  kind: MetricKind;
  direction: MetricDirection;
  isBoolean: boolean;
  thresholdPct: number;
  shown: Set<string>;
  runIds: string[];
  onEdit: () => void;
}

const BAND_KEYS = ['passAtK', 'passHatK', 'maxAtK', 'consistency', 'reliability', 'avgScore'];
const COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

export function ModelCard(p: ModelCardProps) {
  const navigate = useNavigate();
  const { label, reasoning } = parseModelKey(p.modelKey);
  const tiles = statTiles(p.kind, p.stats.K || p.k, p.direction, p.thresholdPct, p.isBoolean).filter((t) =>
    p.shown.has(t.key),
  );
  const fewer = p.selectedCount < p.k;
  const showDist = p.kind === 'score' && p.shown.has('correctDistribution');
  const canCompare = p.runIds.length >= 2;
  function compare() {
    try {
      sessionStorage.setItem('compareRuns', JSON.stringify(p.runIds));
    } catch {
      // storage unavailable: the URL carries the runs
    }
    navigate(`${ROUTES.compare}?${p.runIds.map((id) => `runs=${encodeURIComponent(id)}`).join('&')}`);
  }
  return (
    <article className={styles.card} data-model={p.modelKey}>
      <header className={styles.cardHead}>
        <h3 className={styles.cardTitle} title={label}>
          <span
            className={styles.dot}
            style={{ background: `var(${COLORS[p.colorIndex % COLORS.length]})` }}
            aria-hidden="true"
          />
          <span className={styles.cardName}>{label}</span>
          {reasoning ? <Tag title="Reasoning model">reasoning</Tag> : null}
        </h3>
        <div className={styles.cardRuns}>
          <span className={styles.runsCount} data-warn={fewer ? '' : undefined}>
            {p.selectedCount}/{p.k} runs
          </span>
          {fewer ? (
            <span
              className={styles.warnGlyph}
              role="img"
              aria-label={`Only ${p.availableCount} runs available (requested ${p.k})`}
              title={`Only ${p.availableCount} runs available (requested ${p.k})`}
            >
              ⚠
            </span>
          ) : null}
          <Button variant="neutral" onPress={p.onEdit} aria-label={`Edit run selection of ${label}`}>
            Edit
          </Button>
        </div>
      </header>
      {tiles.length ? (
        <dl className={styles.tiles}>
          {tiles.map((t) => {
            const raw = (p.stats as unknown as Record<string, number | null | undefined>)[t.key];
            const band =
              p.kind === 'score' && typeof raw === 'number' && BAND_KEYS.includes(t.key)
                ? metricBand(
                    raw,
                    'score',
                    t.key === 'maxAtK' || t.key === 'avgScore' ? p.direction : 'maximize',
                  )
                : null;
            return (
              <div key={t.key} className={styles.tile}>
                <dt className={styles.tileLabel}>
                  {t.label}
                  <HelpMarker label={t.label}>{t.tip}</HelpMarker>
                </dt>
                <dd
                  className={styles.tileValue}
                  data-band={band ?? undefined}
                  data-alert={(t.key === 'failedCount' || t.key === 'totalRetries') && raw ? '' : undefined}
                >
                  {formatStat(t.key, p.stats, p.kind)}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className={styles.muted}>No summary metrics selected.</p>
      )}
      {showDist ? (
        <div>
          <div className={styles.tileLabel}>
            Correct distribution
            <HelpMarker label="Correct distribution">
              How many of the {p.stats.K} runs got each item right. 0 means no run solved it.
            </HelpMarker>
          </div>
          <DistributionBar
            dist={p.stats.correctDistribution ?? []}
            k={p.stats.K}
            totalItems={p.stats.totalItems}
          />
        </div>
      ) : null}
      <footer className={styles.cardFoot}>
        <span className={styles.muted}>{p.stats.totalItems} items</span>
        <Button
          variant="ghost"
          isDisabled={!canCompare}
          onPress={compare}
          aria-label={`See item-by-item comparison of ${label}${canCompare ? '' : ' (needs at least 2 runs)'}`}
        >
          See item-by-item comparison →
        </Button>
      </footer>
    </article>
  );
}
