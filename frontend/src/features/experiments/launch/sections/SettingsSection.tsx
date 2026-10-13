/**
 * "Environment configurations": the settings tree of the selected environments, one collapsible group
 * per descriptor group plus "Other values", with search, "Changed only" and resets. Everything shown
 * comes from `buildSettingsView`; edits go through the model functions via `setDoc`. Closed groups
 * render nothing, so a 300-field schema stays responsive.
 */
import { useId, useMemo } from 'react';
import { Button, Checkbox, Collapse, Icon, SearchField, Skeleton, Tag } from '@/ui';
import { plural } from '../../lib/format';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import {
  buildSettingsView,
  endpointRefOptions,
  resetSettings,
  UNMATCHED_GROUP,
  type GroupView,
} from '../model';
import { sectionOfItem } from '../types';
import { NodeList, type TreeProps } from '../settings/FieldNode';
import { SettingsActionsCtx, type SettingsActions } from '../settings/SettingsContext';
import { countChanged } from '../settings/tree';
import styles from '../settings/settings.module.css';

function GroupCard({
  group,
  tree,
  onToggle,
}: {
  group: GroupView;
  tree: TreeProps;
  onToggle: (id: string, open: boolean) => void;
}) {
  const bodyId = useId();
  const changed = group.open ? countChanged(group.nodes) : 0;
  return (
    <div className={styles.group} data-group={group.id}>
      <h4 className={styles.groupHead}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={group.open}
          aria-controls={bodyId}
          onClick={() => onToggle(group.id, !group.open)}
        >
          <span className={styles.chevron} data-open={group.open}>
            <Icon name="chevron-right" size={12} />
          </span>
          <span>{group.label}</span>
          {tree.filtering ? (
            <Tag kind="count">{`${group.matches} match${group.matches === 1 ? '' : 'es'}`}</Tag>
          ) : null}
          {changed ? (
            <Tag kind="count" tone="info">
              {`${changed} changed`}
            </Tag>
          ) : null}
        </button>
      </h4>
      <Collapse open={group.open} id={bodyId}>
        <div className={styles.groupBody}>
          <NodeList nodes={group.nodes} removeList={group.id === UNMATCHED_GROUP ? '' : null} {...tree} />
        </div>
      </Collapse>
    </div>
  );
}

export function SettingsSection() {
  const {
    doc,
    setDoc,
    ctx,
    mode,
    review,
    settingsUi,
    setSettingsUi,
    registerField,
    confirm,
    flags,
    selectedEnvs,
  } = useLaunch();

  const view = useMemo(() => buildSettingsView(doc, ctx, settingsUi), [doc, ctx, settingsUi]);

  const errors = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const item of review.items) {
      if (sectionOfItem(item) !== 'settings') continue;
      (out[item.fieldName] ??= []).push(item.message);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
  }, [review.items]);
  const errorsKey = JSON.stringify(errors);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `errors` is a new object each render; errorsKey is its stable serialization
  const stableErrors = useMemo(() => errors, [errorsKey]);

  const endpointsMap: Record<string, string[]> = {};
  for (const entry of Object.values(ctx.union.fields)) {
    if (entry.widget === 'endpoint-ref' && entry.ref_collection && !endpointsMap[entry.ref_collection])
      endpointsMap[entry.ref_collection] = endpointRefOptions(doc, ctx, entry);
  }
  const endpointsKey = JSON.stringify(endpointsMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `endpointsMap` is rebuilt each render; endpointsKey is its stable serialization
  const endpoints = useMemo(() => endpointsMap, [endpointsKey]);

  const sweeps = mode === 'launch';
  const actions = useMemo<SettingsActions>(
    () => ({ ctx, setDoc, registerField, endpoints, sweeps }),
    [ctx, setDoc, registerField, endpoints, sweeps],
  );
  const tree: TreeProps = { errors: stableErrors, filtering: view.filtering };

  const toggle = (id: string, open: boolean) =>
    setSettingsUi((ui) => ({ ...ui, groupOpen: { ...ui.groupOpen, [id]: open } }));
  const shown = [...view.groups, ...(view.unmatched ? [view.unmatched] : [])].filter(
    (g) => !view.filtering || g.visible,
  );
  const loading = flags.envsLoading && !ctx.union.envs.length;

  const resetAll = async () => {
    if (
      view.changedCount > 2 &&
      !(await confirm({
        title: 'Reset all settings?',
        description: `${plural(view.changedCount, 'changed value')} go back to the starting point.`,
        confirmLabel: 'Reset all',
        tone: 'danger',
      }))
    )
      return;
    setDoc((d) => resetSettings(d, ctx));
  };

  return (
    <LaunchSection
      id="settings"
      description={
        mode === 'editor'
          ? "Overrides of the environment's own settings, saved in the default preset for the next experiments."
          : "Overrides of the environment's own settings, applied to every run of this experiment."
      }
    >
      <SettingsActionsCtx.Provider value={actions}>
        <div className={styles.toolbar} role="search" aria-label="Filter settings">
          <SearchField
            className={styles.toolbarSearch}
            label="Search settings"
            placeholder="Search settings"
            value={settingsUi.search}
            onChange={(search) => setSettingsUi((ui) => ({ ...ui, search }))}
            onClear={() => setSettingsUi((ui) => ({ ...ui, search: '' }))}
          />
          <Checkbox
            isSelected={settingsUi.changedOnly}
            onChange={(changedOnly) => setSettingsUi((ui) => ({ ...ui, changedOnly }))}
          >
            Changed only
          </Checkbox>
          <Tag kind="count" tone={view.changedCount ? 'info' : undefined}>
            {`${view.changedCount} changed`}
          </Tag>
          <span className={styles.spacer} />
          <Button size="sm" isDisabled={!view.changedCount} onPress={() => void resetAll()}>
            Reset all
          </Button>
        </div>
        {loading ? (
          <Skeleton kind="list" rows={4} label="Loading environment settings" />
        ) : !selectedEnvs.length && !ctx.union.envs.length ? (
          <p className={styles.empty}>Pick an environment to see its settings.</p>
        ) : view.empty ? (
          <p className={styles.empty} role="status">
            No settings match.
          </p>
        ) : (
          <div className={styles.groups}>
            {shown.map((g) => (
              <GroupCard key={g.id} group={g} tree={tree} onToggle={toggle} />
            ))}
          </div>
        )}
      </SettingsActionsCtx.Provider>
    </LaunchSection>
  );
}
