/** Composable rule builder (AND / OR groups) over aligned items; fields are evaluated across every compared run. */
import { Button, IconButton, MultiSelect, SegmentedControl, Select, Text, TextField } from '@/ui';
import { useCompare } from '../../CompareContext';
import {
  conditionHasValue,
  emptyGroup,
  filterRuleCountRaw,
  isFilterGroup,
  type FieldDef,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
} from '../../lib/filters';
import styles from './FilterBuilder.module.css';

const NUMBER_OPS: Array<[string, string]> = [
  ['gte', '≥'],
  ['gt', '>'],
  ['lte', '≤'],
  ['lt', '<'],
  ['eq', '='],
  ['neq', '≠'],
];

function defaultCondition(f: FieldDef | null): FilterCondition {
  if (!f) return { field: '', oper: '', value: '' };
  if (f.kind === 'enum') return { field: f.id, oper: 'in', value: [] };
  if (f.kind === 'number') return { field: f.id, oper: 'gte', value: '' };
  if (f.kind === 'bool') return { field: f.id, oper: 'is', value: '' };
  return { field: f.id, oper: 'contains', value: '' };
}

function replaceAt(
  root: FilterGroup,
  path: number[],
  fn: (node: FilterNode) => FilterNode | null,
): FilterGroup {
  if (!path.length) return (fn(root) as FilterGroup) ?? root;
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.flatMap((child, i) => {
      if (i !== head) return [child];
      if (!rest.length) {
        const next = fn(child);
        return next ? [next] : [];
      }
      return [replaceAt(child as FilterGroup, rest, fn)];
    }),
  };
}

function Condition({
  node,
  path,
  defs,
  onChange,
}: {
  node: FilterCondition;
  path: number[];
  defs: Map<string, FieldDef>;
  onChange: (path: number[], fn: (n: FilterNode) => FilterNode | null) => void;
}) {
  const field = defs.get(node.field) ?? null;
  const list = Array.from(defs.values());
  const set = (patch: Partial<FilterCondition>) =>
    onChange(path, (n) => ({ ...(n as FilterCondition), ...patch }));
  const shown =
    field?.percent && node.value !== '' && !Number.isNaN(Number(node.value))
      ? String(Number((Number(node.value) * 100).toFixed(4)))
      : String(Array.isArray(node.value) ? '' : (node.value ?? ''));
  return (
    <div className={styles.cond} data-testid="filter-condition">
      <Select
        label="Field"
        hideLabel
        value={field?.id ?? null}
        placeholder="Choose field…"
        searchable="auto"
        onChange={(k) => k && onChange(path, () => defaultCondition(defs.get(String(k)) ?? null))}
        items={list.map((d) => ({ key: d.id, label: `${d.group} · ${d.label}` }))}
        width={200}
      />
      {field ? (
        <>
          {field.kind === 'number' ? (
            <>
              <Select
                label="Operator"
                hideLabel
                value={node.oper}
                onChange={(k) => k && set({ oper: String(k) })}
                items={NUMBER_OPS.map(([key, label]) => ({ key, label }))}
                width={72}
              />
              <TextField
                label={`${field.label} value`}
                hideLabel
                inputMode="decimal"
                value={shown}
                width="9ch"
                onChange={(v) =>
                  set({
                    value:
                      field.percent && v !== '' && !Number.isNaN(Number(v)) ? String(Number(v) / 100) : v,
                  })
                }
              />
              {field.percent ? <span className={styles.unit}>%</span> : null}
            </>
          ) : null}
          {field.kind === 'enum' ? (
            <>
              <Select
                label="Operator"
                hideLabel
                value={node.oper}
                onChange={(k) => k && set({ oper: String(k) })}
                items={[
                  { key: 'in', label: 'is any of' },
                  { key: 'notin', label: 'is none of' },
                ]}
                width={120}
              />
              <MultiSelect
                label="Values"
                items={(field.choices ?? []).map((ch) => ({ key: ch.value, label: ch.label }))}
                value={new Set(Array.isArray(node.value) ? node.value : [])}
                onChange={(keys) => set({ value: Array.from(keys).map(String) })}
                searchable
                onlyAction
                selectAll
              />
            </>
          ) : null}
          {field.kind === 'bool' ? (
            <Select
              label="State"
              hideLabel
              value={String(node.value) || null}
              placeholder="Choose state…"
              onChange={(k) => k && set({ value: String(k) })}
              items={[
                { key: 'true', label: 'true' },
                { key: 'false', label: 'false' },
              ]}
              width={120}
            />
          ) : null}
          {field.kind === 'text' ? (
            <>
              <Select
                label="Operator"
                hideLabel
                value={node.oper}
                onChange={(k) => k && set({ oper: String(k) })}
                items={[
                  { key: 'contains', label: 'contains' },
                  { key: 'notcontains', label: 'does not contain' },
                ]}
                width={160}
              />
              <TextField
                label={`${field.label} text`}
                hideLabel
                value={String(node.value ?? '')}
                onChange={(v) => set({ value: v })}
                placeholder="text…"
                width="20ch"
              />
            </>
          ) : null}
        </>
      ) : null}
      <IconButton
        label="Delete condition"
        icon="trash"
        tone="danger"
        onPress={() => onChange(path, () => null)}
      />
    </div>
  );
}

function Group({
  node,
  path,
  defs,
  onChange,
}: {
  node: FilterGroup;
  path: number[];
  defs: Map<string, FieldDef>;
  onChange: (path: number[], fn: (n: FilterNode) => FilterNode | null) => void;
}) {
  return (
    <div
      className={styles.group}
      data-root={path.length === 0 || undefined}
      role="group"
      aria-label={path.length ? 'Rule group' : 'Rules'}
    >
      <div className={styles.groupHead}>
        <SegmentedControl<'and' | 'or'>
          label="Match mode"
          value={node.op}
          onChange={(op) => onChange(path, (n) => ({ ...(n as FilterGroup), op }))}
          options={[
            { value: 'and', label: 'AND' },
            { value: 'or', label: 'OR' },
          ]}
        />
        <Text variant="sm" tone="muted">
          {node.op === 'and' ? 'every rule below must match' : 'any rule below may match'}
        </Text>
        {path.length ? (
          <IconButton
            label="Delete group"
            icon="trash"
            tone="danger"
            onPress={() => onChange(path, () => null)}
          />
        ) : null}
      </div>
      {node.children.map((child, i) =>
        isFilterGroup(child) ? (
          <Group key={i} node={child} path={[...path, i]} defs={defs} onChange={onChange} />
        ) : (
          <Condition key={i} node={child} path={[...path, i]} defs={defs} onChange={onChange} />
        ),
      )}
      <div className={styles.add}>
        <Button
          size="sm"
          variant="neutral"
          onPress={() =>
            onChange(path, (n) => ({
              ...(n as FilterGroup),
              children: [...(n as FilterGroup).children, defaultCondition(null)],
            }))
          }
        >
          + Condition
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={() =>
            onChange(path, (n) => ({
              ...(n as FilterGroup),
              children: [...(n as FilterGroup).children, emptyGroup()],
            }))
          }
        >
          + Group
        </Button>
      </div>
    </div>
  );
}

export function FilterBuilder() {
  const { defs, c } = useCompare();
  const map = new Map(defs.map((d) => [d.id, d]));
  const rules = c.view.filters.rules;
  const count = filterRuleCountRaw(rules, (x) => conditionHasValue(x) && map.has(x.field));
  const onChange = (path: number[], fn: (n: FilterNode) => FilterNode | null) =>
    c.setView({ filters: { ...c.view.filters, rules: replaceAt(rules, path, fn) } });
  return (
    <section className={styles.builder} aria-label="Filter rules" data-testid="filter-builder">
      <Text variant="sm" tone="muted">
        {count ? `${count} rule${count === 1 ? '' : 's'} applied` : 'No rules yet'} {'·'} a rule matches an
        item when any compared run matches it.
      </Text>
      <Group node={rules} path={[]} defs={map} onChange={onChange} />
    </section>
  );
}
