import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useProject } from '@/api/projects';
import { Icon, IconButton, Kbd, Tag } from '@/ui';
import { useAuth } from './AuthContext';
import { TopbarStatsProvider } from './TopbarStats';
import { useContentScrollRestoration, useSidebarCollapsed } from './hooks';
import { Breadcrumbs } from './chrome/Breadcrumbs';
import { UserMenu } from './chrome/UserMenu';
import { TopbarStatsBar } from './chrome/TopbarStatsBar';
import { CommandPalette } from './chrome/CommandPalette';
import { GLOBAL_NAV, PLATFORM_NAV, isNavActive, parseRoute, projectNav, type NavItem } from './chrome/nav';
import styles from './AppShell.module.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Variant A (UX_DECISION.md): persistent left sidebar (brand · global · project
 * pages · Platform for admins · user footer) + 50px topbar (collapse toggle,
 * breadcrumb project switcher, page stats, read-only tag, Ctrl/Cmd+K palette).
 * `main#shell-content` is the only scroller; ≤760px the sidebar auto-collapses
 * and expands as an overlay.
 */
export function AppShell() {
  return (
    <TopbarStatsProvider>
      <ShellFrame />
    </TopbarStatsProvider>
  );
}

function ShellFrame() {
  const { me, isAdmin } = useAuth();
  const location = useLocation();
  const route = parseRoute(location.pathname);
  const project = useProject(route.projectSlug ?? undefined, me).data ?? null;
  const [collapsed, toggleCollapsed, narrow] = useSidebarCollapsed();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useContentScrollRestoration(contentRef);

  const sidebarCollapsed = narrow ? !overlayOpen : collapsed;

  // Route change: close the overlay sidebar (state adjusted during render) and
  // move focus to the content region.
  const [seenPath, setSeenPath] = useState(location.pathname);
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname);
    setOverlayOpen(false);
  }
  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // Overlay sidebar: Escape / outside click close it and return focus to the toggle.
  useEffect(() => {
    if (!narrow || !overlayOpen) return;
    const close = () => {
      setOverlayOpen(false);
      toggleRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onPointer = (e: PointerEvent) => {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !toggleRef.current?.contains(e.target as Node)
      )
        close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [narrow, overlayOpen]);

  // Ctrl/Cmd+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const projectItems = project
    ? projectNav(project.slug).filter((i) => project.is_active || !i.hiddenWhenArchived)
    : [];
  const platformItems = isAdmin ? PLATFORM_NAV : [];
  const onProject = Boolean(project);

  return (
    <div
      className={styles.shell}
      data-app-shell
      data-collapsed={sidebarCollapsed ? '' : undefined}
      data-narrow={narrow ? '' : undefined}
    >
      <a href="#shell-content" className={styles.skip}>
        Skip to content
      </a>
      <aside
        ref={sidebarRef}
        id="qym-sidebar"
        className={styles.sidebar}
        aria-label="Sidebar"
        data-sidebar
        data-user-role={me.role}
      >
        <div className={styles.sidebarTop}>
          <Link to="/" className={styles.brand} title="Projects">
            <span className={styles.brandMark} aria-hidden="true">
              ق
            </span>
            <span className={styles.brandName}>qym</span>
          </Link>
        </div>
        <div className={styles.sidebarScroll}>
          <NavSection
            label="Global"
            items={GLOBAL_NAV}
            page={route.page}
            collapsed={sidebarCollapsed}
            activeOverride={onProject ? () => false : undefined}
          />
          {project ? (
            <NavSection
              label={`${project.name} pages`}
              title={project.name}
              items={projectItems}
              page={route.page}
              collapsed={sidebarCollapsed}
            />
          ) : null}
          {platformItems.length ? (
            <NavSection
              label="Platform"
              title="Platform"
              items={platformItems}
              page={route.page}
              collapsed={sidebarCollapsed}
              activeOverride={onProject ? () => false : undefined}
            />
          ) : null}
        </div>
        <div className={styles.sidebarFooter}>
          <UserMenu compact={sidebarCollapsed} placement="top start" />
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar} data-topbar>
          <IconButton
            ref={toggleRef}
            label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon="sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-controls="qym-sidebar"
            onPress={() => (narrow ? setOverlayOpen((o) => !o) : toggleCollapsed())}
            data-sidebar-toggle
          />
          <Breadcrumbs route={route} project={project} />
          {project && !project.is_active ? (
            <Tag kind="data" tone="warning" className={styles.readOnly}>
              Read-only
            </Tag>
          ) : null}
          <div className={styles.topbarEnd}>
            <TopbarStatsBar />
            <button
              type="button"
              className={styles.paletteButton}
              onClick={() => setPaletteOpen(true)}
              aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
              data-palette-trigger
            >
              <Icon name="search" size={12} />
              <span className={styles.paletteLabel}>Go to</span>
              <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
            </button>
          </div>
        </header>
        <main ref={contentRef} id="shell-content" className={styles.content} tabIndex={-1} data-shell-content>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} project={project} />
    </div>
  );
}

function NavSection({
  label,
  title,
  items,
  page,
  collapsed,
  activeOverride,
}: {
  label: string;
  title?: string;
  items: NavItem[];
  page: string;
  collapsed: boolean;
  activeOverride?: (item: NavItem) => boolean;
}) {
  if (!items.length) return null;
  return (
    <nav aria-label={label} className={styles.navSection}>
      {title && !collapsed ? (
        <div className={styles.navTitle} title={title}>
          {title}
        </div>
      ) : null}
      {items.map((item) => {
        const active = activeOverride ? activeOverride(item) : isNavActive(item, page);
        return (
          <Link
            key={item.id}
            to={item.to}
            className={styles.navItem}
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? item.label : undefined}
            data-tooltip={collapsed ? item.label : undefined}
            data-collapsed={collapsed ? '' : undefined}
            data-nav={item.id}
          >
            <span className={styles.navIcon}>
              <Icon name={item.icon} size={16} />
            </span>
            {!collapsed ? <span className={styles.navLabel}>{item.label}</span> : null}
            {!collapsed && item.adminOnly && item.id === 'admin' ? <Tag kind="accent">Admin</Tag> : null}
          </Link>
        );
      })}
    </nav>
  );
}
