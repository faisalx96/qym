import { Select, Text, ToggleChips } from '@/ui';
import {
  SOURCE_FIELDS,
  STD_VARIABLES,
  formatPathLabel,
  keyNodes,
  nodeLeaves,
  nodeState,
  type FieldSlot,
  type PathNode,
  type SourceField,
} from '../model/mapping';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import s from './fields.module.css';

const SOURCE_LABEL: Record<SourceField, string> = {
  input: 'input',
  output: 'output',
  expected: 'expected',
  error: 'error',
  metric_metadata: 'metric metadata',
};

/** The "Full value" chip's value: it cannot be a JSON key path (paths never hold a NUL). */
const FULL = '\u0000full';

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
 * The key choice of one mapping row (cv5 K2): "Full value" first, on by default, then one chip for each key. Keys on
 * switch "Full value" off; "Full value" on switches the keys off. At least one chip stays on.
 */
function KeyChips({ row, keys }: { row: RowDef; keys: PathNode[] }) {
  const { slot } = row;
  const selected = new Set(slot.selected);
  const value = slot.full ? [FULL] : keys.filter((k) => nodeState(k, selected) !== 'none').map((k) => k.path);
  return (
    <ToggleChips
      aria-label={`${row.label}: keys to send`}
      size="sm"
      min={1}
      options={[
        { value: FULL, label: 'Full value', title: 'Send the whole value' },
        ...keys.map((k) => ({
          value: k.path,
          label: <span className={s.mono}>{formatPathLabel(k.label)}</span>,
          title: k.children.length ? `${nodeLeaves(k).length} nested fields` : undefined,
        })),
      ]}
      value={value}
      onChange={(next) => {
        if (!slot.full && next.includes(FULL)) {
          row.set({ ...slot, full: true, selected: [] });
          return;
        }
        const on = keys.filter((k) => next.includes(k.path));
        if (!on.length) row.set({ ...slot, full: true, selected: [] });
        else row.set({ ...slot, full: false, selected: on.flatMap((k) => nodeLeaves(k)) });
      }}
    />
  );
}

/**
 * Variable mapping: INPUT / EXPECTED / OUTPUT and every `{variable}` of the instructions map to a source field. A
 * field whose sampled value is a JSON object shows its keys right under the row (cv5 K2), so the person sees at once
 * that it is JSON and what it holds; a single value (text, number) shows the dropdown only. The include switches and
 * the metadata picker are in `PromptContents`.
 */
export function FieldsMapping({
  ws,
  bodiesLoading,
  onlyCustom,
  onlyStandard,
}: {
  ws: RunWorkspace;
  bodiesLoading?: boolean;
  /** Render only the `{variable}` rows (next to the instructions). */
  onlyCustom?: boolean;
  /** Render only INPUT / EXPECTED / OUTPUT (`{variable}` rows sit by the instructions). */
  onlyStandard?: boolean;
}) {
  const { settings, update, trees, customVars } = ws;

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

  if (rows.length === 0 && onlyCustom) return null;
  return (
    <div className={s.rows}>
      {rows.map((r) => {
        const items = [
          ...(r.clearable ? [{ key: '', label: '— select source —' }] : []),
          ...SOURCE_FIELDS.map((f) => ({ key: f, label: SOURCE_LABEL[f] })),
        ];
        const keys = keyNodes(r.tree);
        const emptyMetadata = r.slot.field === 'metric_metadata' && keys.length === 0 && !bodiesLoading;
        return (
          <div key={r.id} className={s.row} data-mapping-row={r.id}>
            <div className={s.line}>
              <Text variant="sm" weight={600} tone="muted" mono={r.mono} className={s.label}>
                {r.label}
              </Text>
              {/* cv5 Y11: no chevron between the label and the dropdown (it read as a link) */}
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
            </div>
            {r.slot.field && keys.length ? (
              <div className={s.keys}>
                <KeyChips row={r} keys={keys} />
              </div>
            ) : emptyMetadata ? (
              <Text variant="sm" tone="muted" as="p" className={s.keys}>
                No metric metadata in the sampled items.
              </Text>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
