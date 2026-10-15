import { useId, useState } from 'react';
import { Button } from '../Button';
import { Collapse } from '../Collapse';
import { CopyButton } from '../CopyButton';
import { Icon } from '../Icon';
import { TextBlock } from '../TextBlock';
import { copyValue } from './structured';
import {
  ARRAY_LIMIT,
  LONG_STRING,
  childEntries,
  collapseBelow,
  expandKey,
  isNested,
  looksSql,
  previewOf,
} from './keyTree';
import styles from './KeyTree.module.css';

export interface KeyTreeProps {
  /** The object or array whose keys are the rows. */
  value: unknown;
  /** Prefix of every open-state path (a pass: `p3`). */
  idPrefix: string;
  /** Open paths (controlled). A key is collapsed unless its path is in the set. */
  open: Set<string>;
  onOpenChange: (next: Set<string>) => void;
  textMode?: 'raw' | 'rendered';
}

/**
 * Key rows (round 3 P5): one row per key, collapsed by default. A row is a button (chevron, key, then a one-line preview
 * while collapsed); open, the preview gives way to the value and a Copy action. Objects and arrays nest the same rows
 * recursively with depth guides; an open nested key shows Expand all / Collapse all for that key only.
 */
export function KeyTree({ value, idPrefix, open, onOpenChange, textMode }: KeyTreeProps) {
  return (
    <div className={styles.tree} role="group" data-keytree="">
      <Rows
        value={value}
        path={idPrefix}
        depth={0}
        open={open}
        onOpenChange={onOpenChange}
        textMode={textMode}
      />
    </div>
  );
}

function Rows({
  value,
  path,
  depth,
  open,
  onOpenChange,
  textMode,
}: {
  value: unknown;
  path: string;
  depth: number;
  open: Set<string>;
  onOpenChange: (next: Set<string>) => void;
  textMode?: 'raw' | 'rendered';
}) {
  const [all, setAll] = useState(false);
  const entries = childEntries(value);
  const shown =
    !all && entries.length >= ARRAY_LIMIT && Array.isArray(value) ? entries.slice(0, ARRAY_LIMIT) : entries;
  return (
    <>
      {shown.map((e) => (
        <KeyRow
          key={e.segment}
          name={e.key}
          value={e.value}
          path={`${path}/${e.segment}`}
          depth={depth}
          open={open}
          onOpenChange={onOpenChange}
          textMode={textMode}
        />
      ))}
      {shown.length < entries.length ? (
        <div className={styles.more}>
          <Button size="sm" variant="ghost" onPress={() => setAll(true)}>
            Show {entries.length - shown.length} more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function KeyRow({
  name,
  value,
  path,
  depth,
  open,
  onOpenChange,
  textMode,
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  open: Set<string>;
  onOpenChange: (next: Set<string>) => void;
  textMode?: 'raw' | 'rendered';
}) {
  const bodyId = useId();
  const nested = isNested(value) && childEntries(value).length > 0;
  const isOpen = open.has(path);
  const toggle = () => {
    const next = new Set(open);
    if (isOpen) next.delete(path);
    else next.add(path);
    onOpenChange(next);
  };
  return (
    <div className={styles.row} data-depth={depth} data-open={isOpen ? '' : undefined}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} className={styles.chevron} />
          <span className={styles.key} dir="ltr">
            {name}
          </span>
          {!isOpen ? (
            <span
              className={nested || isNested(value) ? styles.type : styles.preview}
              dir={nested || isNested(value) ? 'ltr' : 'auto'}
            >
              {previewOf(value)}
            </span>
          ) : nested ? (
            <span className={styles.type} dir="ltr">
              {previewOf(value)}
            </span>
          ) : null}
        </button>
        {isOpen && nested ? (
          <span className={styles.bulk}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Expand all in ${name}`}
              onPress={() => onOpenChange(expandKey(open, value, path))}
            >
              Expand all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Collapse all in ${name}`}
              onPress={() => onOpenChange(collapseBelow(open, value, path))}
            >
              Collapse all
            </Button>
          </span>
        ) : null}
        {isOpen ? <CopyButton text={() => copyValue(value)} label={`Copy ${name}`} /> : null}
      </div>
      <Collapse open={isOpen} id={bodyId}>
        <div className={styles.body}>
          {nested ? (
            <Rows
              value={value}
              path={path}
              depth={depth + 1}
              open={open}
              onOpenChange={onOpenChange}
              textMode={textMode}
            />
          ) : (
            <Leaf name={name} value={value} textMode={textMode} />
          )}
        </div>
      </Collapse>
    </div>
  );
}

function Leaf({ name, value, textMode }: { name: string; value: unknown; textMode?: 'raw' | 'rendered' }) {
  const [full, setFull] = useState(false);
  const text = value === null ? 'null' : value === undefined ? '' : String(value);
  const long = text.length > LONG_STRING;
  const sql = typeof value === 'string' && looksSql(name, text);
  return (
    <div className={styles.leaf}>
      <div
        className={[styles.value, long && !full ? styles.clamped : ''].filter(Boolean).join(' ')}
        data-code={sql ? '' : undefined}
      >
        <TextBlock text={text} mode={textMode} code={sql ? true : undefined} />
      </div>
      {long ? (
        <button type="button" className={styles.showFull} aria-expanded={full} onClick={() => setFull(!full)}>
          {full ? 'Show less' : 'Show full value'}
        </button>
      ) : null}
    </div>
  );
}
