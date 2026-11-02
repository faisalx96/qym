import { Card } from '@/ui';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetsCard } from './DatasetsCard';
import { EnvironmentPicker } from './EnvironmentPicker';
import { RunSettings } from './RunSettings';
import styles from './entry.module.css';

/** Step 1, "Where it runs": name, priority and latency, the environments (each ticked box with its service versions) and the dataset. */
export function EntryBlock() {
  const { readOnly } = useLaunch();
  return (
    <div className={styles.entry} data-testid="launch-entry">
      {readOnly ? (
        <Callout tone="warning">This project is archived, so nothing can be launched.</Callout>
      ) : null}
      <Card as="section" aria-label="Name and priority">
        <div className={panel.cardStack}>
          <RunSettings />
        </div>
      </Card>
      <div className={styles.where}>
        <Card>
          <div className={panel.cardStack}>
            <EnvironmentPicker />
          </div>
        </Card>
        <Card>
          <div className={panel.cardStack}>
            <DatasetsCard />
          </div>
        </Card>
      </div>
    </div>
  );
}
