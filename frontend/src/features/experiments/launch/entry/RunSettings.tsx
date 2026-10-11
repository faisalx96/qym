import { useMemo } from 'react';
import { Select, TextField, Textarea } from '@/ui';
import {
  highWarnings,
  NAME_MAX,
  priorityOptions,
  PRIORITY_ORDER,
  PSEUDO,
  pointerToFieldName,
  type Priority,
} from '../model';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import styles from './entry.module.css';

const DEFAULT = '__default';

/** Name, priority and versioning details. The name input keeps its identity so focus survives every edit. */
export function RunSettings() {
  const { doc, setDoc, ctx, preview, registerField, readOnly } = useLaunch();
  const options = useMemo(() => priorityOptions(ctx), [ctx]);
  const high =
    doc.priority === 'HIGH' ||
    (doc.priority === '' &&
      ctx.envs.some((e) => (e.defaultPriority ? PRIORITY_ORDER[e.defaultPriority] === 2 : false)));
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <TextField
          ref={(el) => registerField(pointerToFieldName(PSEUDO.name), el)}
          label="Experiment name"
          value={doc.name}
          maxLength={NAME_MAX}
          isDisabled={readOnly}
          onChange={(name) => setDoc((d) => ({ ...d, name }))}
        />
        <div ref={(el) => registerField('launch-priority', el)}>
          <Select
            label="Priority"
            items={options.map((o) => ({ key: o.value || DEFAULT, label: o.label, disabled: o.disabled }))}
            value={doc.priority || DEFAULT}
            isDisabled={readOnly}
            onChange={(key) =>
              key != null &&
              setDoc((d) => ({ ...d, priority: (key === DEFAULT ? '' : String(key)) as Priority | '' }))
            }
          />
        </div>
      </div>
      <div ref={(el) => registerField(pointerToFieldName(PSEUDO.versioning), el)}>
        <Textarea
          label="Versioning details"
          rows={2}
          mono
          dir="ltr"
          value={doc.versioningText}
          isDisabled={readOnly}
          onChange={(versioningText) => setDoc((d) => ({ ...d, versioningText }))}
          help="One key=value per line (for example agent_version=1.4). Stored on the experiment and its runs."
        />
      </div>
      {high ? (
        <Callout tone="warning" title="HIGH priority preempts other jobs">
          {highWarnings(ctx, preview.data).join(' ')}
        </Callout>
      ) : null}
    </div>
  );
}
