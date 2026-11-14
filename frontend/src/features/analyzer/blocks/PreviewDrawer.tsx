import { useState } from 'react';
import { Drawer, Select } from '@/ui';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { ContextRow } from './PromptContents';
import { PromptPreview } from './PromptPreview';
import s from './blocks.module.css';

/** Wide enough for an 80-column prompt line next to the page (cv4 D6: was 560). */
const PREVIEW_DRAWER_WIDTH = 760;

/**
 * Prompt preview in a right drawer (opened from the action rail or a target row, `?preview=1`):
 * previewed-target select, the Context switches (the same page state as "Prompt contents", cv4 D7), then the
 * messages in the drawer's single scroller. The field mapping is edited on the page.
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
  // cv5 N: hover or focus of a Context switch marks its section in the prompt, as on the page
  const [peek, setPeek] = useState<string[] | null>(null);
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
      width={PREVIEW_DRAWER_WIDTH}
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
        <ContextRow ws={ws} onPeek={setPeek} />
        <PromptPreview ws={ws} maxHeight={false} peek={peek} />
      </div>
    </Drawer>
  );
}
