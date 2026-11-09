import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import type { Project } from '@/api/types';
import { canCreateProject } from '@/api/me';
import { projectPath, runPath } from '@/app/routes';
import { fetchRunsPage } from '@/api/dashboard';
import { api } from '@/lib/http';
import { KEYS, writeLocal } from '@/lib/storage';
import { Icon, Identicon, StatusMark, type IconName } from '@/ui';
import { useAuth } from '../AuthContext';
import { CreateProjectDialog } from '../dialogs';
import { GLOBAL_NAV, PLATFORM_NAV, projectNav } from './nav';
import styles from './CommandPalette.module.css';

interface Entry {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon?: IconName;
  seed?: string;
  archived?: boolean;
  run: () => void;
}

type Group = 'Projects' | 'Pages' | 'Runs' | 'Datasets' | 'Experiments' | 'Actions';
const GROUPS: Group[] = ['Projects', 'Pages', 'Runs', 'Datasets', 'Experiments', 'Actions'];

/** Other words people type for a page (C043): 'trash' finds Deleted runs, 'overview' the Dashboard. */
const ALIASES: Record<string, string> = {
  overview: 'dashboard home trend',
  trash: 'deleted bin restore',
  settings: 'project settings members keys prompts llm',
  analysis: 'auto-analysis analyzer root cause',
  charts: 'models scatter',
  queue: 'jobs experiments queue',
  environments: 'environment presets',
};

/** C043: the current project's runs, datasets and experiments that match the query (2+ characters), 5 of each. */
function useServerResults(slug: string | undefined, projectId: string | undefined, q: string) {
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const on = Boolean(slug) && debounced.trim().length >= 2;
  const needle = debounced.trim().toLowerCase();
  const runs = useQuery({
    queryKey: ['palette-runs', slug, needle],
    enabled: on,
    staleTime: 30_000,
    queryFn: ({ signal }) => fetchRunsPage({ project_slug: slug!, filters: { q: needle }, limit: 5 }, signal),
  });
  const datasets = useQuery({
    queryKey: ['palette-datasets', slug],
    enabled: on,
    staleTime: 60_000,
    queryFn: () =>
      api.get<{ datasets: { slug: string; name: string }[] }>(
        `/v1/datasets?project_slug=${encodeURIComponent(slug!)}&limit=1000`,
      ),
  });
  const experiments = useQuery({
    queryKey: ['palette-experiments', projectId],
    enabled: on && Boolean(projectId),
    staleTime: 60_000,
    queryFn: () =>
      api.get<{ experiments: { id: string; name: string }[] }>(
        `/v1/projects/${encodeURIComponent(projectId!)}/experiments?limit=200`,
      ),
  });
  if (!on) return { runs: [], datasets: [], experiments: [] };
  return {
    runs: (runs.data?.rows ?? []).slice(0, 5).map((r) => ({ id: r.run_id, name: r.run_name || r.run_id })),
    datasets: (datasets.data?.datasets ?? [])
      .filter((d) => d.name.toLowerCase().includes(needle) || d.slug.toLowerCase().includes(needle))
      .slice(0, 5),
    experiments: (experiments.data?.experiments ?? [])
      .filter((x) => x.name.toLowerCase().includes(needle))
      .slice(0, 5),
  };
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
  // -1 = the default pick (the current project's first page); a key or the mouse sets an index.
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  // Picking an entry closes through here (not the overlay), so reset the search too.
  const close = () => {
    setQuery('');
    setActive(-1);
    onOpenChange(false);
  };

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
      ...(project
        ? [
            {
              id: 'queue',
              label: 'Queue',
              icon: 'clock' as IconName,
              to: projectPath(project.slug, 'experiments/queue'),
            },
            {
              id: 'environments',
              label: 'Environments',
              icon: 'settings' as IconName,
              to: projectPath(project.slug, 'environments'),
            },
            {
              id: 'deleted-datasets',
              label: 'Deleted datasets',
              icon: 'trash' as IconName,
              to: `${projectPath(project.slug, 'datasets')}?view=deleted`,
            },
          ]
        : []),
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
    const actions: Entry[] = [
      {
        id: 'action:new-feedback',
        group: 'Actions',
        label: 'New feedback',
        icon: 'feedback',
        run: go('/feedback/new'),
      },
    ];
    if (canCreateProject(me))
      actions.push({
        id: 'action:create',
        group: 'Actions',
        label: 'New project',
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

  const server = useServerResults(project?.slug, project?.id, query);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const go = (to: string) => () => {
      close();
      navigate(to);
    };
    const found: Entry[] = project
      ? [
          ...server.runs.map((r) => ({
            id: `run:${r.id}`,
            group: 'Runs' as const,
            label: r.name,
            hint: project.name,
            icon: 'list' as IconName,
            run: go(runPath(project.slug, r.id)),
          })),
          ...server.datasets.map((d) => ({
            id: `dataset:${d.slug}`,
            group: 'Datasets' as const,
            label: d.name,
            hint: project.name,
            icon: 'database' as IconName,
            run: go(projectPath(project.slug, `datasets/${encodeURIComponent(d.slug)}`)),
          })),
          ...server.experiments.map((x) => ({
            id: `experiment:${x.id}`,
            group: 'Experiments' as const,
            label: x.name,
            hint: project.name,
            icon: 'flask' as IconName,
            run: go(projectPath(project.slug, `experiments/${encodeURIComponent(x.id)}`)),
          })),
        ]
      : [];
    const matches = (e: Entry) =>
      e.label.toLowerCase().includes(q) ||
      e.hint?.toLowerCase().includes(q) ||
      (ALIASES[e.id.replace(/^page:/, '')] ?? '').includes(q);
    const local = q ? entries.filter(matches) : entries;
    // Server results already match; keep the group order of GROUPS.
    const all = [...local, ...found];
    return GROUPS.flatMap((g) => all.filter((e) => e.group === g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, server.runs, server.datasets, server.experiments, project]);
  // C043: with no query, the first page of the current project is preselected (not the first project).
  const firstProjectPage = query.trim()
    ? 0
    : Math.max(
        0,
        filtered.findIndex((e) => e.group === 'Pages' && Boolean(project) && e.hint === project?.name),
      );
  const current =
    filtered[Math.min(active === -1 ? firstProjectPage : active, Math.max(0, filtered.length - 1))];

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
            setActive(-1);
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
                placeholder="Search projects, pages, actions"
                value={query}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  const at = current ? filtered.indexOf(current) : 0;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(Math.min(at + 1, filtered.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(Math.max(at - 1, 0));
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
              {GROUPS.map((group) => {
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
                          {e.archived ? (
                            <StatusMark
                              tone="warning"
                              shape="pause"
                              label="Archived"
                              data-status="archived"
                            />
                          ) : null}
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
