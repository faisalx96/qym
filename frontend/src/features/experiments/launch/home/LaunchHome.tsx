import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetPicker } from '../entry/DatasetPicker';
import { EnvironmentPicker } from '../entry/EnvironmentPicker';
import { HomeBar } from '../entry/HomeBar';
import { StartFrom } from '../entry/StartFrom';
import { useLaunch } from '../LaunchContext';
import type { WizardStepId } from '../wizard/steps';
import styles from '../entry/entry.module.css';

/**
 * The short path: where it runs, what to start from, a name. Everything else is one click away in
 * Customize (`LaunchWizard`).
 */
export function LaunchHome({ onCustomize }: { onCustomize: (step: WizardStepId) => void }) {
  const { readOnly, envRecords } = useLaunch();
  return (
    <div className={styles.home} data-testid="launch-home">
      {readOnly ? (
        <Callout tone="warning">This project is archived, so nothing can be launched.</Callout>
      ) : null}
      <div className={styles.where}>
        <div className={panel.panel}>
          <EnvironmentPicker />
        </div>
        <div className={panel.panel}>
          <DatasetPicker />
        </div>
      </div>
      {envRecords.length ? (
        <div className={panel.panel}>
          <StartFrom />
        </div>
      ) : null}
      <HomeBar onCustomize={onCustomize} />
    </div>
  );
}
