/** Nested AND/OR rule builder over the item field defs (brief 04 J7). Typed values commit after 150 ms. */
import { useSyncedInput } from '../../hooks/useSynced';
import { Button, IconButton, MultiSelect, SegmentedControl, Select, TextField } from '@/ui';
import {
  defaultConditionFor,
  isFilterGroup,
  type FieldDef,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
} from '../../lib/filterRules';
import styles from './RuleBuilder.module.css';

const NUM_OPERS = [
  { key: 'gte', label: '≥' },
  { key: 'gt', label: '>' },
  { key: 'lte', label: '≤' },
  { key: 'lt', label: '<' },
  { key: 'eq', label: '=' },
  { key: 'neq', label: '≠' },
];

function operatorsFor(f: FieldDef | undefined) {
  if (!f) return [];
  if (f.kind === 'metric') return [{ key: 'is', label: 'is' }, ...NUM_OPERS];
  if (f.kind === 'number') return NUM_OPERS;
  if (f.kind === 'enum')
    return [
      { key: 'in', label: 'is any of' },
      { key: 'notin', label: 'is none of' },
    ];
  if (f.kind === 'bool') return [{ key: 'is', label: 'is' }];
  return [
    { key: 'contains', label: 'contains' },
    { key: 'notcontains', label: 'does not contain' },
  ];
}

function ValueInput({
  field,
  node,
  onChange,
}: {
  field: FieldDef;
  node: FilterCondition;
  onChange: (patch: Partial<FilterCondition>) => void;
}) {
  const percent = !!field.percent && node.oper !== 'is';
  const stored = typeof node.value === 'string' || typeof node.value === 'number' ? String(node.value) : '';
  const shown =
    percent && stored !== '' && !Number.isNaN(Number(stored))
      ? String(Math.round(Number(stored) * 1000) / 10)
      : stored;
  const [local, setLocal] = useSyncedInput(
    shown,
    (v) => {
      if (percent) onChange({ value: v === '' || Number.isNaN(Number(v)) ? v : String(Number(v) / 100) });
      else onChange({ value: v });
    },
    150,
  );
  if (field.kind === 'enum') {
    const items = (field.values ?? []).map((v) => ({ key: v, label: v }));
    const selected = new Set<string | number>(Array.isArray(node.value) ? node.value : []);
    return (
      <MultiSelect
        label={`${field.label} values`}
        items={items}
        value={selected}
        searchable={items.length > 8}
        onlyAction
        selectAll
        placeholder="Choose values"
        onChange={(keys) => onChange({ value: Array.from(keys).map(String) })}
      />
    );
  }
  if (field.kind === 'metric' && node.oper === 'is') {
    return (
      <Select
        label="Verdict"
        hideLabel
        items={[
          { key: 'passed', label: 'passed' },
          { key: 'failed', label: 'failed' },
        ]}
        value={typeof node.value === 'string' && node.value ? node.value : null}
        placeholder="Choose"
        onChange={(k) => onChange({ value: k ? String(k) : '' })}
      />
    );
  }
  if (field.kind === 'bool') {
    return (
      <Select
        label="Value"
        hideLabel
        items={[
          { key: 'true', label: 'true' },
          { key: 'false', label: 'false' },
        ]}
        value={typeof node.value === 'string' && node.value ? node.value : null}
        placeholder="Choose"
        onChange={(k) => onChange({ value: k ? String(k) : '' })}
      />
    );
  }
  return (
    <TextField
      label={`${field.label} value`}
      hideLabel
      value={local}
      onChange={setLocal}
      placeholder={percent ? 'percent' : field.kind === 'text' ? 'text' : 'number'}
      suffix={percent ? '%' : undefined}
      width="12ch"
    />
  );
}

function ConditionRow({
  node,
  defs,
  onChange,
  onRemove,
}: {
  node: FilterCondition;
  defs: FieldDef[];
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}) {
  const field = defs.find((d) => d.id === node.field);
  return (
    <div className={styles.condition} data-testid="rule-condition">
      <Select
        label="Field"
        hideLabel
        searchable="auto"
        items={defs.map((d) => ({ key: d.id, label: d.label, description: d.group }))}
        value={field ? field.id : null}
        placeholder="Choose field…"
        onChange={(k) => {
          const next = defs.find((d) => d.id === k);
          if (next) onChange(defaultConditionFor(next));
        }}
      />
      {field ? (
        <>
          <Select
            label="Operator"
            hideLabel
            items={operatorsFor(field)}
            value={node.oper || null}
            onChange={(k) =>
              onChange({
                ...node,
                oper: String(k ?? ''),
                value:
                  field.kind === 'enum'
                    ? Array.isArray(node.value)
                      ? node.value
                      : []
                    : node.oper === 'is' && k !== 'is'
                      ? ''
                      : node.value,
              })
            }
          />
          <ValueInput field={field} node={node} onChange={(patch) => onChange({ ...node, ...patch })} />
        </>
      ) : null}
      <IconButton label="Remove condition" icon="close" tone="danger" onPress={onRemove} />
    </div>
  );
}

function GroupView({
  group,
  defs,
  depth,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  defs: FieldDef[];
  depth: number;
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
}) {
  const setChild = (i: number, node: FilterNode) =>
    onChange({ ...group, children: group.children.map((c, j) => (j === i ? node : c)) });
  const removeChild = (i: number) =>
    onChange({ ...group, children: group.children.filter((_, j) => j !== i) });
  return (
    <div className={styles.group} data-depth={depth}>
      <div className={styles.groupHead}>
        <SegmentedControl
          label="Combine rules with"
          options={[
            { value: 'and', label: 'AND', title: 'every rule below must match' },
            { value: 'or', label: 'OR', title: 'any rule below may match' },
          ]}
          value={group.op}
          onChange={(op) => onChange({ ...group, op })}
        />
        <span className={styles.hint}>
          {group.op === 'and' ? 'every rule below must match' : 'any rule below may match'}
        </span>
        {onRemove ? <IconButton label="Remove group" icon="trash" tone="danger" onPress={onRemove} /> : null}
      </div>
      {group.children.length === 0 ? <div className={styles.empty}>no rules yet</div> : null}
      {group.children.map((child, i) =>
        isFilterGroup(child) ? (
          <GroupView
            key={i}
            group={child}
            defs={defs}
            depth={depth + 1}
            onChange={(n) => setChild(i, n)}
            onRemove={() => removeChild(i)}
          />
        ) : (
          <ConditionRow
            key={i}
            node={child}
            defs={defs}
            onChange={(n) => setChild(i, n)}
            onRemove={() => removeChild(i)}
          />
        ),
      )}
      <div className={styles.addRow}>
        <Button
          size="sm"
          variant="neutral"
          onPress={() => onChange({ ...group, children: [...group.children, defaultConditionFor(null)] })}
        >
          + Condition
        </Button>
        {depth < 5 ? (
          <Button
            size="sm"
            variant="neutral"
            onPress={() => onChange({ ...group, children: [...group.children, { op: 'and', children: [] }] })}
          >
            + Group
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function RuleBuilder({
  rules,
  defs,
  onChange,
}: {
  rules: FilterGroup;
  defs: FieldDef[];
  onChange: (rules: FilterGroup) => void;
}) {
  return (
    <div className={styles.builder}>
      <GroupView group={rules} defs={defs} depth={0} onChange={onChange} />
    </div>
  );
}
