/** Read-only preview of the launch form generated from an environment's schema. */
import type { CSSProperties, ReactNode } from 'react';
import type { DescriptorEntry, FormDescriptor } from '@/api/evalEnvironments';
import { Tag } from '@/ui';
import { countFields } from './slotLogic';
import styles from './FormPreview.module.css';

function tagsFor(entry: DescriptorEntry) {
  const kind = entry.kind === 'collection' ? 'map' : entry.kind === 'role_table' ? 'role table' : entry.widget || entry.type;
  return (
    <>
      {kind ? <Tag kind="data">{kind}</Tag> : null}
      {entry.required ? <Tag>Required</Tag> : null}
      {entry.secret ? <Tag tone="warning">Secret</Tag> : null}
      {entry.sweepable ? <Tag kind="accent">Sweepable</Tag> : null}
    </>
  );
}

function FieldRow({ fields, pointer, depth, seen }: { fields: Record<string, DescriptorEntry>; pointer: string; depth: number; seen: Set<string> }) {
  const entry = fields[pointer];
  if (!entry || seen.has(pointer) || depth > 8) return null;
  seen.add(pointer);
  const name = entry.kind === 'role_table' ? `{${entry.row_param || 'role'}}` : entry.name;
  const label = entry.label && entry.label !== entry.name ? entry.label : '';
  const bounds = Object.entries(entry.bounds ?? {}).map(([k, v]) => `${k} ${String(v)}`).join(', ');
  const extras: ReactNode[] = [];
  if (Array.isArray(entry.enum) && entry.enum.length) {
    extras.push(
      <span key="enum">
        Options <span className={styles.mono}>{entry.enum.map((v) => JSON.stringify(v)).join(', ')}</span>
      </span>,
    );
  }
  if (bounds) extras.push(<span key="bounds" className={styles.mono}>{bounds}</span>);
  if (entry.kind === 'collection') {
    const required = (entry.required_keys ?? []).join(', ');
    extras.push(
      <span key="coll">
        Keys are added per experiment{required ? '; required ' : ''}
        {required ? <span className={styles.mono}>{required}</span> : null}
      </span>,
    );
  }
  if (entry.kind === 'role_table') {
    extras.push(
      <span key="roles">
        Roles <span className={styles.mono}>{(entry.rows ?? []).map((r) => r.key).join(', ')}</span>
      </span>,
    );
  }
  if (entry.hints?.text) extras.push(<span key="hint">{entry.hints.text}</span>);
  const children: ReactNode[] = [];
  for (const child of entry.children ?? []) {
    const childEntry = fields[child];
    // A collection's templated item is a plain wrapper: show its fields directly.
    if (entry.kind === 'collection' && childEntry?.kind === 'object') {
      seen.add(child);
      for (const grand of childEntry.children ?? []) {
        children.push(<FieldRow key={grand} fields={fields} pointer={grand} depth={depth + 1} seen={seen} />);
      }
    } else {
      children.push(<FieldRow key={child} fields={fields} pointer={child} depth={depth + 1} seen={seen} />);
    }
  }
  return (
    <>
      <div className={styles.field} style={{ '--depth': depth } as CSSProperties}>
        <div className={styles.fieldMain}>
          <span className={styles.name} title={pointer}>
            {name}
          </span>
          {label ? <span className={styles.label}>{label}</span> : null}
          {entry.description ? <span className={styles.desc}>{entry.description}</span> : null}
          {extras.length ? (
            <span className={styles.extra}>
              {extras.map((e, i) => (
                <span key={i}>
                  {i ? ' · ' : ''}
                  {e}
                </span>
              ))}
            </span>
          ) : null}
          {entry.kind === 'field' ? (
            <span className={styles.default}>
              {entry.secret ? (
                'Default hidden'
              ) : entry.has_default ? (
                <>
                  Default <span className={styles.mono}>{JSON.stringify(entry.default)}</span>
                </>
              ) : (
                'Inherited from environment'
              )}
            </span>
          ) : null}
        </div>
        <div className={styles.tags}>{tagsFor(entry)}</div>
      </div>
      {children}
    </>
  );
}

function countIn(fields: Record<string, DescriptorEntry>, pointers: string[]): number {
  const guard = new Set<string>();
  let count = 0;
  const walk = (p: string) => {
    const e = fields[p];
    if (!e || guard.has(p)) return;
    guard.add(p);
    if (e.kind === 'field') count += 1;
    (e.children ?? []).forEach(walk);
  };
  pointers.forEach(walk);
  return count;
}

export function FormPreview({ descriptor }: { descriptor: FormDescriptor }) {
  const fields = descriptor.fields ?? {};
  const groups = descriptor.groups ?? [];
  const warnings = descriptor.warnings ?? [];
  const seen = new Set<string>();
  return (
    <div className={styles.preview}>
      <div className={styles.summary}>
        <span className={styles.count}>{countFields(descriptor)} settings</span>
        <span className={styles.meta}>in {groups.length} groups · read-only preview of the launch form</span>
      </div>
      {warnings.length ? (
        <div className={styles.warnings} role="note">
          <strong>{warnings.length} schema warning(s).</strong> These settings are edited as raw JSON:
          <ul>
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>
                <span className={styles.mono}>{w.pointer || '/'}</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {groups.length ? (
        groups.map((group, i) => (
          <details key={group.id} className={styles.group} open={i === 0}>
            <summary className={styles.groupHeader}>
              <span>{group.label}</span>
              <Tag kind="count" title="Settings in this group">
                {countIn(fields, group.pointers)}
              </Tag>
            </summary>
            <div className={styles.groupBody}>
              {group.pointers.map((p) => (
                <FieldRow key={p} fields={fields} pointer={p} depth={0} seen={seen} />
              ))}
            </div>
          </details>
        ))
      ) : (
        <div className={styles.empty}>The schema has no settings.</div>
      )}
    </div>
  );
}
