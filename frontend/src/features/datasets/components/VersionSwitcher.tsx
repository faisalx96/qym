/**
 * Hero version pill → popover with search and a listbox of versions; rows
 * are real links (`?v=`), ↑/↓/Home/End/Enter/Escape via React Aria ListBox.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button as AriaButton, ListBox, ListBoxItem } from 'react-aria-components';
import type { DatasetVersion } from '@/api/datasets';
import { Badge, Icon, Popover, SearchField, Tag } from '@/ui';
import { versionItemsText } from '../lib/itemState';
import { pluralize, relativeTime } from '../lib/itemValue';
import { isProduction } from '../lib/versions';
import styles from './VersionSwitcher.module.css';

export interface VersionSwitcherProps {
  versions: DatasetVersion[];
  active: DatasetVersion;
  hrefFor: (version: DatasetVersion) => string;
}

export function VersionSwitcher({ versions, active, hrefFor }: VersionSwitcherProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter(
      (v) =>
        v.version.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [versions, query]);

  return (
    <Popover
      label="Versions"
      placement="bottom end"
      isOpen={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
      trigger={
        <AriaButton className={styles.pill} aria-haspopup="listbox" data-testid="version-switcher">
          <span className={styles.pillVersion}>{active.version}</span>
          {active.name ? <span className={styles.pillName}>{active.name}</span> : null}
          <VersionBadge version={active} />
          <Icon name="chevron-down" size={12} aria-hidden="true" />
        </AriaButton>
      }
    >
      {({ close }) => (
        <div className={styles.panel}>
          {versions.length > 6 ? (
            <SearchField
              label="Search versions"
              hideLabel
              value={query}
              onChange={setQuery}
              placeholder="Search versions…"
              autoFocus
            />
          ) : null}
          <ListBox
            aria-label="Versions"
            className={styles.list}
            selectionMode="single"
            selectedKeys={[active.id]}
            items={filtered}
            autoFocus={versions.length <= 6}
            onSelectionChange={(keys) => {
              const key = keys === 'all' ? null : [...keys][0];
              const v = versions.find((x) => x.id === key);
              close();
              if (v && v.id !== active.id) navigate(hrefFor(v));
            }}
          >
            {(v) => (
              <ListBoxItem id={v.id} textValue={`${v.version} ${v.name}`} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowVersion}>{v.version}</span>
                  <span className={styles.rowName}>{v.name || <em>unnamed</em>}</span>
                  <VersionBadge version={v} />
                </span>
                <span className={styles.rowMeta}>
                  <span data-testid="version-row-items">
                    {versionItemsText(v.item_count, v.disabled_count)}
                  </span>{' '}
                  · {pluralize(v.run_count, 'run')} · {relativeTime(v.updated_at)}
                </span>
              </ListBoxItem>
            )}
          </ListBox>
          {!filtered.length ? <div className={styles.empty}>No versions match.</div> : null}
        </div>
      )}
    </Popover>
  );
}

export function VersionBadge({ version }: { version: DatasetVersion }) {
  if (isProduction(version)) return <Badge tone="success">Production</Badge>;
  if (version.status === 'draft') return <Badge tone="warning">Draft</Badge>;
  return <Badge tone="info">Published</Badge>;
}

export function AliasTags({ version }: { version: DatasetVersion }) {
  const others = version.aliases.filter((a) => a !== 'production');
  if (!others.length) return null;
  return (
    <>
      {others.map((a) => (
        <Tag key={a} kind="version">
          {a}
        </Tag>
      ))}
    </>
  );
}
