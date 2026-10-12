import { useEffect, useRef } from 'react';
import { Button, Tag } from '@/ui';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { PSEUDO, pointerToFieldName } from '../model';
import type { EditorHandle } from '../raw/CodeMirrorEditor';
import { JsonConfigEditor } from '../raw/JsonConfigEditor';
import styles from '../raw/raw.module.css';

const STATUS_TEXT = {
  'in-sync': 'In sync with the form',
  unapplied: 'Unapplied edits. Apply them to update the form, or revert to the form’s values.',
  errors: 'Not applied: fix these first.',
} as const;

/**
 * Raw JSON: the whole configuration as text. Typing never changes the form; Apply validates
 * everything first (unknown keys, literal API keys, bad values) and only then updates the fields.
 * The launch bar's Raw JSON button opens, scrolls to and focuses this editor.
 */
export function RawJsonSection() {
  const { raw, registerField, sectionState } = useLaunch();
  const editor = useRef<EditorHandle>(null);
  const open = sectionState.open.raw;
  const name = pointerToFieldName(PSEUDO.rawJson);
  // The registered element is a focus target that forwards to the editor (CodeMirror's content is
  // not a native control).
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!open || !el) return undefined;
    el.focus = () => editor.current?.focus();
    registerField(name, el);
    return () => registerField(name, null);
  }, [open, registerField, name]);
  const { status } = raw;
  const errors = raw.state.errors;
  const badge =
    status === 'in-sync' ? (
      <Tag kind="count">in sync</Tag>
    ) : status === 'unapplied' ? (
      <Tag kind="count" tone="warning">
        unapplied
      </Tag>
    ) : null;
  return (
    <LaunchSection
      id="raw"
      description="The whole configuration as JSON. Edit it here, then Apply to update the form."
      badge={badge}
    >
      <div className={styles.stack}>
        <div className={styles.status} role="status" aria-live="polite" data-raw-status={status}>
          <div className={styles.statusRow}>
            <span>{STATUS_TEXT[status]}</span>
          </div>
          {errors.length ? (
            <ul className={styles.errors} aria-label="Raw JSON errors">
              {errors.map((e, i) => (
                <li key={`${e.pointer}|${i}`}>
                  {e.message}
                  {e.pointer ? (
                    <>
                      {' '}
                      <span className={styles.pointer} dir="ltr">
                        {e.pointer}
                      </span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div ref={host} tabIndex={-1}>
          <JsonConfigEditor
            ref={editor}
            label="Raw JSON"
            value={raw.state.text}
            onChange={raw.edit}
            invalid={status === 'errors'}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="neutral" isDisabled={status === 'in-sync'} onPress={raw.revert}>
            Revert to form
          </Button>
          <Button variant="accent" isDisabled={status === 'in-sync'} onPress={() => raw.apply(true)}>
            Apply
          </Button>
        </div>
      </div>
    </LaunchSection>
  );
}
