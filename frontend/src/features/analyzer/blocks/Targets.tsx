import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Chip,
  Disclosure,
  EmptyState,
  LinkButton,
  NumberField,
  Pagination,
  Slider,
  Switch,
  Tag,
  Text,
} from '@/ui';
import { projectPath } from '@/app/routes';
import { existingAnalysis, isHumanMetricAnalysis } from '../model/targets';
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
            width="100%"
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

const preview = (value: unknown): string => {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, 160);
};

/** Failing targets, one compact row each, 10 per page. */
export function TargetList({
  ws,
  slug,
  onPreview,
}: {
  ws: RunWorkspace;
  slug: string;
  onPreview?: (key: string) => void;
}) {
  const [page, setPage] = useState(1);
  const targets = useMemo(
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
  return (
    <div className={s.stack}>
      <div className={s.listHead}>
        <Text variant="sm" tone="muted" as="p" role="status">
          {`${items} ${items === 1 ? 'item' : 'items'} with failed metric targets${ws.settings.limit ? ` · limit ${ws.settings.limit}` : ''}${ws.sessionAnalyzed.size ? ` · ${ws.sessionAnalyzed.size} analyzed this session` : ''}`}
        </Text>
        {ws.frozen && !ws.runner.busy ? (
          <Button size="sm" onPress={ws.refreshTargets}>
            Refresh targets
          </Button>
        ) : null}
      </div>
      <ul className={s.targetList} aria-label="Targets" data-frozen={ws.frozen ? '' : undefined}>
        {rows.map(({ row, metric, key }) => {
          const text = preview(row.input);
          const score = row.metric_scores[metric];
          const analysis = existingAnalysis(row, metric);
          const causes = analysis ? rootCauseCategories(analysis) : [];
          const human = analysis ? isHumanMetricAnalysis(row.item_metadata, metric) : false;
          const justNow = !analysis && ws.sessionAnalyzed.has(key);
          return (
            <li key={key} className={s.targetRow} data-active={ws.focusKey === key ? '' : undefined}>
              <Checkbox
                hideLabel
                aria-label={`Include ${metric} of ${row.item_id} in Test Selected`}
                isSelected={ws.testKeys.includes(key)}
                isDisabled={!ws.testKeys.includes(key) && ws.testKeys.length >= 3}
                onChange={() => ws.toggleTest(key)}
              />
              <Text variant="sm" mono tone="muted" as="span" className={s.targetId}>
                {row.item_id}
              </Text>
              <Chip
                isSelected={ws.focusKey === key}
                onChange={() => ws.setFocusKey(key)}
                aria-label={`${metric}${score != null ? ` ${score.toFixed(2)}` : ''}, preview target of ${row.item_id}`}
              >
                {`${metric}${score != null ? ` ${score.toFixed(2)}` : ''}`}
              </Chip>
              {analysis || justNow ? (
                <Tag kind="data" tone={human ? 'success' : 'info'}>
                  {human ? 'human' : 'analyzed'}
                </Tag>
              ) : null}
              {causes.slice(0, 2).map((c) => (
                <Tag key={c} kind="role">
                  {c}
                </Tag>
              ))}
              <Text
                variant="base"
                tone="secondary"
                as="span"
                dir={direction(text)}
                className={s.targetText}
                truncate
              >
                {text}
              </Text>
              {onPreview ? (
                <Button
                  size="sm"
                  onPress={() => onPreview(key)}
                  aria-label={`Preview prompt of ${metric} on ${row.item_id}`}
                >
                  Preview
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {total > PAGE_SIZE ? (
        <Pagination total={total} page={current} pageSize={PAGE_SIZE} noun="targets" onPageChange={setPage} />
      ) : null}
      <Text variant="sm" tone="muted" as="p">
        Check up to 3 targets to test them together.
      </Text>
    </div>
  );
}
