/**
 * A flat keyed collection (the endpoints) as an override table, like the role overrides: a global
 * "All <items>" row over one row per element, one column per field. Same document model: cells are
 * the item's leaf fields, the global row writes one value to every element (`setAllInput`).
 */
import { useId } from 'react';
import { Tag } from '@/ui';
import { plural } from '../../lib/format';
import { addKey, removeKey, type CollectionNode, type CollectionTableModel } from '../model';
import { AddRow } from './AddRow';
import { AllItemsControl } from './AllItemsControl';
import type { TreeProps } from './FieldNode';
import { LeafField } from './LeafField';
import { useSettingsActions } from './SettingsContext';
import styles from './settings.module.css';

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
