import { useMemo, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Button } from '../Button';
import { CopyButton } from '../CopyButton';
import { Dialog } from '../Dialog';
import { Icon } from '../Icon';
import styles from './JsonViewer.module.css';

export function parseJson(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function jsonSummary(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} item${data.length === 1 ? '' : 's'}`;
  if (data && typeof data === 'object') {
    const n = Object.keys(data).length;
    return `${n} key${n === 1 ? '' : 's'}`;
  }
  return typeof data;
}

export function jsonPreview(data: unknown, max = 80): string {
  const text = JSON.stringify(data);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Value({ value }: { value: unknown }) {
  if (value === null) return <span className={styles.null}>null</span>;
  switch (typeof value) {
    case 'string':
      return (
        <span className={styles.string} dir="auto">
          "{value}"
        </span>
      );
    case 'number':
      return <span className={styles.number}>{String(value)}</span>;
    case 'boolean':
      return <span className={styles.boolean}>{String(value)}</span>;
    default:
      return <span className={styles.null}>{String(value)}</span>;
  }
}

interface NodeProps {
  name: string | null;
  value: unknown;
  depth: number;
  expandDepth: number;
  forced?: 'open' | 'closed' | null;
}

function Node({ name, value, depth, expandDepth, forced }: NodeProps) {
  const isObj = value !== null && typeof value === 'object';
  const [local, setLocal] = useState<boolean | null>(null);
  const open = forced === 'open' ? true : forced === 'closed' ? depth === 0 : (local ?? depth < expandDepth);
  const entries = useMemo<[string, unknown][]>(() => {
    if (!isObj) return [];
    return Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
  }, [isObj, value]);
  const label = name === null ? '' : name;
  if (!isObj) {
    return (
      <li role="treeitem" aria-selected={false} className={styles.leaf}>
        {name !== null ? <span className={styles.key}>{label}: </span> : null}
        <Value value={value} />
      </li>
    );
  }
  const bracket = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <li role="treeitem" aria-selected={false} aria-expanded={open} className={styles.branch}>
      <AriaButton className={styles.toggle} aria-label={label || 'root'} onPress={() => setLocal(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </AriaButton>
      {name !== null ? <span className={styles.key}>{label}: </span> : null}
      <span className={styles.punct}>{bracket[0]}</span>
      {!open ? (
        <span className={styles.summary}>
          {jsonSummary(value)}
          <span className={styles.punct}>{bracket[1]}</span>
        </span>
      ) : null}
      {open ? (
        <>
          <ul role="group" className={styles.group}>
            {entries.map(([k, v]) => (
              <Node key={k} name={k} value={v} depth={depth + 1} expandDepth={expandDepth} forced={forced} />
            ))}
          </ul>
          <span className={styles.punct}>{bracket[1]}</span>
        </>
      ) : null}
    </li>
  );
}

export interface JsonTreeProps {
  data: unknown;
  expandDepth?: number;
  label?: string;
}

export function JsonTree({ data, expandDepth = 2, label = 'JSON' }: JsonTreeProps) {
  const [forced, setForced] = useState<'open' | 'closed' | null>(null);
  const [gen, setGen] = useState(0);
  return (
    <div className={styles.tree}>
      <div className={styles.toolbar}>
        <Button
          variant="ghost"
          onPress={() => {
            setForced('open');
            setGen((g) => g + 1);
          }}
        >
          Expand all
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setForced('closed');
            setGen((g) => g + 1);
          }}
        >
          Collapse all
        </Button>
        <CopyButton text={() => JSON.stringify(data, null, 2)} label="Copy JSON" />
      </div>
      <ul role="tree" aria-label={label} className={styles.root} key={gen}>
        <Node name={null} value={data} depth={0} expandDepth={expandDepth} forced={forced} />
      </ul>
    </div>
  );
}

export interface JsonDialogProps {
  value: unknown;
  title: string;
  open: boolean;
  onClose: () => void;
  expandDepth?: number;
}

export function JsonDialog({ value, title, open, onClose, expandDepth }: JsonDialogProps) {
  const data = useMemo(() => parseJson(value) ?? value, [value]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} size="data">
      <JsonTree data={data} expandDepth={expandDepth} label={title} />
    </Dialog>
  );
}

export interface JsonPreviewProps {
  value: unknown;
  title?: string;
  className?: string;
  /** Compact: summary only. */
  compact?: boolean;
  children?: ReactNode;
}

/** Preview button → JsonDialog. Label: "View <title> as JSON (<n> keys)". */
export function JsonPreview({ value, title = 'value', className, compact, children }: JsonPreviewProps) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => parseJson(value), [value]);
  if (data === null) return <span className={styles.plain}>{String(value ?? '')}</span>;
  return (
    <>
      <AriaButton
        className={[styles.preview, className].filter(Boolean).join(' ')}
        aria-haspopup="dialog"
        aria-label={`View ${title} as JSON (${jsonSummary(data)})`}
        onPress={() => setOpen(true)}
        data-compact={compact ? '' : undefined}
      >
        {children ?? (compact ? jsonSummary(data) : jsonPreview(data))}
      </AriaButton>
      <JsonDialog value={data} title={title} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
