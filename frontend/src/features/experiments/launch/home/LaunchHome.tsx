import { Card } from '@/ui';
import { Callout } from '../components/Callout';
import panel from '../components/launch.module.css';
import { DatasetsCard } from '../entry/DatasetsCard';
import { EnvironmentPicker } from '../entry/EnvironmentPicker';
import { HomeBar } from '../entry/HomeBar';
import { LatencyControl } from '../entry/LatencyControl';
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
        <Card>
          <div className={panel.cardStack}>
            <EnvironmentPicker />
            {envRecords.length ? (
              <div className={styles.latencyBlock} data-testid="home-latency">
                <LatencyControl />
              </div>
            ) : null}
          </div>
        </Card>
        <Card>
          <div className={panel.cardStack}>
            <DatasetsCard />
          </div>
        </Card>
      </div>
      {envRecords.length ? (
        <Card>
          <div className={panel.cardStack}>
            <StartFrom />
          </div>
        </Card>
      ) : null}
      <HomeBar onCustomize={onCustomize} />
    </div>
  );
}
