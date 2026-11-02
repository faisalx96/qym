import { Button, Chip, Text } from '@/ui';
import s from './blocks.module.css';

export function MetricChips({
  metrics,
  selected,
  onChange,
}: {
  metrics: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className={s.metricBlock}>
      <div className={s.metricRow} role="group" aria-label="Metrics to analyze">
        {metrics.map((name) => (
          <Chip
            key={name}
            isSelected={selected.includes(name)}
            onChange={(on) => onChange(metrics.filter((m) => (m === name ? on : selected.includes(m))))}
          >
            {name}
          </Chip>
        ))}
        <span className={s.spacer} />
        <Button size="sm" onPress={() => onChange([...metrics])}>
          Select all
        </Button>
        <Button size="sm" onPress={() => onChange([])}>
          Clear
        </Button>
      </div>
      <Text variant="sm" tone="muted" as="p" role="status">
        {selected.length
          ? `${selected.length} of ${metrics.length} metrics selected`
          : 'Select at least one metric to analyze.'}
      </Text>
    </div>
  );
}
