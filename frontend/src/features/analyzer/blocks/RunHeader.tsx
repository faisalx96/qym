import { viewRunTo } from './JobStatus';
import type { RunPasses, RunSummary } from '@/api/analysis';
import { useModelIndex } from '@/api/dashboard';
import { modelSeriesOf } from '@/features/runs-list/model';
import { DatasetTag, isBareRunId, LinkButton, ModelTag, Select, Tag, TaskTag, Text } from '@/ui';
import s from './blocks.module.css';

/** Run name, task / model / dataset, pass select for repeat runs, View run. */
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
  const modelIndex = useModelIndex(slug);
  return (
    <div className={s.runHeader}>
      <div className={s.runTitle}>
        <Text variant="xl" as="h2" dir="auto" mono={isBareRunId(run.run_name || run.run_id, run.run_id)}>
          {run.run_name || run.run_id}
        </Text>
        <div className={s.runMeta}>
          <TaskTag name={run.task_name} />
          {run.model_name ? (
            <ModelTag name={run.model_name} series={modelSeriesOf(modelIndex, run.model_name, false)} />
          ) : null}
          <DatasetTag name={run.dataset_name} />
          <Tag kind="data">{runId}</Tag>
        </div>
      </div>
      <div className={s.runActions}>
        {passes.length > 1 && pass != null ? (
          <Select
            label="Pass"
            items={passes.map((p) => ({
              key: String(p.pass_number),
              label: `Pass ${p.pass_number} (${p.items_scored}/${p.items_total})`,
            }))}
            value={String(pass)}
            onChange={(k) => k != null && onPass(Number(k))}
            isDisabled={busy}
            width={190}
            help={busy ? 'Wait for the running job, or cancel it, to switch passes.' : undefined}
            searchable={false}
          />
        ) : null}
        <LinkButton to={viewRunTo(slug, runId, pass)}>View run</LinkButton>
      </div>
    </div>
  );
}
