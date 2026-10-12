import { useMemo, useState } from 'react';
import { useExamples, type AnalysisScope, type ExampleQuery } from '@/api/analysis';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  MultiSelect,
  NumberField,
  Pagination,
  SearchField,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/ui';
import { useDebounced } from '../useDebounced';
import s from './examples.module.css';

export const EXAMPLE_FIELDS = [
  { key: 'input', label: 'Input' },
  { key: 'expected', label: 'Expected output' },
  { key: 'output', label: 'Actual output' },
  { key: 'previous_ai_root_cause', label: 'Previous AI root cause' },
  { key: 'previous_ai_root_causes', label: 'Previous AI root causes' },
  { key: 'approved_root_cause', label: 'Approved root cause' },
  { key: 'approved_root_causes', label: 'Approved root causes' },
  { key: 'approved_detail', label: 'Approved detail' },
  { key: 'reviewer_reasoning', label: 'Reviewer reasoning' },
] as const;

export type ExampleFields = Record<string, boolean>;
export const allExampleFields = (): ExampleFields =>
  Object.fromEntries(EXAMPLE_FIELDS.map((f) => [f.key, true]));

type Source = 'all' | 'ai_only' | 'human_only' | 'corrected';
const PAGE_SIZE = 25;

export interface ExampleSelection {
  ids: number[];
  fields: ExampleFields;
}

export function ExamplePicker({
  scope,
  open,
  onOpenChange,
  value,
  characterLimit,
  onUse,
}: {
  scope: AnalysisScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ExampleSelection;
  characterLimit: number | null;
  onUse: (selection: ExampleSelection) => void;
}) {
  // Remount on every open so the draft selection starts from the committed one.
  return open ? (
    <PickerBody
      scope={scope}
      onOpenChange={onOpenChange}
      value={value}
      characterLimit={characterLimit}
      onUse={onUse}
    />
  ) : null;
}

function PickerBody({
  scope,
  onOpenChange,
  value,
  characterLimit,
  onUse,
}: {
  scope: AnalysisScope;
  onOpenChange: (open: boolean) => void;
  value: ExampleSelection;
  characterLimit: number | null;
  onUse: (selection: ExampleSelection) => void;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);
  const [page, setPage] = useState(1);
  const [task, setTask] = useState<Set<string>>(new Set());
  const [dataset, setDataset] = useState<Set<string>>(new Set());
  const [model, setModel] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<Source>('all');
  const [confMin, setConfMin] = useState<number | undefined>();
  const [confMax, setConfMax] = useState<number | undefined>();
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set(value.ids));
  const [fields, setFields] = useState<ExampleFields>(value.fields);
  const [showFields, setShowFields] = useState(false);

  const query: ExampleQuery = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      task: [...task],
      dataset: [...dataset],
      model: [...model],
      run_name: [...run],
      user_id: [...user],
      source: source === 'all' ? null : source,
      ...(confMin != null ? { conf_min: confMin / 100 } : {}),
      ...(confMax != null ? { conf_max: confMax / 100 } : {}),
      search: debounced.trim(),
      selected_ids: [...selected],
      selected_only: selectedOnly,
    }),
    [page, task, dataset, model, run, user, source, confMin, confMax, debounced, selected, selectedOnly],
  );
  const examples = useExamples(scope, query, true);
  const data = examples.data;
  const facets = data?.facets;

  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  const toItems = (list: string[] | undefined) => (list ?? []).map((v) => ({ key: v, label: v }));
  const asStrings = (keys: Set<unknown>) => new Set([...keys].map(String));

  const budgetUsed = data?.selected_characters ?? 0;
  const over = characterLimit != null && budgetUsed > characterLimit;
  const pct = characterLimit ? Math.min(100, Math.round((budgetUsed / characterLimit) * 100)) : 0;
  const allFilteredSelected = Boolean(
    data && data.matching_ids.length && data.matching_ids.every((id) => selected.has(id)),
  );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Approved examples"
      description="Choose corrected diagnoses the rule writer should learn from."
      size="data"
      className={s.dialog}
      footer={
        <>
          <Button size="md" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="md"
            variant="primary"
            isDisabled={over}
            onPress={() => {
              onUse({ ids: [...selected], fields });
              onOpenChange(false);
            }}
          >
            {`Use ${selected.size} selected ${selected.size === 1 ? 'example' : 'examples'}`}
          </Button>
        </>
      }
    >
      <div className={s.filters}>
        <SearchField
          label="Search examples"
          placeholder="Search examples"
          value={search}
          onChange={reset(setSearch)}
          onClear={() => setSearch('')}
          width={220}
        />
        <MultiSelect
          label="Task"
          items={toItems(facets?.tasks)}
          value={task}
          onChange={(k) => reset(setTask)(asStrings(k))}
        />
        <MultiSelect
          label="Dataset"
          items={toItems(facets?.datasets)}
          value={dataset}
          onChange={(k) => reset(setDataset)(asStrings(k))}
        />
        <MultiSelect
          label="Model"
          items={toItems(facets?.models)}
          value={model}
          onChange={(k) => reset(setModel)(asStrings(k))}
        />
        <MultiSelect
          label="Run"
          items={toItems(facets?.run_names)}
          value={run}
          onChange={(k) => reset(setRun)(asStrings(k))}
        />
        <MultiSelect
          label="Reviewer"
          items={(facets?.users ?? []).map((u) => ({ key: u.id, label: u.display_name || u.email || u.id }))}
          value={user}
          onChange={(k) => reset(setUser)(asStrings(k))}
        />
      </div>
      <div className={s.filters}>
        <SegmentedControl<Source>
          label="Source"
          value={source}
          onChange={reset(setSource)}
          options={[
            { value: 'all', label: 'All sources' },
            { value: 'ai_only', label: 'AI only' },
            { value: 'human_only', label: 'Human only' },
            { value: 'corrected', label: 'Corrected' },
          ]}
        />
        <NumberField
          label="Min confidence %"
          minValue={0}
          maxValue={100}
          value={confMin ?? NaN}
          onChange={(v) => reset(setConfMin)(Number.isFinite(v) ? v : undefined)}
          width={110}
          steppers={false}
        />
        <NumberField
          label="Max confidence %"
          minValue={0}
          maxValue={100}
          value={confMax ?? NaN}
          onChange={(v) => reset(setConfMax)(Number.isFinite(v) ? v : undefined)}
          width={110}
          steppers={false}
        />
        <Button size="sm" onPress={() => setShowFields((v) => !v)} aria-expanded={showFields}>
          Choose prompt fields
        </Button>
      </div>
      {showFields ? (
        <div className={s.fields} role="group" aria-label="Prompt fields">
          {EXAMPLE_FIELDS.map((f) => (
            <Checkbox
              key={f.key}
              isSelected={fields[f.key] ?? false}
              onChange={(v) => setFields((cur) => ({ ...cur, [f.key]: v }))}
            >
              {f.label}
            </Checkbox>
          ))}
        </div>
      ) : null}

      <div className={s.budget}>
        <div className={s.budgetHead}>
          <Text variant="sm" tone="muted" role="status">
            {`${selected.size} selected · ${budgetUsed.toLocaleString()} characters${characterLimit ? ` of ${characterLimit.toLocaleString()}` : ''}`}
          </Text>
          {over ? <Badge tone="danger">Over the rule-writer budget</Badge> : null}
          <span className={s.spacer} />
          <Checkbox
            isSelected={allFilteredSelected}
            isDisabled={!data || data.matching_ids.length === 0}
            onChange={(v) =>
              setSelected((cur) => {
                const next = new Set(cur);
                (data?.matching_ids ?? []).forEach((id) => (v ? next.add(id) : next.delete(id)));
                return next;
              })
            }
          >
            {`Select all filtered${data ? ` (${data.matching_ids.length})` : ''}`}
          </Checkbox>
          <Checkbox isSelected={selectedOnly} onChange={reset(setSelectedOnly)}>
            View selected
          </Checkbox>
        </div>
        {characterLimit ? (
          <div
            className={s.bar}
            role="progressbar"
            aria-label="Character budget"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className={s.barFill} data-over={over ? '' : undefined} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>

      {examples.isError ? (
        <ErrorState
          error={examples.error}
          title="Couldn’t load examples"
          onRetry={() => examples.refetch()}
          compact
        />
      ) : !data ? (
        <Skeleton kind="lines" rows={6} label="Loading examples" />
      ) : data.examples.length === 0 ? (
        <EmptyState
          compact
          title="No examples match"
          body="Approve diagnoses in Reviews, or relax the filters."
        />
      ) : (
        <>
          <div className={s.tableWrap} data-fetching={examples.isFetching ? '' : undefined}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col" className={s.checkCol}>
                    <span className={s.srOnly}>Select</span>
                  </th>
                  <th scope="col">Item</th>
                  <th scope="col">Root causes</th>
                  <th scope="col">Run</th>
                  <th scope="col">Source</th>
                  <th scope="col">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {data.examples.map((e) => (
                  <tr key={e.id} data-selected={selected.has(e.id) ? '' : undefined}>
                    <td className={s.checkCol}>
                      <Checkbox
                        hideLabel
                        aria-label={`Select example ${e.item_id}`}
                        isSelected={selected.has(e.id)}
                        onChange={(v) =>
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (v) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={s.mono}>{e.item_id}</td>
                    <td dir="auto">
                      {(e.root_causes ?? []).join(', ')}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </td>
                    <td>{[e.task, e.model].filter(Boolean).join(' · ')}</td>
                    <td>{e.source ?? '—'}</td>
                    <td className={s.mono}>
                      {e.confidence != null ? `${Math.round(e.confidence * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            total={data.total}
            page={data.page}
            pageSize={data.page_size}
            pageCount={data.page_count}
            noun="examples"
            onPageChange={setPage}
          />
        </>
      )}
    </Dialog>
  );
}
