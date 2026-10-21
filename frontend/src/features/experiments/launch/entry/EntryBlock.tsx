import { Card } from '@/ui';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetPicker } from './DatasetPicker';
import { EnvironmentPicker } from './EnvironmentPicker';
import { RunSettings } from './RunSettings';
import { VersionsBlock } from './VersionsBlock';
import styles from './entry.module.css';

/** Step 1, "Where it runs": name, priority and latency, the environments and the dataset, then the Evaluation Service versions. */
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
            <DatasetPicker />
          </div>
        </Card>
      </div>
      <VersionsBlock />
    </div>
  );
}
