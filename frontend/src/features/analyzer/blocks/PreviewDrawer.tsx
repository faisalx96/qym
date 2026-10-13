import { Drawer, Select, Switch, Text } from '@/ui';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { PromptPreview } from './PromptPreview';
import s from './blocks.module.css';

/**
 * Prompt preview in a right drawer (opened from the action rail or a target row, `?preview=1`):
 * previewed-target select, the three context switches, then the messages in the drawer's single
 * scroller. The field mapping is edited on the page; the drawer shows what is sent, read-only.
 */
export function PreviewDrawer({
  ws,
  open,
  onOpenChange,
}: {
  ws: RunWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, update } = ws;
  const items = ws.allKeys.map((k) => {
    const [itemId = '', metric = ''] = k.split('\u0000');
    const score = ws.rowById.get(itemId)?.metric_scores[metric];
    return { key: k, label: `${itemId} · ${metric}${score != null ? ` ${score.toFixed(2)}` : ''}` };
  });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Prompt preview"
      subtitle="The exact messages the analyzer would send. No LLM call is made."
      width={560}
    >
      <div className={s.stack}>
        <Select
          label="Previewed target"
          items={items}
          value={ws.focusKey}
          onChange={(k) => k != null && ws.setFocusKey(String(k))}
          width="100%"
          isDisabled={items.length === 0}
          placeholder="No targets"
        />
        <div className={s.contextRow} role="group" aria-label="Prompt context">
          <Text variant="sm" weight={600} tone="muted">
            Context
          </Text>
          <Switch isSelected={settings.useRules} onChange={(v) => update({ useRules: v })}>
            Production rules
          </Switch>
          <Switch isSelected={settings.useDocuments} onChange={(v) => update({ useDocuments: v })}>
            Project documents
          </Switch>
          <Switch isSelected={settings.useTrace} onChange={(v) => update({ useTrace: v })}>
            Trace evidence
          </Switch>
        </div>
        <PromptPreview ws={ws} maxHeight={false} />
      </div>
    </Drawer>
  );
}
