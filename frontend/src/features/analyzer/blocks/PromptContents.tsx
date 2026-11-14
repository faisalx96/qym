import { useId, useState, type ReactNode } from 'react';
import { Button, Icon, Switch, Text } from '@/ui';
import { CONTENT_SWITCHES, peekKeys, type SwitchId } from '../model/contents';
import { leafPaths, metadataTree, nodeLeaves } from '../model/mapping';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { PathTree } from './PathTree';
import s from './fields.module.css';

/** A labelled group of switches: the group label above, one switch per line (label right after its own switch). */
function SwitchGroup({ label, children, row }: { label: string; children: ReactNode; row?: boolean }) {
  const id = useId();
  return (
    <div className={s.switchGroup} role="group" aria-labelledby={id}>
      <Text variant="sm" weight={600} tone="muted" id={id}>
        {label}
      </Text>
      <div className={row ? s.switchRow : s.switchList}>{children}</div>
    </div>
  );
}

/** Hover and focus of a switch mark its section in the prompt pane (cv5 Q4); null when it leaves. */
export type PeekHandler = (keys: string[] | null) => void;

/** One Prompt contents switch, named as its section of the prompt. */
function ContentToggle({ id, ws, onPeek }: { id: SwitchId; ws: RunWorkspace; onPeek?: PeekHandler }) {
  const sw = CONTENT_SWITCHES.find((c) => c.id === id)!;
  const { settings, update } = ws;
  const peek = (active: boolean) => onPeek?.(active ? peekKeys(id, settings) : null);
  return (
    <Switch
      isSelected={sw.on(settings)}
      onChange={(v) => update(SET[id](v))}
      onHoverChange={peek}
      onFocusChange={peek}
    >
      {sw.label}
    </Switch>
  );
}

const SET: Record<SwitchId, (v: boolean) => Partial<RunWorkspace['settings']>> = {
  scores: (v) => ({ includeScores: v }),
  metricMeta: (v) => ({ includeMetricMetadata: v }),
  itemMeta: (v) => ({ includeMetadata: v }),
  trace: (v) => ({ useTrace: v }),
  rules: (v) => ({ useRules: v }),
  docs: (v) => ({ useDocuments: v }),
};

/** The context switches (analysis rules, reference documents, trace evidence). */
function ContextSwitches({ ws, onPeek }: { ws: RunWorkspace; onPeek?: PeekHandler }) {
  return (
    <>
      <ContentToggle id="rules" ws={ws} onPeek={onPeek} />
      <ContentToggle id="docs" ws={ws} onPeek={onPeek} />
      <ContentToggle id="trace" ws={ws} onPeek={onPeek} />
    </>
  );
}

/**
 * What goes into the prompt (cv4 D7, cv5 Q4): item data (Metric result, Metric metadata and its key picker, Item
 * metadata) and the Context (Analysis rules, Reference documents, Trace evidence). Each switch sends one section of
 * the prompt and has that section's name; hover or focus marks the section in the pane. Every switch reads and writes
 * `ws.settings`, the one owner of this state, so the page, the prompt preview and the character count always agree.
 * There is no Error switch: a target is never an item with a task error, so the switch could change nothing.
 */
export function PromptContents({ ws, onPeek }: { ws: RunWorkspace; onPeek?: PeekHandler }) {
  const { settings, trees } = ws;
  const [metaOpen, setMetaOpen] = useState(false);
  return (
    <div className={s.stack}>
      <div className={s.contentsGrid}>
        <SwitchGroup label="Item data">
          <ContentToggle id="scores" ws={ws} onPeek={onPeek} />
          <span className={s.switchWith}>
            <ContentToggle id="metricMeta" ws={ws} onPeek={onPeek} />
            {trees.metadata.length ? (
              <Button
                size="sm"
                isDisabled={!settings.includeMetricMetadata}
                aria-expanded={metaOpen}
                onPress={() => setMetaOpen((o) => !o)}
                iconEnd={<Icon name={metaOpen ? 'collapse' : 'expand'} size={12} />}
              >
                {/* cv5 Y6: a trigger reads "Label · value", never a value in parentheses */}
                {settings.metaDeselected.length ? 'Keys · Custom' : 'Keys · All'}
              </Button>
            ) : null}
          </span>
          <ContentToggle id="itemMeta" ws={ws} onPeek={onPeek} />
        </SwitchGroup>
        <SwitchGroup label="Context">
          <ContextSwitches ws={ws} onPeek={onPeek} />
        </SwitchGroup>
      </div>
      {metaOpen && settings.includeMetricMetadata ? <MetadataPicker ws={ws} /> : null}
    </div>
  );
}

/** The drawer's copy of the Context switches: the same state as the page, in one row. */
export function ContextRow({ ws }: { ws: RunWorkspace }) {
  return (
    <SwitchGroup label="Context" row>
      <ContextSwitches ws={ws} />
    </SwitchGroup>
  );
}

/**
 * The keys of the target metric's metadata (cv5 Q4): one tree, the union over the analysed metrics; each target sends
 * the chosen keys of its own metric, never another metric's metadata.
 */
function MetadataPicker({ ws }: { ws: RunWorkspace }) {
  const { settings, update, trees } = ws;
  const off = new Set(settings.metaDeselected);
  const tree = metadataTree(trees.metadata, settings.selectedMetrics);
  const selected = new Set(leafPaths(tree).filter((l) => !off.has(l)));
  return (
    <div className={s.picker} role="group" aria-label="Metric metadata keys">
      <div className={s.metaGroup}>
        <Text variant="sm" tone="muted">
          Keys of the metadata of each target&rsquo;s own metric
        </Text>
        <PathTree
          nodes={tree}
          selected={selected}
          onToggle={(node) => {
            const leaves = nodeLeaves(node);
            const allOn = leaves.every((k) => !off.has(k));
            const next = new Set(off);
            leaves.forEach((k) => (allOn ? next.add(k) : next.delete(k)));
            update({ metaDeselected: [...next] });
          }}
        />
      </div>
    </div>
  );
}
