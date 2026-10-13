import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetPicker } from './DatasetPicker';
import { EnvironmentPicker } from './EnvironmentPicker';
import { RunSettings } from './RunSettings';
import styles from './entry.module.css';

/** Step 1, "Where it runs": name and priority, the environments and the dataset. */
export function EntryBlock() {
  const { readOnly } = useLaunch();
  return (
    <div className={styles.entry} data-testid="launch-entry">
      {readOnly ? (
        <Callout tone="warning">This project is archived, so nothing can be launched.</Callout>
      ) : null}
      <section className={panel.panel} aria-label="Name and priority">
        <RunSettings />
      </section>
      <div className={styles.where}>
        <div className={panel.panel}>
          <EnvironmentPicker />
        </div>
        <div className={panel.panel}>
          <DatasetPicker />
        </div>
      </div>
    </div>
  );
}
