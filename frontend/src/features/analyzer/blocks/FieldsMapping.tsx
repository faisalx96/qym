import { useState } from 'react';
import { Button, Checkbox, Icon, Select, Text } from '@/ui';
import {
  SOURCE_FIELDS,
  STD_VARIABLES,
  leafPaths,
  toggleNode,
  type FieldSlot,
  type PathNode,
  type SourceField,
} from '../model/mapping';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { PathTree } from './PathTree';
import s from './fields.module.css';

const SOURCE_LABEL: Record<SourceField, string> = {
  input: 'input',
  output: 'output',
  expected: 'expected',
  error: 'error',
  metric_metadata: 'metric metadata',
};

interface RowDef {
  id: string;
  label: string;
  mono: boolean;
  slot: FieldSlot;
  tree: PathNode[];
  set: (slot: FieldSlot) => void;
  clearable: boolean;
}

/**
 * Variable mapping: INPUT / EXPECTED / OUTPUT and every `{variable}` of the
 * instructions map to a source field (with a JSON-path picker). The include
 * switches and the metadata picker are in `PromptContents`.
 */
export function FieldsMapping({
  ws,
  bodiesLoading,
  onlyCustom,
  onlyStandard,
  onPickerOpen,
}: {
  ws: RunWorkspace;
  bodiesLoading?: boolean;
  /** Render only the `{variable}` rows (next to the instructions). */
  onlyCustom?: boolean;
  /** Render only INPUT / EXPECTED / OUTPUT (`{variable}` rows sit by the instructions). */
  onlyStandard?: boolean;
  /** Called when a JSON field picker opens: the page then loads the item bodies it needs. */
  onPickerOpen?: () => void;
}) {
  const { settings, update, trees, customVars } = ws;
  const [open, setOpen] = useState<string | null>(null);

  const rows: RowDef[] = [
    ...(onlyCustom
      ? []
      : STD_VARIABLES.map((v) => ({
          id: v.key,
          label: v.label,
          mono: false,
          slot: settings.std[v.key],
          tree: trees.std[v.key] ?? [],
          set: (slot: FieldSlot) => update({ std: { ...settings.std, [v.key]: slot } }),
          clearable: false,
        }))),
    ...(onlyStandard ? [] : customVars).map((name) => ({
      id: `var:${name}`,
      label: `{${name}}`,
      mono: true,
      slot: settings.custom[name] ?? { field: '' as const, full: true, selected: [] },
      tree: trees.custom[name] ?? [],
      set: (slot: FieldSlot) => update({ custom: { ...settings.custom, [name]: slot } }),
      clearable: true,
    })),
  ];

  return (
    <div className={s.stack}>
      {rows.length === 0 && onlyCustom ? null : (
        <div className={s.rows}>
          {rows.map((r) => {
            const isOpen = open === r.id;
            const canPick = r.slot.field !== '' && r.slot.field !== 'metric_metadata';
            const items = [
              ...(r.clearable ? [{ key: '', label: '— select source —' }] : []),
              ...SOURCE_FIELDS.map((f) => ({ key: f, label: SOURCE_LABEL[f] })),
            ];
            const selectedLeaves = new Set(r.slot.selected);
            const summary = r.slot.full
              ? 'Full value'
              : `${r.slot.selected.length} ${r.slot.selected.length === 1 ? 'field' : 'fields'}`;
            return (
              <div key={r.id} className={s.row} data-open={isOpen ? '' : undefined}>
                <div className={s.line}>
                  <Text variant="sm" weight={600} tone="muted" mono={r.mono} className={s.label}>
                    {r.label}
                  </Text>
                  <Icon name="next" size={12} className={s.arrow} aria-hidden="true" />
                  <Select
                    label={`${r.label} source`}
                    hideLabel
                    items={items}
                    value={r.slot.field}
                    onChange={(k) =>
                      r.set({ field: (k ? String(k) : '') as SourceField | '', full: true, selected: [] })
                    }
                    width={170}
                    searchable={false}
                  />
                  {canPick ? (
                    <Button
                      size="sm"
                      aria-expanded={isOpen}
                      onPress={() => {
                        if (!isOpen) onPickerOpen?.();
                        setOpen(isOpen ? null : r.id);
                      }}
                      iconEnd={<Icon name={isOpen ? 'collapse' : 'expand'} size={12} />}
                    >
                      {summary}
                    </Button>
                  ) : null}
                </div>
                {isOpen && canPick ? (
                  <div className={s.picker} role="group" aria-label={`${r.label} fields`}>
                    {r.tree.length === 0 ? (
                      <Text variant="sm" tone="muted" role="status">
                        {bodiesLoading
                          ? 'Reading the first items to discover JSON fields…'
                          : 'This field is not JSON in the first items, so the full value is sent.'}
                      </Text>
                    ) : (
                      <>
                        <Checkbox
                          isSelected={r.slot.full}
                          onChange={(on) =>
                            r.set({ ...r.slot, full: on, selected: on ? [] : leafPaths(r.tree) })
                          }
                        >
                          Use full value
                        </Checkbox>
                        <PathTree
                          nodes={r.tree}
                          selected={selectedLeaves}
                          disabled={r.slot.full}
                          onToggle={(node) => {
                            const next = toggleNode(node, selectedLeaves);
                            r.set({ ...r.slot, full: false, selected: [...next] });
                          }}
                        />
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
