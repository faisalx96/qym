import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetPicker } from './DatasetPicker';
import { EnvironmentPicker } from './EnvironmentPicker';
import { RunSettings } from './RunSettings';
import { StartFrom } from './StartFrom';
import styles from './entry.module.css';

/** Where it runs, what it runs on, what it starts from, and how it is named. */
export function EntryBlock() {
  const { readOnly, envRecords } = useLaunch();
  return (
    <div className={`${panel.panel} ${styles.entry}`} data-testid="launch-entry">
      {readOnly ? (
        <Callout tone="warning">This project is archived, so nothing can be launched.</Callout>
      ) : null}
      <div className={styles.two}>
        <EnvironmentPicker />
        <DatasetPicker />
      </div>
      {envRecords.length ? <StartFrom /> : null}
      <RunSettings />
    </div>
  );
}
