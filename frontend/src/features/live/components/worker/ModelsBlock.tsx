import type { LiveWorkerRead } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { EmptyState, Tag, Text } from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import styles from '../../worker.module.css';

export function ModelsBlock({ read }: { read: LiveWorkerRead }) {
  return (
    <WorkerBlock name="models" title="Available models">
      {read.running?.models?.listed_at ? (
        <Text tone="muted" title={read.running.models.listed_at}>
          listed {formatRelative(read.running.models.listed_at)}
        </Text>
      ) : null}
      {read.model_ids.length ? (
        <div className={styles.inline}>
          {read.model_ids.map((id) => (
            <Tag key={id} kind="data" dir="auto">
              {id}
            </Tag>
          ))}
        </div>
      ) : (
        <EmptyState title="The gateway did not list models; type a model id in the settings" />
      )}
    </WorkerBlock>
  );
}
