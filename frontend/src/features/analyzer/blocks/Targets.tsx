import { useMemo, useState } from 'react';
import {
  Button,
  DataTable,
  Disclosure,
  EmptyState,
  LinkButton,
  NumberField,
  promptPreview,
  ScoreValue,
  Slider,
  Switch,
  Tag,
  Text,
  type Column,
  type Key,
} from '@/ui';
import { projectPath } from '@/app/routes';
import { existingAnalysis, isHumanMetricAnalysis, type AnalyzerRow } from '../model/targets';
import { rootCauseCategories } from '../model/rootCause';
import { targetKeyOf, type RunWorkspace } from '../workspace/useRunWorkspace';
import { useRunDirection } from './direction';
import s from './blocks.module.css';

export const PAGE_SIZE = 10;

/** Max score, skip analyzed, human overwrite, timeout, limit, max issues. */
export function TargetFilters({
  ws,
  maxTimeout,
  maxRetries,
  defaults,
}: {
  ws: RunWorkspace;
  maxTimeout: number;
  maxRetries: number;
  /** Values restored when a field is emptied or set to 0 (the old page did the same). */
  defaults: { timeoutSeconds: number; maxIssues: number };
}) {
  const { settings, update } = ws;
  const custom = [
    settings.limit != null ? `limit ${settings.limit}` : null,
    settings.timeoutSeconds !== defaults.timeoutSeconds ? `${settings.timeoutSeconds}s timeout` : null,
    settings.maxIssues !== defaults.maxIssues ? `${settings.maxIssues} issues` : null,
  ].filter(Boolean);
  return (
    <div className={s.filters}>
      <div className={s.filterLine}>
        <div className={s.sliderSlot}>
          <Slider
            label="Max score (higher-is-better metrics)"
            minValue={0}
            maxValue={100}
            step={5}
            unit="%"
            value={settings.maxScorePct}
            onChange={(v) => update({ maxScorePct: v })}
            // cv5 Q5: label, a 280px track and the value on one line; it never spans the section
            layout="inline"
            trackWidth={280}
          />
        </div>
        <div className={s.switchRow}>
          <Switch isSelected={settings.skipAnalyzed} onChange={(v) => update({ skipAnalyzed: v })}>
            Skip analyzed
          </Switch>
          <Switch isSelected={settings.allowHuman} onChange={(v) => update({ allowHuman: v })}>
            Re-analyze human labels
          </Switch>
        </div>
      </div>
      <Disclosure title="More options" summary={custom.length ? custom.join(' · ') : 'Defaults'}>
        <div className={s.numberRow}>
          <NumberField
            label="Timeout (s)"
            minValue={0}
            maxValue={maxTimeout}
            value={settings.timeoutSeconds}
            help={
              maxRetries === 0
                ? 'The first LLM attempt uses this timeout. Timeout retries are disabled by server configuration.'
                : `The first LLM attempt uses this timeout. A timed-out request retries up to ${maxRetries} ${maxRetries === 1 ? 'time' : 'times'}; each retry doubles the previous timeout.`
            }
            onChange={(v) =>
              update({ timeoutSeconds: Number.isFinite(v) && v >= 1 ? v : defaults.timeoutSeconds })
            }
            width={110}
          />
          <NumberField
            label="Analyze limit"
            minValue={1}
            maxValue={9999}
            value={settings.limit ?? NaN}
            onChange={(v) => update({ limit: Number.isFinite(v) ? v : null })}
            placeholder="All"
            width={110}
          />
          <NumberField
            label="Max issues per item"
            minValue={0}
            maxValue={10}
            value={settings.maxIssues}
            help="Limits how many root-cause issues the analyzer can return for each item. Higher values allow multiple independent causes."
            onChange={(v) => update({ maxIssues: Number.isFinite(v) && v >= 1 ? v : defaults.maxIssues })}
            width={110}
          />
        </div>
      </Disclosure>
    </div>
  );
}

/** The item's input as one readable line (the same prompt reading as the run detail), never raw JSON. */
const preview = (value: unknown): string => promptPreview(value, 160);

interface TargetRow {
  key: string;
  row: AnalyzerRow;
  metric: string;
}

/**
 * Failing targets as one standard data table (cv4 D2): check (up to 3 for Test), item, metric, score, diagnosis,
 * input. 10 per page, the shared pager in the footer. With the prompt pane (cv5 K4) a row click shows that target in
 * the pane and the row is the table's current row; without it, a row click and the eye tile open the preview drawer.
 */
export function TargetList({
  ws,
  slug,
  onPreview,
  onSelect,
}: {
  ws: RunWorkspace;
  slug: string;
  /** Narrow screen: open the preview drawer on this target. */
  onPreview?: (key: string) => void;
  /** Wide screen: show this target in the prompt pane. */
  onSelect?: (key: string) => void;
}) {
  const [page, setPage] = useState(1);
  const targets = useMemo<TargetRow[]>(
    () =>
      ws.matched.flatMap(({ row, metrics }) =>
        metrics.map((metric) => ({ row, metric, key: targetKeyOf(row.item_id, metric) })),
      ),
    [ws.matched],
  );
  const total = targets.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = targets.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const direction = useRunDirection();
  const { sessionAnalyzed, focusKey, testKeys } = ws;
  // The Diagnosis column shows only while some target has one (with "Skip analyzed" on, none has until a job runs).
  const anyDiagnosis = useMemo(
    () => targets.some((t) => sessionAnalyzed.has(t.key) || existingAnalysis(t.row, t.metric) != null),
    [targets, sessionAnalyzed],
  );

  const columns = useMemo<Column<TargetRow>[]>(
    () => [
      {
        id: 'item',
        header: 'Item',
        type: 'id',
        width: 120,
        priority: 1,
        cardTitle: true,
        hideable: false,
        cell: (t) => <span data-row-primary="">{t.row.item_id}</span>,
      },
      {
        id: 'metric',
        header: 'Metric',
        width: 150,
        priority: 2,
        cell: (t) => t.metric,
      },
      {
        id: 'score',
        header: 'Score',
        type: 'score',
        width: 90,
        align: 'center',
        priority: 2,
        cell: (t) => (
          <ScoreValue
            value={t.row.metric_scores[t.metric]}
            direction={directionOf(t.row.metric_directions[t.metric])}
            variant="plain"
          />
        ),
      },
      ...(anyDiagnosis ? [diagnosisColumn(sessionAnalyzed)] : []),
      {
        id: 'input',
        header: 'Input',
        flex: true,
        minWidth: 240,
        priority: 3,
        cell: (t) => {
          const text = preview(t.row.input);
          return (
            <Text variant="base" tone="secondary" as="span" dir={direction(text)} truncate>
              {text}
            </Text>
          );
        },
      },
    ],
    [direction, sessionAnalyzed, anyDiagnosis],
  );

  if (!ws.settings.selectedMetrics.length) {
    return (
      <EmptyState
        compact
        title="Select at least one metric"
        body="Targets are the failed items of the selected metrics."
      />
    );
  }
  if (!total) {
    return (
      <EmptyState
        compact
        title={ws.settings.skipAnalyzed ? 'All matching targets already have analysis' : 'No failed targets'}
        body={
          ws.settings.skipAnalyzed
            ? 'Include analyzed targets to run them again, or open Reviews to inspect the saved diagnoses.'
            : 'No item fails the selected metrics at the current thresholds. Task and metric errors are operational and never analyzed.'
        }
        action={
          ws.settings.skipAnalyzed ? (
            <div className={s.inline}>
              <Button size="sm" onPress={() => ws.update({ skipAnalyzed: false })}>
                Include analyzed targets
              </Button>
              <LinkButton size="sm" to={projectPath(slug, 'reviews')}>
                Open Reviews
              </LinkButton>
            </div>
          ) : undefined
        }
      />
    );
  }
  const items = ws.matched.length;
  const checked = new Set<Key>(testKeys);
  return (
    <DataTable<TargetRow>
      aria-label="Targets"
      columns={columns}
      rows={rows}
      rowKey={(t) => t.key}
      storageKey="analysis.targets.v1"
      density="regular"
      densityLocked
      stripe="report"
      columnMenu={false}
      groupBand={false}
      responsive="cards"
      selection={{
        selected: checked,
        onChange: (next) => {
          // Keep the order of the checks; new keys follow in table order (the header box adds this page's rows).
          const kept = testKeys.filter((k) => next.has(k));
          const added = rows.map((t) => t.key).filter((k) => next.has(k) && !kept.includes(k));
          ws.setTests([...kept, ...added]);
        },
        isDisabled: (t) => !checked.has(t.key) && testKeys.length >= 3,
      }}
      rowLabel={(t) => `Include ${t.metric} of ${t.row.item_id} in Test Selected`}
      selectAllLabel="Check the targets of this page to test (up to 3)"
      onRowOpen={onSelect ? (t) => onSelect(t.key) : onPreview ? (t) => onPreview(t.key) : undefined}
      activeKey={onSelect ? focusKey : undefined}
      rowActions={
        onPreview
          ? (t) => [
              {
                id: 'preview',
                label: `Preview prompt of ${t.metric} on ${t.row.item_id}`,
                icon: 'eye',
                primary: true,
                onPress: () => onPreview(t.key),
              },
            ]
          : undefined
      }
      rowProps={(t) => ({
        'data-target': t.key,
        'data-previewed': focusKey === t.key ? '' : undefined,
      })}
    >
      <DataTable.Footer
        filterNote={`${items} ${items === 1 ? 'item' : 'items'} with failed metric targets${ws.settings.limit ? ` · limit ${ws.settings.limit}` : ''}${sessionAnalyzed.size ? ` · ${sessionAnalyzed.size} analyzed this session` : ''}`}
        pagination={{ total, page: current, pageSize: PAGE_SIZE, noun: 'targets', onPageChange: setPage }}
        trailing={
          ws.frozen && !ws.runner.busy ? (
            <Button size="sm" onPress={ws.refreshTargets}>
              Refresh targets
            </Button>
          ) : null
        }
      />
    </DataTable>
  );
}

/** The run's metric direction in ScoreValue's words. */
function directionOf(direction: string | undefined): 'maximize' | 'minimize' {
  return ['minimize', 'lower', 'lower_is_better'].includes(String(direction ?? '').toLowerCase())
    ? 'minimize'
    : 'maximize';
}

/** Diagnosis column: the analyzed / human tag of a target, then up to two causes on one line. */
function diagnosisColumn(sessionAnalyzed: ReadonlySet<string>): Column<TargetRow> {
  return {
    id: 'diagnosis',
    header: 'Diagnosis',
    width: 200,
    priority: 2,
    cell: (t) => {
      const analysis = existingAnalysis(t.row, t.metric);
      const causes = analysis ? rootCauseCategories(analysis) : [];
      const human = analysis ? isHumanMetricAnalysis(t.row.item_metadata, t.metric) : false;
      const justNow = !analysis && sessionAnalyzed.has(t.key);
      if (!analysis && !justNow) return null;
      return (
        <span className={s.diagnosis}>
          <Tag kind="data" tone={human ? 'success' : 'info'}>
            {human ? 'human' : 'analyzed'}
          </Tag>
          {causes.length ? (
            <Text variant="sm" tone="muted" as="span" truncate>
              {causes.slice(0, 2).join(', ')}
            </Text>
          ) : null}
        </span>
      );
    },
  };
}
