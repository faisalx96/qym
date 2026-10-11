import { JsonConfigEditor } from './JsonConfigEditor';
import styles from './raw.module.css';

/** A JSON document shown read-only (the preset version "Config document" view). */
export function ReadOnlyJson({ value, label = 'Config document' }: { value: unknown; label?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className={styles.readonly}>
      <JsonConfigEditor value={text} readOnly label={label} lint={false} />
    </div>
  );
}
