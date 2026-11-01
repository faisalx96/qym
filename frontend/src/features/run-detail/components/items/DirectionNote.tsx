/**
 * Under the Items bar, for a page metric that declares no direction (C129): the 0-1 score is read as higher is
 * better (80% bar) unless the project saved otherwise. Project managers switch it, per project and metric.
 */
import { useSetMetricDirection } from '@/api/projects';
import { readOnlyReason, useProjectContext } from '@/features/shell';
import { Button, useToast } from '@/ui';
import { useRunPage } from '../../RunContext';
import { messageFor } from './ScoreEditor';
import styles from './DirectionNote.module.css';

export function DirectionNote({ metric }: { metric: string | null }) {
  const { model } = useRunPage();
  const project_ = useProjectContext();
  const { project, canManage, readOnly } = project_;
  const toast = useToast();
  const save = useSetMetricDirection(project);
  const source = metric ? model.metricDirectionSource[metric] : null;
  if (!metric || (source !== 'assumed' && source !== 'project')) return null;
  const direction = model.metricDirections[metric];
  const text =
    source === 'assumed'
      ? 'Direction not set, so higher is better is assumed.'
      : `Direction not set by the metric. This project reads ${metric} as ${direction === 'minimize' ? 'lower' : 'higher'} is better.`;
  const pick = (next: 'maximize' | 'minimize') =>
    save.mutate(
      { metric, direction: next },
      { onError: (e) => toast.show(messageFor(e), { tone: 'error' }) },
    );
  const locked = !canManage || readOnly;
  const why = readOnly ? readOnlyReason(project_) : 'Only project managers can set a metric’s direction.';
  return (
    <p className={styles.note} data-testid="direction-note">
      <span>{text}</span>
      <span className={styles.buttons} role="group" aria-label={`Direction of ${metric}`}>
        {(
          [
            ['maximize', 'Higher is better'],
            ['minimize', 'Lower is better'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant="neutral"
            aria-pressed={direction === value}
            isDisabled={locked || save.isPending}
            onPress={() => pick(value)}
          >
            {label}
          </Button>
        ))}
      </span>
      {locked ? <span>{why}</span> : null}
    </p>
  );
}
