import { useState } from 'react';
import { Badge, Button, DropdownMenu, Icon, IconButton, Identicon, Popover, Tabs, Tag, Text } from '@/ui';
import { versions, type Dataset, type User, type Version } from '../fixtures';
import styles from './shared.module.css';

export function UserPill({ user, prefix }: { user: User | null; prefix?: string }) {
  if (!user) return null;
  const initials = user.display_name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={styles.userPill}>
      {prefix ? <span>{prefix}</span> : null}
      <span className={styles.avatar} aria-hidden="true">
        {initials}
      </span>
      {user.display_name}
    </span>
  );
}

function VersionSwitcher({ active }: { active: Version }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label="Switch version"
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom end"
      trigger={
        <button type="button" className={styles.versionPill} aria-haspopup="listbox" aria-expanded={open}>
          <span className={styles.versionLabel}>{active.version}</span>
          <span>{active.name}</span>
          {active.aliases.includes('production') ? <Badge tone="success">Production</Badge> : null}
          {active.status === 'draft' ? <Badge tone="warning">Draft</Badge> : null}
          <Icon name="chevron-down" size={12} />
        </button>
      }
    >
      <div className={styles.versionList} role="listbox" aria-label="Versions">
        {versions.map((v) => (
          <a
            key={v.id}
            href={`?v=${v.version}`}
            role="option"
            aria-selected={v.id === active.id}
            aria-current={v.id === active.id ? 'true' : undefined}
            className={styles.versionRow}
            onClick={(e) => e.preventDefault()}
          >
            <span className={styles.versionLabel}>{v.version}</span>
            <span>{v.name}</span>
            <span>
              {v.aliases.includes('production') ? (
                <Badge tone="success">Production</Badge>
              ) : v.status === 'draft' ? (
                <Badge tone="warning">Draft</Badge>
              ) : (
                <Tag kind="count">{v.item_count} items</Tag>
              )}
            </span>
          </a>
        ))}
      </div>
    </Popover>
  );
}

export interface DatasetHeroProps {
  dataset: Dataset;
  active: Version;
  tab: string;
  onTab: (id: string) => void;
  onAddItem?: () => void;
  onImport?: () => void;
  onPublish?: () => void;
}

/** Dataset detail hero: identicon, name, private tag, meta row, version switcher, state-driven actions, tabs. */
export function DatasetHero({ dataset, active, tab, onTab, onAddItem, onImport, onPublish }: DatasetHeroProps) {
  const isDraft = active.status === 'draft';
  const isProd = active.aliases.includes('production');
  return (
    <header>
      <div className={styles.heroRow}>
        <Identicon seed={dataset.slug} cell={6} gap={2} chip />
        <div>
          <div className={styles.heroTitle}>
            <Text variant="title" as="h1">
              {dataset.name}
            </Text>
            <IconButton label="Rename dataset" icon="edit" />
            {dataset.private_test_set ? (
              <Tag kind="role">
                <Icon name="shield" size={12} /> Private test set
              </Tag>
            ) : null}
          </div>
          <Text variant="base" tone="muted" as="p">
            {dataset.description}
          </Text>
          <div className={styles.heroMeta}>
            <span>{versions.length} versions</span>
            <span className={styles.metaSep}>·</span>
            <span>{dataset.run_count} runs</span>
            <span className={styles.metaSep}>·</span>
            <span>{active.item_count} items</span>
            <span className={styles.metaSep}>·</span>
            <span>source: api</span>
            {active.published_by ? (
              <>
                <span className={styles.metaSep}>·</span>
                <UserPill prefix="Published by" user={active.published_by} />
              </>
            ) : null}
            {isDraft ? (
              <>
                <span className={styles.metaSep}>·</span>
                <UserPill prefix="Drafted by" user={active.created_by} />
              </>
            ) : null}
            <span className={styles.metaSep}>·</span>
            <span>updated 2m ago</span>
          </div>
        </div>
        <div className={styles.heroActions}>
          <VersionSwitcher active={active} />
          {isDraft ? (
            <>
              <Button icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
                Add item
              </Button>
              <Button onPress={onImport}>Import</Button>
              <Button variant="primary" onPress={onPublish}>
                Publish
              </Button>
            </>
          ) : isProd ? (
            <Button variant="primary" icon={<Icon name="plus" size={12} />}>
              Create draft
            </Button>
          ) : (
            <>
              <Button isDisabled={!dataset.permissions.can_set_production}>Set as production</Button>
              <Button variant="primary" icon={<Icon name="plus" size={12} />}>
                Create draft
              </Button>
            </>
          )}
          <DropdownMenu
            label="More dataset actions"
            trigger={<IconButton label="More dataset actions" icon="more" />}
            onAction={() => undefined}
            items={[
              { id: 'name', label: 'Name version…' },
              { id: 'compare', label: 'Compare…' },
              { id: 'download', label: 'Download JSONL', icon: <Icon name="external" size={12} /> },
              { id: 'upload', label: 'Upload file as new version…', separatorBefore: true },
            ]}
          />
        </div>
      </div>
      <div className={styles.tabsRow}>
        <Tabs
          label="Dataset sections"
          selected={tab}
          onSelect={onTab}
          items={[
            { id: 'items', label: 'Items', count: active.item_count },
            { id: 'runs', label: 'Runs', count: active.run_count },
            { id: 'lineage', label: 'Lineage' },
            { id: 'settings', label: 'Settings' },
          ]}
        />
      </div>
    </header>
  );
}
