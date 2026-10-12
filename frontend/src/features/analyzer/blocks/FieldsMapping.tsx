import { useState } from 'react';
import { Button, Checkbox, Icon, Select, Switch, Text } from '@/ui';
import {
  SOURCE_FIELDS,
  STD_VARIABLES,
  leafPaths,
  metadataKey,
  nodeLeaves,
  pathsToTree,
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
 * instructions map to a source field (with a JSON-path picker), plus the
 * Error / Scores / Metric metadata include toggles and the metadata picker.
 */
export function FieldsMapping({
  ws,
  bodiesLoading,
  onlyCustom,
}: {
  ws: RunWorkspace;
  bodiesLoading?: boolean;
  /** Render only the `{variable}` rows (next to the instructions). */
  onlyCustom?: boolean;
}) {
  const { settings, update, trees, customVars } = ws;
  const [open, setOpen] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);

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
    ...customVars.map((name) => ({
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
                      onPress={() => setOpen(isOpen ? null : r.id)}
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

      {onlyCustom ? null : (
        <>
          <div className={s.includeRow} role="group" aria-label="Include in prompt">
            <Text variant="sm" weight={600} tone="muted">
              Include in prompt
            </Text>
            <Switch isSelected={settings.includeError} onChange={(v) => update({ includeError: v })}>
              Error
            </Switch>
            <Switch isSelected={settings.includeScores} onChange={(v) => update({ includeScores: v })}>
              Scores
            </Switch>
            <Switch isSelected={settings.includeMetadata} onChange={(v) => update({ includeMetadata: v })}>
              Metric metadata
            </Switch>
            {trees.metadata.length ? (
              <Button
                size="sm"
                isDisabled={!settings.includeMetadata}
                aria-expanded={metaOpen}
                onPress={() => setMetaOpen((o) => !o)}
                iconEnd={<Icon name={metaOpen ? 'collapse' : 'expand'} size={12} />}
              >
                {settings.metaDeselected.length ? 'Choose metadata (custom)' : 'Choose metadata (all)'}
              </Button>
            ) : null}
          </div>
          {metaOpen && settings.includeMetadata ? <MetadataPicker ws={ws} /> : null}
        </>
      )}
    </div>
  );
}

function MetadataPicker({ ws }: { ws: RunWorkspace }) {
  const { settings, update, trees } = ws;
  const off = new Set(settings.metaDeselected);
  return (
    <div className={s.picker} role="group" aria-label="Metric metadata fields">
      {trees.metadata.map((group) => {
        const tree = pathsToTree(group.paths);
        const selected = new Set(leafPaths(tree).filter((l) => !off.has(metadataKey(group.metric, l))));
        return (
          <div key={group.metric} className={s.metaGroup}>
            <Text variant="md" weight={600} mono>
              {group.metric}
            </Text>
            <PathTree
              nodes={tree}
              selected={selected}
              onToggle={(node) => {
                const leaves = nodeLeaves(node).map((l) => metadataKey(group.metric, l));
                const allOn = leaves.every((k) => !off.has(k));
                const next = new Set(off);
                leaves.forEach((k) => (allOn ? next.add(k) : next.delete(k)));
                update({ metaDeselected: [...next] });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
