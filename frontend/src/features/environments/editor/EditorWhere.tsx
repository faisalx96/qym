/** Step 1 of the editor, "Environment and dataset": compared with, the task, the one fixed environment and the dataset. */
import { Card, Text } from '@/ui';
import { useLaunch } from '@/features/experiments/launch/LaunchContext';
import panel from '@/features/experiments/launch/components/launch.module.css';
import { DatasetPicker } from '@/features/experiments/launch/entry/DatasetPicker';
import entry from '@/features/experiments/launch/entry/entry.module.css';
import { TaskCard } from '@/features/experiments/launch/entry/TaskCard';
import { ComparedWithCard } from './ComparedWithCard';

export function EditorWhere() {
  const { selectedEnvs } = useLaunch();
  const envName = selectedEnvs[0]?.name ?? '—';
  return (
    <div className={entry.entry} data-testid="editor-where">
      <ComparedWithCard />
      <TaskCard />
      <div className={entry.where}>
        <div data-part="env-section" className={entry.whereCell}>
          <Card as="section" aria-label="Environment">
            <div className={panel.cardStack}>
              <div className={entry.legend}>Environment</div>
              <Text variant="base">{envName}</Text>
              <p className={entry.help}>
                A default preset belongs to one environment. Open another environment to edit its preset.
              </p>
            </div>
          </Card>
        </div>
        <div data-part="dataset-section" className={entry.whereCell}>
          <Card as="section" aria-label="Dataset">
            <div className={panel.cardStack}>
              <DatasetPicker />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
