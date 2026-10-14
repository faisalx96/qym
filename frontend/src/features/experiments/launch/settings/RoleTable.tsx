/** A role table as the "Role overrides" card: search, "Overridden only", "Reset roles", an "All roles" row. */
import { useId, useState } from 'react';
import { Button, Checkbox, Tag } from '@/ui';
import { plural } from '../../lib/format';
import {
  addKey,
  removeKey,
  type CollectionNode,
  type CollectionTableModel,
  envName,
  has,
  isSweepValue,
  resetRoles,
  sameValue,
  type AllItemsField,
  type RoleTableNode,
} from '../model';
import { useLaunch } from '../LaunchContext';
import { AddRow } from './AddRow';
import { AllItemsControl } from './AllItemsControl';
import { LeafField } from './LeafField';
import { useSettingsActions } from './SettingsContext';
import type { TreeProps } from './FieldNode';
import styles from './settings.module.css';

export function RoleTable({ node, errors }: { node: RoleTableNode } & TreeProps) {
  const titleId = useId();
  const { ctx, setDoc } = useSettingsActions();
  const { doc } = useLaunch();
  const [query, setQuery] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const noun = node.rowParam;
  const q = query.trim().toLowerCase();
  const base = node.rows.filter((r) => r.visible);
  const rows = base.filter(
    (r) =>
      (!q || `${r.key} ${r.label} ${r.description ?? ''}`.toLowerCase().includes(q)) &&
      (!overriddenOnly || r.overridden),
  );
  const narrowed = rows.length !== base.length;
  const overridden = node.rows.filter((r) => r.overridden).length;
  const rowPrefixes = rows.map((r) => r.pointer + '/');

  /** The All row's field for the shown rows (recomputed when a local filter hides some). */
  const allFor = (field: AllItemsField | null) => {
    if (!field) return null;
    if (!narrowed) return { field };
    const pointers = field.pointers.filter((p) => rowPrefixes.some((pre) => p.startsWith(pre)));
    const first = pointers[0];
    const same =
      pointers.length > 0 &&
      pointers.every((p) => sameValue(doc.values[p], doc.values[first as string])) &&
      !pointers.some((p) => has(doc.invalid, p) || isSweepValue(doc.values[p]));
    return { field, pointers, same, value: same ? doc.values[first as string] : undefined };
  };

  return (
    <div className={styles.block} role="group" aria-labelledby={titleId} data-field={node.fieldName}>
      <div className={styles.blockHead}>
        <h5 id={titleId} className={styles.blockTitle}>
          Role overrides
        </h5>
        <Tag kind="count" tone={overridden ? 'info' : undefined}>
          {`${overridden} of ${node.rows.length} overridden`}
        </Tag>
      </div>
      <div className={styles.addRow}>
        <input
          className={[styles.control, styles.addInput].join(' ')}
          type="search"
          aria-label={`Search ${noun}s`}
          placeholder={`Search ${noun}s`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Checkbox isSelected={overriddenOnly} onChange={setOverriddenOnly}>
          Overridden only
        </Checkbox>
        <span className={styles.spacer} />
        <Button
          size="sm"
          isDisabled={!rows.some((r) => r.overridden)}
          onPress={() =>
            setDoc((d) =>
              resetRoles(
                d,
                rows.map((r) => r.pointer),
              ),
            )
          }
        >
          {`Reset ${noun}s`}
        </Button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.sr}>{`${noun} overrides`}</caption>
          <thead>
            <tr>
              <th scope="col">{noun[0]?.toUpperCase() + noun.slice(1)}</th>
              {node.columns.map((c) => (
                <th key={c.template} scope="col" className={styles.labelMono}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 1 || (!narrowed && rows.length) ? (
              <tr className={styles.allRow}>
                <th
                  scope="row"
                  className={styles.roleName}
                  title={`A value set here is written to every ${noun} shown`}
                >
                  {`All ${noun}s`}
                </th>
                {node.allRow.map((field, i) => {
                  const all = allFor(field);
                  return (
                    <td key={node.columns[i]?.template ?? i}>
                      {all ? (
                        <AllItemsControl
                          field={all.field}
                          pointers={'pointers' in all ? all.pointers : undefined}
                          same={'same' in all ? all.same : undefined}
                          value={'value' in all ? all.value : undefined}
                        />
                      ) : (
                        <span className={styles.cellDash}>-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.key} data-changed={row.changed ? '' : undefined}>
                <th scope="row" className={styles.roleName} title={row.description ?? undefined}>
                  <span className={styles.roleNameInner}>
                    <span>{row.label}</span>
                    {row.changed ? (
                      <>
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.sr}>changed</span>
                      </>
                    ) : null}
                    {row.absentEnvs.map((e) => (
                      <Tag key={e} tone="warning">{`not in ${envName(ctx, e)}`}</Tag>
                    ))}
                  </span>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.pointer}>
                    <LeafField node={cell} error={errors[cell.fieldName] ?? ''} variant="cell" />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={node.columns.length + 1} className={styles.empty}>
                  {`No ${noun}s match.`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A flat keyed collection (the endpoints) as an override table, like the role overrides: a global
 * "All <items>" row over one row per element, one column per field. Same document model.
 * (Lives here: it is the other form table of the settings tree.)
 */
function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export function CollectionTable({
  node,
  model,
  errors,
}: { node: CollectionNode; model: CollectionTableModel } & TreeProps) {
  const titleId = useId();
  const { setDoc } = useSettingsActions();
  const noun = node.keyParam;
  const nouns = noun + 's';
  const keys = node.items.map((i) => i.key);
  const pattern = node.keyPattern ? safeRegExp(node.keyPattern) : null;
  const rows = model.rows.filter((r) => r.item.visible);
  const hasAll = model.allRow.some(Boolean);
  const removable = rows.some((r) => r.item.removable);
  return (
    <div className={styles.block} role="group" aria-labelledby={titleId} data-field={node.fieldName}>
      <div className={styles.blockHead}>
        <h5 id={titleId} className={styles.blockTitle}>
          {node.title}
        </h5>
        <Tag kind="count">{plural(node.items.length, noun)}</Tag>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.sr}>{`${noun} overrides`}</caption>
          <thead>
            <tr>
              <th scope="col">{noun[0]?.toUpperCase() + noun.slice(1)}</th>
              {model.columns.map((c) => (
                <th key={c.template} scope="col" className={styles.labelMono}>
                  {c.label}
                </th>
              ))}
              {removable ? (
                <th scope="col">
                  <span className={styles.sr}>Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {hasAll ? (
              <tr className={styles.allRow}>
                <th
                  scope="row"
                  className={styles.roleName}
                  title={`A value set here is written to every ${noun}`}
                >
                  {`All ${nouns}`}
                </th>
                {model.allRow.map((field, i) => (
                  <td key={model.columns[i]?.template ?? i}>
                    {field ? <AllItemsControl field={field} /> : <span className={styles.cellDash}>-</span>}
                  </td>
                ))}
                {removable ? <td /> : null}
              </tr>
            ) : null}
            {rows.map(({ item, cells }) => (
              <tr key={item.key} data-field={item.fieldName}>
                <th scope="row" className={styles.roleName}>
                  <span className={styles.roleNameInner}>
                    <span>{item.key}</span>
                    {cells.some((c) => c.changed) ? (
                      <>
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.sr}>changed</span>
                      </>
                    ) : null}
                  </span>
                </th>
                {cells.map((cell) => (
                  <td key={cell.pointer}>
                    <LeafField node={cell} error={errors[cell.fieldName] ?? ''} variant="cell" />
                  </td>
                ))}
                {removable ? (
                  <td>
                    {item.removable ? (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        aria-label={`Remove ${item.key}`}
                        onClick={() => setDoc((d) => removeKey(d, node.listKey, item.pointer, item.key))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddRow
        placeholder={`New ${noun} name`}
        buttonText={`+ Add ${noun}`}
        onAdd={(raw) => {
          const key = raw.trim();
          if (!key) return `Enter a ${noun} name.`;
          if (pattern && !pattern.test(key)) return `A ${noun} name looks like ${node.keyPattern}.`;
          if (keys.includes(key)) return 'Already present.';
          setDoc((d) => addKey(d, node.listKey, key));
          return '';
        }}
      />
    </div>
  );
}
