/**
 * Correct distribution: how many of the K runs got each item right. Status tones are reserved for
 * state: none right = error, some = warning, all = success; every segment carries its run count and
 * item count as text, and a legend names the tones, so colour is never the only cue.
 */
import { distributionSegments } from './modelsLogic';
import styles from './Models.module.css';

export function DistributionBar({ dist, k, totalItems }: { dist: number[]; k: number; totalItems: number }) {
  const segments = distributionSegments(dist, k, totalItems);
  if (!segments.length) return null;
  const summary = segments.map((s) => `${s.runs} of ${k} runs correct: ${s.count} items`).join('; ');
  return (
    <div className={styles.dist}>
      <div className={styles.distBar} role="img" aria-label={`Correct distribution. ${summary}`}>
        {segments.map((s) => (
          <div
            key={s.runs}
            className={styles.distSeg}
            data-tone={s.tone}
            style={{ flexGrow: s.count }}
            title={`${s.runs}/${k} runs correct: ${s.count} items (${(s.share * 100).toFixed(1)}%)`}
          >
            <span className={styles.distRuns}>{s.runs}</span>
            <span className={styles.distCount}>{s.count}</span>
          </div>
        ))}
      </div>
      <div className={styles.distLegend} aria-hidden="true">
        <span data-tone="none">0 runs</span>
        {k > 1 ? <span data-tone="some">1–{k - 1} runs</span> : null}
        <span data-tone="all">{k} runs</span>
      </div>
    </div>
  );
}
