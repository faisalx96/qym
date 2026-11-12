import { useId, useState, type ReactNode } from 'react';
import { Button, Icon, Switch, Text } from '@/ui';
import { leafPaths, metadataKey, nodeLeaves, pathsToTree } from '../model/mapping';
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

/** The three context switches (project rules, project documents, trace evidence). */
function ContextSwitches({ ws }: { ws: RunWorkspace }) {
  const { settings, update } = ws;
  return (
    <>
      <Switch isSelected={settings.useRules} onChange={(v) => update({ useRules: v })}>
        Rules
      </Switch>
      <Switch isSelected={settings.useDocuments} onChange={(v) => update({ useDocuments: v })}>
        Project documents
      </Switch>
      <Switch isSelected={settings.useTrace} onChange={(v) => update({ useTrace: v })}>
        Trace evidence
      </Switch>
    </>
  );
}

/**
 * What goes into the prompt (cv4 D7): item data (Error, Scores, Metric metadata and its field picker) and the
 * Context (Rules, Project documents, Trace evidence). Every switch reads and writes `ws.settings`, the one owner of
 * this state, so the page, the prompt preview drawer and the character count always agree.
 */
export function PromptContents({ ws }: { ws: RunWorkspace }) {
  const { settings, update, trees } = ws;
  const [metaOpen, setMetaOpen] = useState(false);
  return (
    <div className={s.stack}>
      <div className={s.contentsGrid}>
        <SwitchGroup label="Item data">
          <Switch isSelected={settings.includeError} onChange={(v) => update({ includeError: v })}>
            Error
          </Switch>
          <Switch isSelected={settings.includeScores} onChange={(v) => update({ includeScores: v })}>
            Scores
          </Switch>
          <span className={s.switchWith}>
            <Switch isSelected={settings.includeMetadata} onChange={(v) => update({ includeMetadata: v })}>
              Metric metadata
            </Switch>
            {trees.metadata.length ? (
              <Button
                size="sm"
                isDisabled={!settings.includeMetadata}
                aria-expanded={metaOpen}
                onPress={() => setMetaOpen((o) => !o)}
                iconEnd={<Icon name={metaOpen ? 'collapse' : 'expand'} size={12} />}
              >
                {settings.metaDeselected.length ? 'Choose metadata (custom)' : 'Choose metadata (all)'}
              </Button>
            ) : null}
          </span>
        </SwitchGroup>
        <SwitchGroup label="Context">
          <ContextSwitches ws={ws} />
        </SwitchGroup>
      </div>
      {metaOpen && settings.includeMetadata ? <MetadataPicker ws={ws} /> : null}
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

function MetadataPicker({ ws }: { ws: RunWorkspace }) {
  const { settings, update, trees } = ws;
  const off = new Set(settings.metaDeselected);
  return (
    <div className={s.picker} role="group" aria-label="Metric metadata fields">
      {trees.metadata.map((group) => {
        const tree = pathsToTree(group.paths);
        const selected = new Set(leafPaths(tree).filter((l) => !off.has(metadataKey(group.metric, l))));
        return (
          <div key={group.metric} className={s.metaGroup}>
            <Text variant="md" weight={600} mono>
              {group.metric}
            </Text>
            <PathTree
              nodes={tree}
              selected={selected}
              onToggle={(node) => {
                const leaves = nodeLeaves(node).map((l) => metadataKey(group.metric, l));
                const allOn = leaves.every((k) => !off.has(k));
                const next = new Set(off);
                leaves.forEach((k) => (allOn ? next.add(k) : next.delete(k)));
                update({ metaDeselected: [...next] });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
