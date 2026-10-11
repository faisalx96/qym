import { useEffect, useRef, useState } from 'react';
import { useBestRuns, useBestRunScope, type BestRunsPayload } from '@/api/launch';
import { Button, Checkbox, ErrorState, Select, Skeleton, Tag, Text } from '@/ui';
import { BEST_RUN_REASONS, type BestRunScope } from '../model';
import { useLaunch } from '../LaunchContext';
import { scopeSummary, runCount } from '../bestrun/lib';
import { BestRunNotices } from '../bestrun/Notices';
import { RunsTable } from '../bestrun/RunsTable';
import { EMPTY_DRAFT, ScopePrompt, type ScopeDraft } from '../bestrun/ScopePrompt';
import styles from '../bestrun/bestrun.module.css';

const DEFAULT_METRIC = '__default__';

function toScope(draft: ScopeDraft, metric: string, includeErrored: boolean): BestRunScope {
  return {
    datasetId: draft.datasetId || undefined,
    versionId: draft.datasetId ? draft.versionId || undefined : undefined,
    versioning: draft.versioning,
    metric: metric || undefined,
    includeErrored,
  };
}

function Picker({ envId }: { envId: string }) {
  const { projectId, doc, chooseBase } = useLaunch();
  const scopeQuery = useBestRunScope(projectId, envId);
  const [draft, setDraft] = useState<ScopeDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<ScopeDraft | null>(null);
  const [metric, setMetric] = useState('');
  const [includeErrored, setIncludeErrored] = useState(false);
  const scope = applied ? toScope(applied, metric, includeErrored) : null;
  const runs = useBestRuns(projectId, envId, scope);
  const data: BestRunsPayload | undefined = runs.data;
  // "Find" loads the top-ranked run as the base once its list arrives; later metric changes do not.
  const autoPick = useRef(false);

  function find(next: ScopeDraft) {
    autoPick.current = true;
    setMetric('');
    setApplied({ ...next, versioning: { ...next.versioning } });
  }

  function use(runId: string) {
    void chooseBase('best_run', { runId, metric: metric || data?.metric || undefined });
  }

  useEffect(() => {
    if (!autoPick.current || !data || runs.isFetching) return;
    autoPick.current = false;
    const top = data.runs[0];
    if (top) void chooseBase('best_run', { runId: top.run_id, metric: data.metric ?? undefined });
  }, [data, runs.isFetching, chooseBase]);

  const empty = data && !data.runs.length;
  const other = data?.latest_version_with_runs;
  return (
    <div className={styles.picker} data-best-run-picker>
      {scopeQuery.isError ? (
        <ErrorState
          error={scopeQuery.error}
          title="Could not load what can be ranked"
          onRetry={() => void scopeQuery.refetch()}
          compact
        />
      ) : !scopeQuery.data ? (
        <Skeleton kind="lines" rows={2} label="Loading datasets, versions and versioning" />
      ) : (
        <ScopePrompt
          options={scopeQuery.data}
          draft={draft}
          onDraft={setDraft}
          applied={applied}
          onFind={() => find(draft)}
        />
      )}

      {applied ? (
        <>
          <div className={styles.rowCenter}>
            <Select
              label="Rank by"
              width="14rem"
              items={[
                { key: DEFAULT_METRIC, label: data?.metric && !metric ? `Default · ${data.metric}` : 'Default metric' },
                ...(data?.metrics ?? []).map((m) => ({ key: m.name, label: `${m.name} · ${runCount(m.run_count)}` })),
                ...(metric && !(data?.metrics ?? []).some((m) => m.name === metric)
                  ? [{ key: metric, label: metric }]
                  : []),
              ]}
              value={metric || DEFAULT_METRIC}
              onChange={(k) => setMetric(k == null || k === DEFAULT_METRIC ? '' : String(k))}
            />
            <Checkbox isSelected={includeErrored} onChange={setIncludeErrored}>
              Include runs with over 20% errored items
            </Checkbox>
            <span className={styles.spacer} />
            {data?.scope ? (
              <Tag kind={data.scope.global ? undefined : 'version'} tone={data.scope.global ? 'info' : undefined}>
                {scopeSummary(data)}
              </Tag>
            ) : null}
          </div>
          {data?.scope && !data.scope.dataset_version ? (
            <p className={styles.hint}>
              These runs may span datasets or versions, whose scores are not strictly comparable. Pick a version to
              compare like with like.
            </p>
          ) : null}
          {runs.isError ? (
            <ErrorState
              error={runs.error}
              title="Could not load the best runs"
              onRetry={() => void runs.refetch()}
              compact
            />
          ) : !data ? (
            <Skeleton kind="table" rows={3} label="Loading the best runs" />
          ) : empty ? (
            <div className={styles.rowCenter} data-best-run-empty>
              <Text variant="base" tone="secondary" as="span">
                {(data.reason && BEST_RUN_REASONS[data.reason]) || 'No official run to start from.'}
              </Text>
              {other ? (
                <Button
                  variant="neutral"
                  onPress={() =>
                    find({
                      ...(applied ?? EMPTY_DRAFT),
                      datasetId: data.dataset?.id ?? applied.datasetId,
                      versionId: other.id,
                    })
                  }
                >
                  Use {other.name ?? other.version} ({runCount(other.run_count)})
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <RunsTable
                runs={data.runs}
                metric={data.metric ?? ''}
                k={data.k}
                selectedRunId={doc.base.runId}
                onUse={(r) => use(r.run_id)}
              />
              {data.excluded_errored_count ? (
                <p className={styles.hint}>
                  {data.excluded_errored_count} run{data.excluded_errored_count === 1 ? ' is' : 's are'} hidden for
                  erroring on over 20% of items.
                </p>
              ) : null}
            </>
          )}
        </>
      ) : null}
      <BestRunNotices />
    </div>
  );
}

/**
 * "Start from a best run" (B15): pick what to rank on (dataset, version, versioning), then Find;
 * the top-ranked run becomes the starting point and any run of the table can replace it.
 */
export function BestRunPicker() {
  const { baseState } = useLaunch();
  const envId = baseState.envId;
  if (!envId) return <p className={styles.hint}>Pick an environment first.</p>;
  return <Picker key={envId} envId={envId} />;
}
