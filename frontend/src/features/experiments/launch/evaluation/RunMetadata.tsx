import { Button, IconButton, TextField } from '@/ui';
import { useLaunch } from '../LaunchContext';
import {
  addMetaRow,
  baseMeta,
  isReservedKey,
  metadataState,
  METADATA_POINTER,
  metadataText,
  metaRowsOf,
  pointerToFieldName,
  removeMetaRow,
  reservedPrefix,
  updateMetaRow,
} from '../model';
import styles from './evaluation.module.css';

const rowPointer = (key: string) =>
  key.trim()
    ? METADATA_POINTER + '/' + key.trim().replace(/~/g, '~0').replace(/\//g, '~1')
    : METADATA_POINTER;

/** Run metadata: free key/value rows sent with the run; `qym_*` keys belong to the platform. */
export function RunMetadata() {
  const { doc, ctx, setDoc, registerField } = useLaunch();
  const panel = ctx.evaluatorPanel;
  const rows = metaRowsOf(doc, panel);
  const state = metadataState(doc, panel);
  const prefix = reservedPrefix(panel);
  const reserved = Object.entries(baseMeta(doc)).filter(([k]) => isReservedKey(k, prefix));
  return (
    <section
      className={styles.panel}
      aria-label="Run metadata"
      ref={(el) => registerField(pointerToFieldName(METADATA_POINTER), el)}
    >
      <h4 className={styles.panelTitle}>Run metadata</h4>
      <p className={styles.hint}>
        Key/value pairs stored on every run (for example a ticket or a branch). Values are read as JSON when
        they parse, otherwise as text. Keys starting with {prefix} are reserved for the platform.
      </p>
      {reserved.map(([k, v]) => (
        <div key={k} className={styles.readonlyRow} data-reserved-key={k}>
          <span className={styles.mono}>{k}</span>
          <span className={styles.mono}>{metadataText(v)}</span>
          <span className={styles.hint}>set by the platform, read-only</span>
        </div>
      ))}
      {rows.map((row, i) => {
        const error = state.rowErrors[row.id];
        return (
          <div
            key={row.id}
            data-meta-row={row.id}
            ref={(el) => {
              if (error) registerField(pointerToFieldName(rowPointer(row.key)), el);
            }}
          >
            <div className={styles.row}>
              <TextField
                className={styles.grow}
                label={`Metadata key ${i + 1}`}
                mono
                placeholder="key"
                value={row.key}
                onChange={(key) => setDoc((d) => updateMetaRow(d, row.id, { key }, panel))}
                isInvalid={Boolean(error)}
              />
              <TextField
                className={styles.grow}
                label={`Metadata value ${i + 1}`}
                mono
                placeholder="value"
                value={row.raw}
                onChange={(raw) => setDoc((d) => updateMetaRow(d, row.id, { raw }, panel))}
                isInvalid={Boolean(error)}
              />
              <IconButton
                label={`Remove metadata key ${row.key || i + 1}`}
                icon="trash"
                tone="danger"
                onPress={() => setDoc((d) => removeMetaRow(d, row.id, panel))}
              />
            </div>
            {error ? (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className={styles.row}>
        <Button variant="neutral" onPress={() => setDoc((d) => addMetaRow(d, panel))}>
          Add key
        </Button>
      </div>
    </section>
  );
}
