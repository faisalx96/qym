import { Tag, Text, Textarea } from '@/ui';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { FieldsMapping } from './FieldsMapping';
import s from './blocks.module.css';

const MAX = 20_000;

/** Additional instructions; `{var}` tokens grow one mapping row each (reserved: {categories}). */
export function Instructions({ ws, bodiesLoading }: { ws: RunWorkspace; bodiesLoading?: boolean }) {
  const { settings, update, customVars } = ws;
  return (
    <div className={s.stack}>
      <Textarea
        label="Additional instructions"
        hideLabel
        rows={4}
        maxLength={MAX}
        value={settings.instructions}
        onChange={(v) => update({ instructions: v })}
        placeholder="e.g. Pay special attention to the {rubric} criteria."
        help={
          <>
            Reference item data with <code className={s.code}>{'{variable_name}'}</code>; each variable gets a
            mapping row. <code className={s.code}>{'{categories}'}</code> is reserved.
          </>
        }
      />
      {customVars.length ? (
        <div className={s.stack} aria-label="Detected variables">
          <div className={s.inline}>
            {customVars.map((v) => (
              <Tag key={v} kind="data">{`{${v}}`}</Tag>
            ))}
            <Text variant="sm" tone="muted" as="span">
              Choose where each variable reads from.
            </Text>
          </div>
          <FieldsMapping ws={ws} bodiesLoading={bodiesLoading} onlyCustom />
        </div>
      ) : null}
    </div>
  );
}
