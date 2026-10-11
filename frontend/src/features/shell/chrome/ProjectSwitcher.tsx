import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import type { Project } from '@/api/types';
import { canCreateProject } from '@/api/me';
import { projectPath } from '@/app/routes';
import { KEYS, writeLocal } from '@/lib/storage';
import { Badge, Icon, Identicon, SearchField, Text } from '@/ui';
import { useAuth } from '../AuthContext';
import { CreateProjectDialog } from '../dialogs';
import styles from './ProjectSwitcher.module.css';

export interface ProjectSwitcherProps {
  /** The project shown in the trigger (may be archived, hence not in me.projects). */
  current: Project | null;
  /** Compact trigger (icon + name only). */
  compact?: boolean;
  className?: string;
}

/**
 * Breadcrumb project switcher: popover with search (focused on open),
 * identicons, archived tag, check mark, "Create project" footer.
 * Selecting navigates in-app and remembers the slug.
 */
export function ProjectSwitcher({ current, compact, className }: ProjectSwitcherProps) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => {
    const all =
      current && !me.projects.some((p) => p.id === current.id) ? [current, ...me.projects] : me.projects;
    const q = query.trim().toLowerCase();
    return q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)) : all;
  }, [me.projects, current, query]);

  function choose(p: Project) {
    setOpen(false);
    setQuery('');
    if (p.is_active) writeLocal(KEYS.lastProjectSlug, p.slug);
    navigate(projectPath(p.slug));
  }

  return (
    <>
      <DialogTrigger
        isOpen={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <AriaButton
          className={[styles.trigger, className].filter(Boolean).join(' ')}
          aria-label={current ? `Switch project (current: ${current.name})` : 'Choose a project'}
          data-project-switcher
          data-compact={compact ? '' : undefined}
        >
          {current ? (
            <Identicon seed={current.slug} cell={5} gap={2} chip />
          ) : (
            <Icon name="folder" size={14} />
          )}
          <span className={styles.triggerName}>{current ? current.name : 'Projects'}</span>
          {current && !current.is_active ? <Badge tone="warning">archived</Badge> : null}
          <Icon name="chevron-down" size={12} />
        </AriaButton>
        <Popover placement="bottom start" offset={6} className={styles.popover}>
          <Dialog aria-label="Switch project" className={styles.dialog}>
            <div className={styles.search}>
              <SearchField
                label="Search projects"
                placeholder="Search projects"
                value={query}
                onChange={setQuery}
                autoFocus
              />
            </div>
            <ul className={styles.list} role="listbox" aria-label="Projects">
              {list.length === 0 ? <li className={styles.empty}>No matching projects</li> : null}
              {list.map((p) => (
                <li key={p.id} role="option" aria-selected={current?.id === p.id}>
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => choose(p)}
                    data-switch-to={p.slug}
                  >
                    <Identicon seed={p.slug} cell={5} gap={2} chip />
                    <span className={styles.optionText}>
                      <Text variant="sm" as="span" tone="primary" weight={600} truncate>
                        {p.name}
                      </Text>
                      <Text variant="sm" as="span" mono truncate>
                        {p.slug}
                      </Text>
                    </span>
                    {!p.is_active ? <Badge tone="warning">archived</Badge> : null}
                    {current?.id === p.id ? <Icon name="check" size={12} /> : null}
                  </button>
                </li>
              ))}
            </ul>
            {canCreateProject(me) ? (
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.create}
                  onClick={() => {
                    setOpen(false);
                    setCreating(true);
                  }}
                  data-create-project
                >
                  <Icon name="plus" size={12} />
                  <span>Create project</span>
                </button>
              </div>
            ) : null}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
