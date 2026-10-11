/**
 * Structured editor of JSON-valued settings (port of experiment_launch_json.js). The descriptor only
 * says "array" / "object" / "json", so the fields are inferred from the value:
 *  - object: one input per key (nested containers recurse), "+ Add key";
 *  - list of scalars: one input per item and an "All" input that sets every item;
 *  - list of objects with the same keys: a table with one row per item and an "All items" row;
 *  - any other list of objects: one card per item under an "All items" block over the scalar keys.
 * Scalars keep their type (numbers stay numbers, booleans use a true/false select); new keys and null
 * values read typed text as JSON when it parses, else as a string. Deeper than MAX_DEPTH, or inside a
 * table cell, a container is edited as JSON text.
 */
import { useId, useState } from 'react';
import { Button } from '@/ui';
import { plural } from '../../lib/format';
import type { JsonObject, JsonValue } from '../model';
import { AddRow } from './AddRow';
import styles from './settings.module.css';

const MAX_DEPTH = 6;

type Path = ReadonlyArray<string | number>;
type Container = JsonObject | JsonValue[];
type Scalar = null | boolean | number | string;
type Kind = 'string' | 'number' | 'boolean' | 'null' | 'auto';

function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
export function isContainerValue(v: unknown): v is Container {
  return v !== null && typeof v === 'object';
}
function isScalar(v: unknown): v is Scalar {
  return !isContainerValue(v);
}
function copy<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
function kindOf(v: JsonValue | undefined): 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as 'object' | 'string' | 'number' | 'boolean';
}
function text(v: JsonValue | undefined): string {
  return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

/** The object or list held by a value (or by its JSON text when `encoding` is 'string'), else null. */
export function containerOf(value: unknown, encoding: 'json' | 'string'): Container | null {
  if (encoding === 'string') {
    if (typeof value !== 'string') return null;
    const t = value.trim();
    if (t[0] !== '{' && t[0] !== '[') return null;
    try {
      const parsed: unknown = JSON.parse(t);
      return isContainerValue(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isContainerValue(value) ? value : null;
}

/** Keys of a non-empty list of objects that all share the same (non-empty) key set. */
export function uniformKeys(list: readonly JsonValue[]): string[] | null {
  if (!list.length || !list.every(isObject)) return null;
  const objs = list as JsonObject[];
  const keys = Object.keys(objs[0] as JsonObject);
  if (!keys.length) return null;
  const sig = keys.slice().sort().join('\u0000');
  return objs.every((o) => Object.keys(o).sort().join('\u0000') === sig) ? keys : null;
}

function parseText(kind: Kind, input: string): { value: JsonValue } | { error: string } {
  if (kind === 'string') return { value: input };
  const trimmed = input.trim();
  if (kind === 'number') {
    if (!trimmed) return { error: 'Enter a number' };
    const num = Number(trimmed);
    return Number.isFinite(num) ? { value: num } : { error: 'Enter a number' };
  }
  if (kind === 'null' && !trimmed) return { value: null };
  if (!trimmed) return { value: '' };
  try {
    return { value: JSON.parse(trimmed) as JsonValue };
  } catch {
    return { value: input };
  }
}

function listKind(values: readonly (JsonValue | undefined)[]): Kind {
  const kinds = values.map(kindOf);
  const first = kinds[0];
  return kinds.every((k) => k === first) && (first === 'string' || first === 'number' || first === 'boolean')
    ? first
    : 'auto';
}
function shared(values: readonly (JsonValue | undefined)[]): { value: JsonValue } | null {
  if (!values.length || values.some((v) => v === undefined)) return null;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? { value: values[0] as JsonValue } : null;
}

/** Mutates `draft` at `path` (empty path replaces the root) and returns the new root. */
function setPath(draft: JsonValue, path: Path, value: JsonValue): JsonValue {
  if (!path.length) return value;
  let node = draft as unknown as Record<string | number, JsonValue>;
  for (const key of path.slice(0, -1)) node = node[key] as unknown as Record<string | number, JsonValue>;
  node[path[path.length - 1] as string | number] = value;
  return draft;
}
function getPath(root: JsonValue, path: Path): JsonValue {
  return path.reduce<JsonValue>(
    (n, k) => (n as unknown as Record<string | number, JsonValue>)[k] as JsonValue,
    root,
  );
}

interface Editor {
  label: string;
  /** Applies `fn` to a copy of the current value and stores the result. */
  edit: (fn: (draft: JsonValue) => JsonValue) => void;
}

const labelFor = (ed: Editor, path: Path) => [ed.label, ...path.map(String)].filter(Boolean).join(' · ');

// ── scalar controls ─────────────────────────────────────────────────────

function ScalarInput({
  kind,
  value,
  label,
  onValue,
  placeholder,
}: {
  kind: Kind;
  value: JsonValue | undefined;
  label: string;
  onValue: (v: JsonValue) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (kind === 'boolean') {
    return (
      <select
        className={styles.control}
        aria-label={label}
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onValue(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      className={styles.control}
      data-mono={kind !== 'string' ? '' : undefined}
      type="text"
      spellCheck={false}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error || undefined}
      placeholder={placeholder ?? (kind === 'null' ? 'null' : undefined)}
      value={draft ?? text(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseText(kind, e.target.value);
        if ('error' in parsed) setError(parsed.error);
        else {
          setError('');
          onValue(parsed.value);
        }
      }}
      onBlur={() => {
        if (!error) setDraft(null);
      }}
    />
  );
}

/** A nested value shown as JSON text (too deep, or inside a table cell). */
function JsonTextControl({
  value,
  label,
  onValue,
}: {
  value: JsonValue;
  label: string;
  onValue: (v: JsonValue) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <textarea
      className={styles.control}
      spellCheck={false}
      rows={2}
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      value={draft ?? JSON.stringify(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        try {
          onValue(JSON.parse(e.target.value) as JsonValue);
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
      onBlur={() => {
        if (!invalid) setDraft(null);
      }}
    />
  );
}

/** "All items": commits on pick / blur / Enter, shows the shared value else "Mixed". */
function AllControl({
  kind,
  common,
  label,
  onApply,
}: {
  kind: Kind;
  common: { value: JsonValue } | null;
  label: string;
  onApply: (v: JsonValue) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (kind === 'boolean') {
    return (
      <select
        className={styles.control}
        aria-label={label}
        value=""
        onChange={(e) => {
          if (e.target.value) onApply(e.target.value === 'true');
        }}
      >
        <option value="">{common ? `Same: ${String(common.value)}` : 'Mixed'}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  const shown = common ? text(common.value) : '';
  const apply = () => {
    if (draft === null || draft === shown) return;
    const parsed = parseText(kind, draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError('');
    setDraft(null);
    onApply(parsed.value);
  };
  return (
    <input
      className={styles.control}
      data-mono={kind !== 'string' ? '' : undefined}
      type="text"
      spellCheck={false}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error || 'A value set here is written into every item'}
      placeholder={common ? undefined : 'Mixed'}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
      }}
    />
  );
}

// ── structure ───────────────────────────────────────────────────────────

function ValueView({
  ed,
  path,
  value,
  depth,
  compact,
}: {
  ed: Editor;
  path: Path;
  value: JsonValue;
  depth: number;
  compact?: boolean;
}) {
  const label = labelFor(ed, path);
  const write = (v: JsonValue) => ed.edit((d) => setPath(d, path, v));
  if (isContainerValue(value)) {
    if (compact || depth >= MAX_DEPTH) return <JsonTextControl value={value} label={label} onValue={write} />;
    return Array.isArray(value) ? (
      <ListView ed={ed} path={path} list={value} depth={depth} />
    ) : (
      <ObjectView ed={ed} path={path} obj={value} depth={depth} />
    );
  }
  return <ScalarInput kind={kindOf(value) as Kind} value={value} label={label} onValue={write} />;
}

function ObjectView({ ed, path, obj, depth }: { ed: Editor; path: Path; obj: JsonObject; depth: number }) {
  const keys = Object.keys(obj);
  return (
    <div className={styles.jsonNested} data-depth={depth}>
      {!keys.length ? <p className={styles.hint}>No keys.</p> : null}
      {keys.map((key) => (
        <div key={key} className={styles.jsonEntry}>
          <div className={styles.jsonKey}>
            <span>{key}</span>
            <span className={styles.spacer} />
            <button
              type="button"
              className={styles.linkBtn}
              aria-label={`Remove ${key} from ${labelFor(ed, path) || 'value'}`}
              onClick={() =>
                ed.edit((d) => {
                  delete (getPath(d, path) as JsonObject)[key];
                  return d;
                })
              }
            >
              Remove
            </button>
          </div>
          <ValueView ed={ed} path={[...path, key]} value={obj[key] as JsonValue} depth={depth + 1} />
        </div>
      ))}
      <AddRow
        placeholder="new key"
        buttonText="+ Add key"
        onAdd={(raw) => {
          const key = raw.trim();
          if (!key) return 'Enter a key.';
          if (Object.prototype.hasOwnProperty.call(obj, key)) return 'Already present.';
          ed.edit((d) => {
            (getPath(d, path) as JsonObject)[key] = null;
            return d;
          });
          return '';
        }}
      />
    </div>
  );
}

function ListView({ ed, path, list, depth }: { ed: Editor; path: Path; list: JsonValue[]; depth: number }) {
  const keys = uniformKeys(list);
  const removeItem = (i: number) => (
    <button
      type="button"
      className={styles.linkBtn}
      aria-label={`Remove item ${i + 1} of ${labelFor(ed, path) || 'list'}`}
      onClick={() =>
        ed.edit((d) => {
          (getPath(d, path) as JsonValue[]).splice(i, 1);
          return d;
        })
      }
    >
      Remove
    </button>
  );
  const applyAll = (key: string | null) => (v: JsonValue) =>
    ed.edit((d) => {
      const items = getPath(d, path) as JsonValue[];
      items.forEach((item, i) => {
        if (key === null) items[i] = copy(v);
        else if (isObject(item)) item[key] = copy(v);
      });
      return d;
    });

  let body: JSX.Element;
  if (keys)
    body = <ListTable ed={ed} path={path} list={list as JsonObject[]} keys={keys} removeItem={removeItem} />;
  else if (list.every(isScalar)) {
    body = (
      <div className={styles.jsonNested}>
        {list.length > 1 ? (
          <div className={styles.jsonItemRow}>
            <span className={styles.allLabel}>All</span>
            <AllControl
              kind={listKind(list)}
              common={shared(list)}
              label={`${labelFor(ed, [...path, '*'])} (all items)`}
              onApply={applyAll(null)}
            />
            <span />
          </div>
        ) : null}
        {list.map((item, i) => (
          <div key={i} className={styles.jsonItemRow}>
            <span className={styles.jsonIndex}>{i + 1}</span>
            <ScalarInput
              kind={kindOf(item) as Kind}
              value={item}
              label={labelFor(ed, [...path, i])}
              onValue={(v) => ed.edit((d) => setPath(d, [...path, i], v))}
            />
            {removeItem(i)}
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className={styles.jsonNested}>
        {list.length > 1 && list.every(isObject) ? (
          <AllFields ed={ed} path={path} list={list as JsonObject[]} applyAll={applyAll} />
        ) : null}
        {list.map((item, i) => (
          <div key={i} className={styles.jsonEntry}>
            <div className={styles.jsonKey}>
              <span>Item {i + 1}</span>
              <span className={styles.spacer} />
              {removeItem(i)}
            </div>
            <ValueView ed={ed} path={[...path, i]} value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.jsonEntry}>
      <span className={styles.hint}>{plural(list.length, 'item')}</span>
      {body}
      <div className={styles.addRow}>
        <Button
          size="sm"
          onPress={() =>
            ed.edit((d) => {
              const items = getPath(d, path) as JsonValue[];
              items.push(items.length ? copy(items[items.length - 1] as JsonValue) : null);
              return d;
            })
          }
        >
          + Add item
        </Button>
      </div>
    </div>
  );
}

/** Objects with different keys: an "All items" block over every scalar key any item has. */
function AllFields({
  ed,
  path,
  list,
  applyAll,
}: {
  ed: Editor;
  path: Path;
  list: JsonObject[];
  applyAll: (key: string | null) => (v: JsonValue) => void;
}) {
  const keys: string[] = [];
  list.forEach((item) => Object.keys(item).forEach((k) => keys.indexOf(k) < 0 && keys.push(k)));
  const scalarKeys = keys.filter((k) => list.every((item) => !(k in item) || isScalar(item[k])));
  if (!scalarKeys.length) return null;
  return (
    <div
      className={styles.jsonNested}
      role="group"
      aria-label={`All items of ${labelFor(ed, path) || 'list'}`}
    >
      <span
        className={styles.allLabel}
        title="A value set here is written into every item (and added where missing)"
      >
        All items
      </span>
      {scalarKeys.map((k) => {
        const values = list.map((item) => item[k]);
        return (
          <div key={k} className={styles.jsonEntry}>
            <div className={styles.jsonKey}>{k}</div>
            <AllControl
              kind={listKind(values.filter((v) => v !== undefined))}
              common={shared(values)}
              label={`${labelFor(ed, [...path, '*', k])} (all items)`}
              onApply={applyAll(k)}
            />
          </div>
        );
      })}
    </div>
  );
}

function ListTable({
  ed,
  path,
  list,
  keys,
  removeItem,
}: {
  ed: Editor;
  path: Path;
  list: JsonObject[];
  keys: string[];
  removeItem: (i: number) => JSX.Element;
}) {
  const id = useId();
  const scalarColumn = (key: string) => list.every((item) => isScalar(item[key]));
  const columnKind = (key: string) => listKind(list.map((item) => item[key]));
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.sr}>{labelFor(ed, path) || 'Items'}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            {keys.map((k) => (
              <th key={k} scope="col" className={styles.labelMono}>
                {k}
              </th>
            ))}
            <th scope="col">
              <span className={styles.sr}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.allRow}>
            <td className={styles.roleName} title="A value set here is written into every item">
              All items
            </td>
            {keys.map((k) => (
              <td key={k}>
                {scalarColumn(k) ? (
                  <AllControl
                    kind={columnKind(k)}
                    common={shared(list.map((item) => item[k]))}
                    label={`${labelFor(ed, [...path, '*', k])} (all items)`}
                    onApply={(v) =>
                      ed.edit((d) => {
                        (getPath(d, path) as JsonObject[]).forEach((item) => {
                          item[k] = copy(v);
                        });
                        return d;
                      })
                    }
                  />
                ) : (
                  <span className={styles.cellDash}>-</span>
                )}
              </td>
            ))}
            <td />
          </tr>
          {list.map((item, i) => (
            <tr key={`${id}-${i}`}>
              <td className={styles.jsonIndex}>{i + 1}</td>
              {keys.map((k) => (
                <td key={k}>
                  <ValueView
                    ed={ed}
                    path={[...path, i, k]}
                    value={item[k] as JsonValue}
                    depth={MAX_DEPTH}
                    compact
                  />
                </td>
              ))}
              <td>{removeItem(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface JsonFieldsProps {
  value: Container;
  label: string;
  /** Applies `fn` to a copy of the current container and stores the result. */
  onEdit: (fn: (draft: JsonValue) => JsonValue) => void;
  /** "Edit as JSON". */
  onRaw: () => void;
  fieldRef?: (el: HTMLElement | null) => void;
}

export function JsonFields({ value, label, onEdit, onRaw, fieldRef }: JsonFieldsProps) {
  const ed: Editor = { label, edit: onEdit };
  return (
    <div ref={fieldRef} className={styles.json} role="group" aria-label={label} tabIndex={-1}>
      <div className={styles.addRow}>
        <span className={styles.hint}>{Array.isArray(value) ? 'List' : 'Object'}</span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.linkBtn}
          title="Edit the whole value as raw JSON"
          aria-label={`Edit ${label} as JSON`}
          onClick={onRaw}
        >
          Edit as JSON
        </button>
      </div>
      <ValueView ed={ed} path={[]} value={value} depth={0} />
    </div>
  );
}
