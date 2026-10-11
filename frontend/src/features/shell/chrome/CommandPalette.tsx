import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import type { Project } from '@/api/types';
import { canCreateProject } from '@/api/me';
import { projectPath } from '@/app/routes';
import { KEYS, writeLocal } from '@/lib/storage';
import { Badge, Icon, Identicon, type IconName } from '@/ui';
import { useAuth } from '../AuthContext';
import { CreateProjectDialog } from '../dialogs';
import { GLOBAL_NAV, PLATFORM_NAV, projectNav } from './nav';
import styles from './CommandPalette.module.css';

interface Entry {
  id: string;
  group: 'Projects' | 'Pages' | 'Actions';
  label: string;
  hint?: string;
  icon?: IconName;
  seed?: string;
  archived?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
}

/** Ctrl/Cmd+K: search projects, pages and actions (UX_DECISION adjustment 2). */
export function CommandPalette({ open, onOpenChange, project }: CommandPaletteProps) {
  const { me, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const close = () => onOpenChange(false);

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string) => () => {
      close();
      navigate(to);
    };
    const projects: Entry[] = me.projects.map((p) => ({
      id: `project:${p.slug}`,
      group: 'Projects',
      label: p.name,
      hint: p.slug,
      seed: p.slug,
      archived: !p.is_active,
      run: () => {
        close();
        if (p.is_active) writeLocal(KEYS.lastProjectSlug, p.slug);
        navigate(projectPath(p.slug));
      },
    }));
    const pages: Entry[] = [
      ...(project ? projectNav(project.slug).filter((i) => project.is_active || !i.hiddenWhenArchived) : []),
      ...GLOBAL_NAV,
      ...(isAdmin ? PLATFORM_NAV : []),
      { id: 'profile', label: 'Profile', icon: 'user' as IconName, to: '/profile' },
    ].map((i) => ({
      id: `page:${i.id}`,
      group: 'Pages' as const,
      label: i.label,
      hint:
        project && !GLOBAL_NAV.includes(i) && !PLATFORM_NAV.includes(i) && i.id !== 'profile'
          ? project.name
          : undefined,
      icon: i.icon,
      run: go(i.to),
    }));
    const actions: Entry[] = [];
    if (canCreateProject(me))
      actions.push({
        id: 'action:create',
        group: 'Actions',
        label: 'Create project',
        icon: 'plus',
        run: () => {
          close();
          setCreating(true);
        },
      });
    if (project) {
      actions.push({
        id: 'action:members',
        group: 'Actions',
        label: 'Manage members',
        hint: project.name,
        icon: 'user',
        run: go(`${projectPath(project.slug, 'settings')}?tab=members`),
      });
      actions.push({
        id: 'action:keys',
        group: 'Actions',
        label: 'API keys',
        hint: project.name,
        icon: 'shield',
        run: go(`${projectPath(project.slug, 'settings')}?tab=apikeys`),
      });
    }
    return [...projects, ...pages, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, project, isAdmin, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q) || e.hint?.toLowerCase().includes(q));
  }, [entries, query]);
  const current = filtered[Math.min(active, Math.max(0, filtered.length - 1))];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  return (
    <>
      <ModalOverlay
        isOpen={open}
        onOpenChange={(o) => {
          if (!o) {
            setQuery('');
            setActive(0);
          }
          onOpenChange(o);
        }}
        isDismissable
        className={styles.backdrop}
      >
        <Modal className={styles.modal}>
          <AriaDialog aria-label="Go to" className={styles.dialog} data-command-palette>
            <div className={styles.search}>
              <Icon name="search" size={14} />
              <input
                className={styles.input}
                role="combobox"
                aria-expanded
                aria-controls="qym-palette-list"
                aria-autocomplete="list"
                aria-activedescendant={current ? `qym-palette-${current.id}` : undefined}
                aria-label="Search projects, pages and actions"
                placeholder="Search projects, pages, actions…"
                value={query}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, filtered.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter' && current) {
                    e.preventDefault();
                    current.run();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                  }
                }}
              />
            </div>
            <ul
              id="qym-palette-list"
              ref={listRef}
              role="listbox"
              className={styles.list}
              aria-label="Results"
            >
              {filtered.length === 0 ? <li className={styles.empty}>No matches for “{query}”</li> : null}
              {(['Projects', 'Pages', 'Actions'] as const).map((group) => {
                const items = filtered.filter((e) => e.group === group);
                if (!items.length) return null;
                return (
                  <li key={group} role="presentation">
                    <div className={styles.group}>{group}</div>
                    <ul role="group" aria-label={group} className={styles.groupList}>
                      {items.map((e) => (
                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                        <li
                          key={e.id}
                          id={`qym-palette-${e.id}`}
                          role="option"
                          aria-selected={current?.id === e.id}
                          className={styles.option}
                          onMouseMove={() => setActive(filtered.indexOf(e))}
                          onClick={e.run}
                          data-palette-option={e.id}
                        >
                          {e.seed ? (
                            <Identicon seed={e.seed} cell={4} gap={1} chip />
                          ) : (
                            <Icon name={e.icon ?? 'chevron-right'} size={14} />
                          )}
                          <span className={styles.optionLabel}>{e.label}</span>
                          {e.archived ? <Badge tone="warning">archived</Badge> : null}
                          {e.hint ? <span className={styles.hint}>{e.hint}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </AriaDialog>
        </Modal>
      </ModalOverlay>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
