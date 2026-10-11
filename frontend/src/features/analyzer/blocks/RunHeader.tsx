import { runPath } from '@/app/routes';
import type { RunPasses, RunSummary } from '@/api/analysis';
import { LinkButton, Select, Tag, Text } from '@/ui';
import s from './blocks.module.css';

/** Run name, task / model / dataset, sample select for repeat runs, View run. */
export function RunHeader({
  slug,
  runId,
  run,
  passes,
  pass,
  onPass,
  busy,
}: {
  slug: string;
  runId: string;
  run: RunSummary['run'];
  passes: RunPasses['passes'];
  pass: number | null;
  onPass: (pass: number) => void;
  busy: boolean;
}) {
  return (
    <div className={s.runHeader}>
      <div className={s.runTitle}>
        <Text variant="lg" weight={600} as="h2" dir="auto">
          {run.run_name || run.run_id}
        </Text>
        <div className={s.runMeta}>
          {run.task_name ? (
            <Text variant="sm" tone="muted" as="span">
              Task <Text variant="sm" mono tone="secondary" as="span">{run.task_name}</Text>
            </Text>
          ) : null}
          {run.model_name ? (
            <Text variant="sm" tone="muted" as="span">
              Model <Text variant="sm" mono tone="secondary" as="span">{run.model_name}</Text>
            </Text>
          ) : null}
          {run.dataset_name ? (
            <Text variant="sm" tone="muted" as="span">
              Dataset <Text variant="sm" mono tone="secondary" as="span">{run.dataset_name}</Text>
            </Text>
          ) : null}
          <Tag kind="data">{runId}</Tag>
        </div>
      </div>
      <div className={s.runActions}>
        {passes.length > 1 && pass != null ? (
          <Select
            label="Sample"
            items={passes.map((p) => ({
              key: String(p.pass_number),
              label: `Sample ${p.pass_number} (${p.items_scored}/${p.items_total})`,
            }))}
            value={String(pass)}
            onChange={(k) => k != null && onPass(Number(k))}
            isDisabled={busy}
            width={190}
            help={busy ? 'Wait for the running job, or cancel it, to switch samples.' : undefined}
            searchable={false}
          />
        ) : null}
        <LinkButton to={runPath(slug, runId)}>View run</LinkButton>
      </div>
    </div>
  );
}
