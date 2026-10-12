/** Recursive rendering of the settings tree: leaves, objects (with extra keys), collections, role tables. */
import { useId, useState, type ReactNode } from 'react';
import { Icon, Tag } from '@/ui';
import { plural } from '../../lib/format';
import {
  addKey,
  envName,
  removeKey,
  type CollectionNode,
  type ExtraKeysView,
  type ObjectNode,
  type SettingsNode,
} from '../model';
import { AddRow } from './AddRow';
import { AllItemsControl } from './AllItemsControl';
import { LeafField } from './LeafField';
import { RoleTable } from './RoleTable';
import { useSettingsActions } from './SettingsContext';
import styles from './settings.module.css';

export interface TreeProps {
  /** Messages per field name, joined with newlines. */
  errors: Record<string, string>;
  /** A search / changed-only filter is on: matching items stay open. */
  filtering: boolean;
}

/** Leaves sit in a responsive grid; objects, collections and tables span the row. */
export function NodeList({
  nodes,
  removeList = null,
  ...tree
}: { nodes: readonly SettingsNode[]; removeList?: string | null } & TreeProps) {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (key: string) => {
    if (run.length)
      out.push(
        <div key={key} className={styles.fields}>
          {run}
        </div>,
      );
    run = [];
  };
  for (const node of nodes) {
    if (!node.visible) continue;
    if (node.type === 'leaf') {
      run.push(
        <LeafField
          key={node.pointer}
          node={node}
          error={tree.errors[node.fieldName] ?? ''}
          removeList={removeList}
        />,
      );
    } else {
      flush(`run-${node.pointer}`);
      out.push(<FieldNode key={node.pointer} node={node} {...tree} />);
    }
  }
  flush('run-end');
  return <>{out}</>;
}

export function FieldNode({ node, ...tree }: { node: SettingsNode } & TreeProps) {
  switch (node.type) {
    case 'leaf':
      return <LeafField node={node} error={tree.errors[node.fieldName] ?? ''} />;
    case 'object':
      return <ObjectBlock node={node} {...tree} />;
    case 'collection':
      return <CollectionBlock node={node} {...tree} />;
    case 'role_table':
      return <RoleTable node={node} {...tree} />;
  }
}

function MissingTags({ envs }: { envs: readonly string[] }) {
  const { ctx } = useSettingsActions();
  return (
    <>
      {envs.map((e) => (
        <Tag key={e} tone="warning">{`not in ${envName(ctx, e)}`}</Tag>
      ))}
    </>
  );
}

function ObjectBlock({ node, ...tree }: { node: ObjectNode } & TreeProps) {
  const titleId = useId();
  return (
    <div className={styles.block} role="group" aria-labelledby={titleId} data-field={node.fieldName}>
      <div className={styles.blockHead}>
        <h5 id={titleId} className={styles.blockTitle}>
          {node.title}
        </h5>
        <MissingTags envs={node.missingEnvs} />
      </div>
      <NodeList nodes={node.children} {...tree} />
      {node.extra ? <ExtraKeys extra={node.extra} {...tree} /> : null}
    </div>
  );
}

function ExtraKeys({ extra, ...tree }: { extra: ExtraKeysView } & TreeProps) {
  const { setDoc } = useSettingsActions();
  const existing = [...extra.fixedKeys, ...extra.items.map((i) => i.key)];
  return (
    <div className={styles.field}>
      {extra.items.length ? (
        <NodeList nodes={extra.items.map((i) => i.node)} removeList={extra.listKey} {...tree} />
      ) : null}
      {extra.items.map((item) =>
        item.node.type === 'object' ? (
          <button
            key={item.pointer}
            type="button"
            className={styles.linkBtn}
            aria-label={`Remove ${item.key}`}
            onClick={() => setDoc((d) => removeKey(d, extra.listKey, item.pointer, item.key))}
          >
            {`Remove ${item.key}`}
          </button>
        ) : null,
      )}
      <AddRow
        placeholder="New key"
        buttonText="+ Add key"
        onAdd={(raw) => {
          const key = raw.trim();
          if (!key) return 'Enter a key.';
          if (existing.includes(key)) return 'Already present.';
          setDoc((d) => addKey(d, extra.listKey, key));
          return '';
        }}
      />
    </div>
  );
}

function CollectionBlock({ node, ...tree }: { node: CollectionNode } & TreeProps) {
  const { setDoc } = useSettingsActions();
  const titleId = useId();
  const [closed, setClosed] = useState<Record<string, boolean | undefined>>({});
  const noun = node.keyParam + 's';
  const keys = node.items.map((i) => i.key);
  const visibleItems = node.items.filter((i) => i.visible);
  const pattern = node.keyPattern ? safeRegExp(node.keyPattern) : null;
  return (
    <div className={styles.block} role="group" aria-labelledby={titleId} data-field={node.fieldName}>
      <div className={styles.blockHead}>
        <h5 id={titleId} className={styles.blockTitle}>
          {node.title}
        </h5>
        <Tag kind="count">{plural(node.items.length, node.keyParam)}</Tag>
      </div>
      {node.allItems.length && !tree.filtering ? (
        <div className={[styles.block, styles.allBlock].join(' ')} role="group" aria-label={`All ${noun}`}>
          <div className={styles.blockHead}>
            <h6 className={styles.blockTitle}>{`All ${noun}`}</h6>
          </div>
          <p className={styles.hint}>{`A value set here is written to every ${node.keyParam} below.`}</p>
          <div className={styles.fields}>
            {node.allItems.map((f) => (
              <div key={f.template} className={styles.field}>
                <span className={styles.label}>{f.entry.label || f.entry.name}</span>
                <AllItemsControl field={f} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {visibleItems.map((item) => {
        const open =
          closed[item.key] === undefined ? tree.filtering || node.items.length <= 3 : !closed[item.key];
        const bodyId = `${titleId}-${item.key}`;
        return (
          <div
            key={item.key}
            className={styles.block}
            role="group"
            aria-label={`${node.keyParam} ${item.key}`}
          >
            <div className={styles.blockHead}>
              <button
                type="button"
                className={styles.linkBtn}
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={`${open ? 'Collapse' : 'Expand'} ${node.keyParam} ${item.key}`}
                onClick={() => setClosed((c) => ({ ...c, [item.key]: open }))}
              >
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <h6 className={[styles.blockTitle, styles.blockTitleMono].join(' ')}>{item.key}</h6>
              {item.required ? <Tag kind="role">required</Tag> : null}
              <span className={styles.spacer} />
              {item.removable ? (
                <button
                  type="button"
                  className={styles.linkBtn}
                  aria-label={`Remove ${node.keyParam} ${item.key}`}
                  onClick={() => setDoc((d) => removeKey(d, node.listKey, item.pointer, item.key))}
                >
                  Remove
                </button>
              ) : null}
            </div>
            {open ? (
              <div id={bodyId} className={styles.groupBodyInner}>
                <NodeList nodes={item.children} {...tree} />
              </div>
            ) : null}
          </div>
        );
      })}
      <AddRow
        placeholder={`New ${node.keyParam} name`}
        buttonText={`+ Add ${node.keyParam}`}
        onAdd={(raw) => {
          const key = raw.trim();
          if (!key) return `Enter a ${node.keyParam} name.`;
          if (pattern && !pattern.test(key)) return `A ${node.keyParam} name looks like ${node.keyPattern}.`;
          if (keys.includes(key)) return 'Already present.';
          setDoc((d) => addKey(d, node.listKey, key));
          return '';
        }}
      />
    </div>
  );
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
