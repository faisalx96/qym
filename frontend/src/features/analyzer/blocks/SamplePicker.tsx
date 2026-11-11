import type { RunPasses } from '@/api/analysis';
import { AnalysisSpark } from '@/features/runs-list/AnalyzeAction';
import { Button, EmptyState, LinkButton, Tag, Text } from '@/ui';
import { viewRunTo } from './JobStatus';
import s from './blocks.module.css';

/**
 * Repeat run without a valid `pass`: choose the pass to analyze (written to the URL). The run page and the
 * analyzer both say "pass" (C176), and "View run" leads back to the run (C212).
 */
export function PassPicker({
  slug,
  runId,
  passes,
  onPick,
}: {
  slug: string;
  runId: string;
  passes: RunPasses['passes'];
  onPick: (pass: number) => void;
}) {
  return (
    <div className={s.stack}>
      <EmptyState
        compact
        title="Choose a pass"
        body="This run was repeated. Auto-analysis diagnoses one pass at a time."
        action={<LinkButton to={viewRunTo(slug, runId, null)}>View run</LinkButton>}
      />
      <ul className={s.targetList} aria-label="Passes">
        {passes.map((p) => (
          <li key={p.pass_number} className={s.targetRow}>
            <div className={s.targetBody}>
              <div className={s.targetHead}>
                <Text variant="md" weight={600} as="span">{`Pass ${p.pass_number}`}</Text>
                <Tag kind="data">{p.status}</Tag>
                <Text
                  variant="sm"
                  tone="muted"
                  as="span"
                >{`${p.items_scored}/${p.items_total} items scored`}</Text>
              </div>
            </div>
            <Button
              size="sm"
              variant="meta"
              icon={<AnalysisSpark filled={false} />}
              onPress={() => onPick(p.pass_number)}
            >
              {`Analyze pass ${p.pass_number}`}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
