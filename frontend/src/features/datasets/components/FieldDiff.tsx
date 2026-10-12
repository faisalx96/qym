/** Before/after panes for one field with word-level highlights (compare + item history). */
import { useMemo } from 'react';
import { textDirAttrs } from '@/lib/text';
import { Text } from '@/ui';
import { storedType } from '../lib/itemValue';
import { diffSide, diffText, wordDiff } from '../lib/wordDiff';
import styles from './FieldDiff.module.css';

export interface FieldDiffProps {
  field: string;
  before: unknown;
  after: unknown;
  /** Only one side exists (created / deleted). */
  onlyAfter?: boolean;
  onlyBefore?: boolean;
}

export function FieldDiff({ field, before, after, onlyAfter, onlyBefore }: FieldDiffProps) {
  const a = diffText(before);
  const b = diffText(after);
  const typeChanged = !onlyAfter && !onlyBefore && storedType(before) !== storedType(after);
  const ops = useMemo(() => (onlyAfter || onlyBefore ? null : wordDiff(a, b)), [a, b, onlyAfter, onlyBefore]);
  const tooLarge = !onlyAfter && !onlyBefore && ops === null;
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <span className={styles.fieldName}>{field}</span>
        {typeChanged ? (
          <Text as="span" variant="sm" tone="warning">
            type changed: {storedType(before)} → {storedType(after)}
          </Text>
        ) : null}
        {tooLarge ? (
          <Text as="span" variant="sm" tone="muted">
            too large to highlight
          </Text>
        ) : null}
      </div>
      <div className={styles.panes} data-single={onlyAfter || onlyBefore ? '' : undefined}>
        {!onlyAfter ? (
          <Pane label="before" text={a} ops={ops ? diffSide(ops, 'before') : null} tone="before" />
        ) : null}
        {!onlyBefore ? (
          <Pane label="after" text={b} ops={ops ? diffSide(ops, 'after') : null} tone="after" />
        ) : null}
      </div>
    </div>
  );
}

function Pane({
  label,
  text,
  ops,
  tone,
}: {
  label: string;
  text: string;
  ops: ReturnType<typeof diffSide> | null;
  tone: 'before' | 'after';
}) {
  const dir = textDirAttrs(text);
  return (
    <div className={styles.pane} data-tone={tone}>
      <span className={styles.paneLabel}>{label}</span>
      <pre className={styles.pre} {...dir}>
        {ops
          ? ops.map((op, i) =>
              op.kind === 'same' ? (
                op.text
              ) : (
                <mark key={i} className={op.kind === 'add' ? styles.added : styles.removed}>
                  {op.text}
                </mark>
              ),
            )
          : text || <span className={styles.empty}>(empty)</span>}
      </pre>
    </div>
  );
}
