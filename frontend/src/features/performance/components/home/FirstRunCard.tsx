/** Performance home: a project with a runner and no run yet. The header's "New run" is the one action. */
import { Card, SectionHeader } from '@/ui';
import styles from './home.module.css';

export function FirstRunCard() {
  return (
    <Card as="section" aria-label="First run" data-performance-block="first-run">
      {/* Inside a card the section header is just the header; `wrap`: the description is read in full. */}
      <SectionHeader
        wrap
        title="No runs yet"
        description="Three steps to the first result. When the Smoke test passes, run a Breakpoint test: it finds how many users the system takes before it gets too slow or starts failing."
      />
      <div className={styles.stack}>
        <ol className={styles.steps}>
          <li>
            <span className={styles.strong}>1. Set up sign-in</span>
            <span>Choose a target and paste the sign-in tokens copied from your browser.</span>
          </li>
          <li>
            <span className={styles.strong}>2. Pick questions</span>
            <span>Choose a published dataset. A short set of questions is enough for a quick check.</span>
          </li>
          <li>
            <span className={styles.strong}>3. Start the 3-minute Smoke test</span>
            <span>One user for 3 minutes. It checks sign-in and that real answers come back.</span>
          </li>
        </ol>
        <div className={`${styles.tight} ${styles.rule}`}>
          <span className={styles.label}>What will appear here</span>
          <span>
            The run in progress: the level being measured, the answer time against the limit, and Stop.
          </span>
          <span>
            The capacity of each target: safe load, where it breaks, the recommended maximum, a chart over
            time.
          </span>
          <span>Every run: its result and numbers, with a link to the full report.</span>
        </div>
      </div>
    </Card>
  );
}
