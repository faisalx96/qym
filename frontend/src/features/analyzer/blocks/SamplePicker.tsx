import type { RunPasses } from '@/api/analysis';
import { Button, EmptyState, Tag, Text } from '@/ui';
import s from './blocks.module.css';

/** Repeat run without a valid `pass`: choose the sample to analyze (written to the URL). */
export function SamplePicker({
  passes,
  onPick,
}: {
  passes: RunPasses['passes'];
  onPick: (pass: number) => void;
}) {
  return (
    <div className={s.stack}>
      <EmptyState
        compact
        title="Choose a sample"
        body="This run was repeated. Auto-analysis diagnoses one sample at a time."
      />
      <ul className={s.targetList} aria-label="Samples">
        {passes.map((p) => (
          <li key={p.pass_number} className={s.targetRow}>
            <div className={s.targetBody}>
              <div className={s.targetHead}>
                <Text variant="md" weight={600} as="span">{`Sample ${p.pass_number}`}</Text>
                <Tag kind="data">{p.status}</Tag>
                <Text
                  variant="sm"
                  tone="muted"
                  as="span"
                >{`${p.items_scored}/${p.items_total} items scored`}</Text>
              </div>
            </div>
            <Button size="sm" variant="accent" onPress={() => onPick(p.pass_number)}>
              {`Analyze sample ${p.pass_number}`}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
