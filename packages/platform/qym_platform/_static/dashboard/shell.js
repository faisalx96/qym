/**
 * قيِّم Shell — Navigation Shell Module
 *
 * Single source of truth for sidebar, topbar, breadcrumbs, user menu,
 * project switching, and layout. Injected into every page.
 *
 * Usage: include <script src="/static/shell.js"></script> in <head>.
 * The shell auto-initializes on DOMContentLoaded.
 */
(function () {
  'use strict';

  // ── Skip in export mode ──
  if (window.__QYM_EXPORT__) return;

  // ── Prevent double-init ──
  if (window.QymShell) return;

  // ── The shell's frame from the first paint ──
  // This runs in <head>, before the page's content parses. Until init builds
  // the shell, shell.css draws its frame (in the remembered sidebar width)
  // and hides the content, which would otherwise paint bare, full width,
  // and jump when the shell wraps it. A failed init shows the page anyway.
  (function markShellPending() {
    var root = document.documentElement;
    root.classList.add('qym-shell-pending');
    try {
      var narrow = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
      if (narrow || localStorage.getItem('qym:sidebar-collapsed') === '1') root.classList.add('qym-shell-pending-collapsed');
    } catch (_err) { /* private mode */ }
    setTimeout(endShellPending, 4000);
  })();

  function endShellPending() {
    document.documentElement.classList.remove('qym-shell-pending', 'qym-shell-pending-collapsed');
  }

  // ── Cached state ──
  let _user = null;
  let _projects = [];
  let _currentProject = null;
  let _routeCtx = null;
  // An archived project stays out of the switcher list (/v1/me lists active
  // projects), but admins and its members open it read-only from Admin or a
  // link: the shell loads it by slug and keeps it here.
  let _archivedProject = null;

  // What the last /v1/me said, for the first frame of the next load: the
  // role (the Platform section), the name (the user menu) and the project
  // names (the breadcrumb), which otherwise pop in a round trip later. It is
  // display only (the server checks every request), replaced as soon as
  // /v1/me answers, and cleared on sign-out (auth.js).
  var ME_CACHE_KEY = 'qym:me';
  var _cachedMe = null;

  function readCachedMe() {
    try {
      var cached = JSON.parse(localStorage.getItem(ME_CACHE_KEY) || 'null');
      return cached && typeof cached === 'object' && Array.isArray(cached.projects) ? cached : null;
    } catch (_err) {
      return null;
    }
  }

  function cacheMe(user) {
    try {
      localStorage.setItem(ME_CACHE_KEY, JSON.stringify({
        role: user.role || '',
        display_name: user.display_name || '',
        email: user.email || '',
        projects: (user.projects || []).filter(Boolean).map(function (project) {
          return { slug: project.slug, name: project.name };
        }),
      }));
    } catch (_err) { /* private mode */ }
  }

  function forgetCachedMe() {
    _cachedMe = null;
    try { localStorage.removeItem(ME_CACHE_KEY); } catch (_err) { /* private mode */ }
  }

  // The project a /projects/{slug}/ URL names, by its remembered name, until
  // /v1/me answers. A guessed project (a legacy /run/{id} link) is never
  // shown from memory: it can be the wrong one.
  function rememberedRouteProject(ctx) {
    if (_user || !_cachedMe || !ctx || !ctx.explicitProject || !ctx.projectSlug) return null;
    return _cachedMe.projects.find(function (project) {
      return project && project.slug === ctx.projectSlug && project.name;
    }) || null;
  }

  // ══════════════════════════════════════════════════
  // URL PARSING
  // ══════════════════════════════════════════════════

  function getAppRootPath() {
    if (typeof window.__QYM_ROOT_PATH__ === 'string') {
      const configuredRoot = window.__QYM_ROOT_PATH__.replace(/\/+$/, '');
      return configuredRoot ? configuredRoot + '/' : '/';
    }

    const rawPath = window.location.pathname;
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
    const patterns = [
      /\/projects\/[^/]+\/analysis$/,
      /\/projects\/[^/]+\/runs\/[^/]+\/analyzer$/,
      /\/projects\/[^/]+\/runs\/[^/]+$/,
      /\/projects\/[^/]+\/reviews$/,
      /\/projects\/[^/]+\/datasets(?:\/[^/]+(?:\/compare)?)?$/,
      /\/projects\/[^/]+\/settings$/,
      /\/projects\/[^/]+\/overview$/,
      /\/projects\/[^/]+\/charts$/,
      /\/projects\/[^/]+\/models$/,
      /\/projects\/[^/]+$/,
      /\/run\/[^/]+\/analyzer$/,
      /\/run\/[^/]+$/,
      /\/reviews$/,
      /\/profile$/,
      /\/admin$/,
      /\/trash$/,
      /\/compare$/,
    ];
    for (const pattern of patterns) {
      if (pattern.test(path)) {
        const next = path.replace(pattern, '/');
        return next.endsWith('/') ? next : next + '/';
      }
    }
    if (rawPath.endsWith('/')) return rawPath;
    return (path.substring(0, path.lastIndexOf('/') + 1) || '/');
  }

  const BASE_URL = window.location.origin + getAppRootPath();

  function apiUrl(path) {
    return BASE_URL + path.replace(/^\.?\//, '');
  }

  function parseRoute() {
    const rawPathname = window.location.pathname;
    const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, '') : rawPathname;
    const search = new URLSearchParams(window.location.search);

    // Project-scoped routes: /projects/{slug}/...
    const projectMatch = pathname.match(/\/projects\/([^/]+)(?:\/(.*))?$/);
    if (projectMatch) {
      const slug = decodeURIComponent(projectMatch[1]);
      const rest = projectMatch[2] || '';
      let page = 'runs'; // default project page
      let subId = null;

      if (rest === '' || rest === 'runs') page = 'runs';
      else if (rest === 'charts') page = 'charts';
      else if (rest === 'models') page = 'models';
      else if (rest === 'datasets') page = 'datasets';
      else if (rest.startsWith('datasets/')) {
        page = 'datasets';
        var remainder = rest.slice(9);
        if (remainder.endsWith('/compare')) {
          subId = remainder.slice(0, -'/compare'.length);
        } else {
          subId = remainder;
        }
      }
      else if (rest === 'overview') page = 'overview';
      else if (rest === 'analysis') page = 'analysis';
      else if (rest === 'reviews') page = 'reviews';
      else if (rest === 'settings') page = 'settings';
      else if (rest.startsWith('runs/') && rest.endsWith('/analyzer')) {
        page = 'analysis';
        subId = rest.slice(5, -'/analyzer'.length);
      }
      else if (rest.startsWith('runs/')) { page = 'run-detail'; subId = rest.slice(5); }

      return { projectSlug: slug, page: page, subId: subId, explicitProject: true };
    }

    // Legacy run detail: /run/{id} — keep project context from last known project.
    // That is a guess (the run can belong to another or an archived project), so
    // the page corrects it with QymShell.setPageProject once the run has loaded.
    const lastSlug = localStorage.getItem('qym:last-project-slug') || null;
    const analyzerMatch = pathname.match(/\/run\/(.+)\/analyzer$/);
    if (analyzerMatch) return { projectSlug: lastSlug, page: 'analysis', subId: analyzerMatch[1], guessedProject: true };
    const runMatch = pathname.match(/\/run\/(.+)$/);
    if (runMatch) return { projectSlug: lastSlug, page: 'run-detail', subId: runMatch[1], guessedProject: true };

    // Global pages — truly no project
    if (pathname.endsWith('/admin')) return { projectSlug: null, page: 'admin', subId: null };
    if (pathname.endsWith('/profile')) return { projectSlug: null, page: 'profile', subId: null };
    if (pathname.endsWith('/trash')) return { projectSlug: null, page: 'trash', subId: null };
    if (pathname.endsWith('/docs-guide')) return { projectSlug: null, page: 'docs', subId: null };

    // Compare and reviews without project prefix — keep project context
    if (pathname.endsWith('/compare')) return { projectSlug: lastSlug, page: 'compare', subId: null };
    if (pathname.endsWith('/reviews')) return { projectSlug: lastSlug, page: 'reviews', subId: null };

    // Root = projects landing
    return { projectSlug: null, page: 'projects', subId: null };
  }

  // ══════════════════════════════════════════════════
  // UTILITY
  // ══════════════════════════════════════════════════

  // One shared escaping rule (qym_safe.js): & < > " ' so it is attribute-safe.
  function esc(s) {
    return QymSafe.escapeHtml(s || '');
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function projectUrl(slug, subPage) {
    const root = getAppRootPath();
    if (!slug) return root;
    let url = root + 'projects/' + encodeURIComponent(slug);
    if (subPage && subPage !== 'runs') url += '/' + subPage;
    return url;
  }

  function isModifiedEvent(e) {
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
  }

  function getRelativeAppPath(pathname) {
    var root = getAppRootPath();
    if (!pathname.startsWith(root)) return null;
    return pathname.slice(root.length).replace(/^\/+/, '');
  }

  function isNavigableAppPath(pathname) {
    var relative = getRelativeAppPath(pathname);
    if (relative === null) return false;
    if (relative === '') return true;
    return [
      /^projects\/[^/]+(?:\/(?:runs|overview|charts|models|datasets(?:\/[^/]+(?:\/compare)?)?|analysis|reviews|settings))?$/,
      /^projects\/[^/]+\/runs\/[^/]+$/,
      /^projects\/[^/]+\/runs\/[^/]+\/analyzer$/,
      /^run\/[^/]+$/,
      /^run\/[^/]+\/analyzer$/,
      /^reviews$/,
      /^profile$/,
      /^admin$/,
      /^trash$/,
      /^compare$/,
    ].some(function (pattern) {
      return pattern.test(relative);
    });
  }

  function canInterceptLink(link, e) {
    if (!link) return false;
    if (isModifiedEvent(e)) return false;
    if (link.hasAttribute('download')) return false;
    if ((link.getAttribute('target') || '').toLowerCase() === '_blank') return false;

    var href = link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#')) return false;

    var targetUrl;
    try {
      targetUrl = new URL(href, window.location.href);
    } catch (err) {
      return false;
    }

    if (targetUrl.origin !== window.location.origin) return false;
    if (!isNavigableAppPath(targetUrl.pathname)) return false;

    return targetUrl.pathname + targetUrl.search !== window.location.pathname + window.location.search;
  }

  function closeShellPopovers() {
    var projPopover = document.getElementById('shell-project-popover');
    var projTrigger = document.getElementById('shell-project-trigger');
    var userPopover = document.getElementById('shell-user-popover');
    if (projPopover) projPopover.classList.remove('open');
    if (projTrigger) projTrigger.classList.remove('open');
    if (userPopover) userPopover.classList.remove('open');
  }

  function projectExists(projectSlug) {
    if (!projectSlug) return false;
    if (_archivedProject && _archivedProject.slug === projectSlug) return true;
    var projects = _user && Array.isArray(_user.projects) ? _user.projects : _projects;
    return projects.some(function (project) {
      return project && project.slug === projectSlug;
    });
  }

  function updateCurrentProjectForRoute() {
    var sidebar = document.getElementById('qym-sidebar');
    if (_routeCtx && _routeCtx.projectSlug && _user && Array.isArray(_user.projects)) {
      _currentProject = _user.projects.find(function (project) {
        return project && project.slug === _routeCtx.projectSlug;
      }) || null;
      if (!_currentProject && _archivedProject && _archivedProject.slug === _routeCtx.projectSlug) {
        _currentProject = _archivedProject;
      }
    } else {
      _currentProject = null;
    }

    if (sidebar) {
      if (_currentProject) {
        sidebar.classList.remove('no-project');
        rebuildNavHrefs();
      } else {
        sidebar.classList.add('no-project');
      }
      sidebar.classList.toggle('project-archived', isProjectArchived());
    }

    var triggerText = document.querySelector('.project-trigger-text');
    if (triggerText && _currentProject) triggerText.textContent = _currentProject.name;
    // Pages may render their own crumbs, so the tag is updated in place.
    var archivedTag = document.querySelector('.breadcrumb-project-btn .project-archived-tag');
    if (archivedTag && !isProjectArchived()) archivedTag.remove();
    if (!archivedTag && triggerText && isProjectArchived()) {
      triggerText.insertAdjacentHTML('afterend', '<span class="project-archived-tag">Archived</span>');
    }
    renderArchivedNotice();
  }

  // The current project is archived: its pages are read-only and every write
  // answers 409 "Project is archived", so pages leave their edit controls out.
  function isProjectArchived() {
    return !!(_currentProject && _currentProject.is_active === false);
  }

  // Load an archived project named in the URL (not in /v1/me). Only archived
  // projects are kept: an active project missing from the list is one the
  // user cannot open, which stays "Project not found".
  async function loadArchivedProject(slug) {
    if (!slug) return false;
    try {
      var res = await fetch(apiUrl('v1/projects/by-slug/' + encodeURIComponent(slug)), { credentials: 'same-origin' });
      if (!res.ok) return false;
      var project = await res.json();
      if (!project || project.slug !== slug || project.is_active !== false) return false;
      _archivedProject = project;
      return true;
    } catch (_err) {
      return false;
    }
  }

  // Pages whose read-only state the shell announces. Compare and Reviews keep
  // their own notices (they can mix projects).
  var ARCHIVED_NOTICE_PAGES = {
    runs: true, overview: true, charts: true, models: true, datasets: true, settings: true, 'run-detail': true,
  };

  function renderArchivedNotice() {
    var notice = document.getElementById('shell-archived-notice');
    if (!notice) return;
    var show = isProjectArchived() && !!(_routeCtx && ARCHIVED_NOTICE_PAGES[_routeCtx.page]);
    notice.hidden = !show;
    notice.innerHTML = show
      ? '<strong>Read-only.</strong> "' + esc(_currentProject.name || _currentProject.slug) + '" is archived. '
        + 'You can open its runs, datasets and settings, but nothing can be changed until an admin unarchives it.'
      : '';
  }

  // A remembered project that is gone (archived, or access removed) is no
  // context at all for a guessed route; it is not a "project not found" page.
  function dropMissingGuessedProject() {
    if (_routeCtx && _routeCtx.guessedProject && _routeCtx.projectSlug && !projectExists(_routeCtx.projectSlug)) {
      _routeCtx.projectSlug = null;
      updateCurrentProjectForRoute();
    }
  }

  // Pages reached without a project in the URL (/run/{id}) tell the shell
  // which project they belong to once they know. An archived project becomes
  // a read-only context (whoever can view the run can open its project); one
  // the user cannot open gives no project context.
  var _pendingPageProject = null;
  function setPageProject(project) {
    if (!_routeCtx) return;
    if (!_user) {
      _pendingPageProject = project || null;
      return;
    }
    _pendingPageProject = null;
    var slug = project && project.slug ? String(project.slug) : null;
    var archived = !!(project && project.archived);
    if (slug && archived && !projectExists(slug)) {
      // Enough for the context now; the full project (role) follows.
      _archivedProject = { id: project.id, slug: slug, name: String(project.name || slug), is_active: false, role: '' };
      loadArchivedProject(slug).then(function (loaded) {
        if (loaded && _routeCtx && _routeCtx.projectSlug === slug) {
          updateCurrentProjectForRoute();
          renderBreadcrumbs(computeBreadcrumbs(_routeCtx));
        }
      });
    }
    var usable = !!(slug && projectExists(slug));
    _routeCtx.projectSlug = usable ? slug : null;
    _routeCtx.guessedProject = false;
    updateCurrentProjectForRoute();
    // An archived project never becomes the remembered project.
    if (usable && !archived) {
      try { localStorage.setItem('qym:last-project-slug', slug); } catch (_err) { /* private mode */ }
    }
    renderBreadcrumbs(computeBreadcrumbs(_routeCtx));
    renderProjectList();
  }

  function renderProjectNotFound(projectSlug) {
    var content = document.getElementById('shell-content') || document.querySelector('main');
    if (!content) return;
    closeShellPopovers();
    updateCurrentProjectForRoute();
    clearTopbarStats();
    renderBreadcrumbs([{ label: 'Project Not Found', current: true }]);
    content.innerHTML = ''
      + '<div style="max-width:640px;margin:56px auto;padding:0 20px;">'
      +   '<div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:12px;padding:28px 24px;">'
      +     '<div style="font-size:var(--font-sm);font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--error);margin-bottom:12px;">Missing Project</div>'
      +     '<h1 style="margin:0 0 10px 0;font-size:var(--font-title);line-height:1.2;color:var(--text-primary);">Project not found</h1>'
      +     '<p style="margin:0;color:var(--text-secondary);font-size:var(--font-md);line-height:1.6;">The requested project does not exist, is archived, or you no longer have access to it.</p>'
      +     (projectSlug
              ? '<div style="margin-top:16px;padding:10px 12px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:var(--font-base);color:var(--text-muted);">Slug: ' + esc(projectSlug) + '</div>'
              : '')
      +     '<div style="margin-top:20px;"><a href="' + esc(getAppRootPath()) + '" class="shell-btn shell-btn-primary" style="display:inline-flex;text-decoration:none;">Back to Projects</a></div>'
      +   '</div>'
      + '</div>';
  }

  function syncProjects(projects) {
    var nextProjects = Array.isArray(projects) ? projects.slice() : [];
    if (_user) _user.projects = nextProjects;
    _projects = nextProjects;
    window.__QYM_USER__ = _user;
    updateCurrentProjectForRoute();
    renderProjectList();
  }

  function upsertProject(project) {
    if (!project) return;
    // Unarchived: it is an ordinary project again.
    if (_archivedProject && project.is_active !== false
        && ((project.id && project.id === _archivedProject.id) || (project.slug && project.slug === _archivedProject.slug))) {
      _archivedProject = null;
    }
    var nextProjects = (_user && Array.isArray(_user.projects) ? _user.projects : _projects).slice();
    var idx = nextProjects.findIndex(function (item) {
      if (!item) return false;
      if (project.id && item.id === project.id) return true;
      return !!(project.slug && item.slug === project.slug);
    });
    if (idx >= 0) nextProjects[idx] = project;
    else nextProjects.push(project);
    syncProjects(nextProjects);
  }

  function removeProject(projectRef) {
    if (!projectRef) return;
    var nextProjects = (_user && Array.isArray(_user.projects) ? _user.projects : _projects).filter(function (item) {
      if (!item) return false;
      if (projectRef.id && item.id === projectRef.id) return false;
      if (projectRef.slug && item.slug === projectRef.slug) return false;
      return true;
    });
    syncProjects(nextProjects);
  }

  function setNavigationPending(isPending) {
    var content = document.getElementById('shell-content');
    if (content) content.classList.toggle('is-navigating', !!isPending);
  }

  // ══════════════════════════════════════════════════
  // SVG ICONS (inline, stroke-based, 18px)
  // ══════════════════════════════════════════════════

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    charts: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    runs: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    models: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    analysis: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.64 5.64 2.12 2.12"/><path d="m16.24 16.24 2.12 2.12"/><path d="m18.36 5.64-2.12 2.12"/><path d="m7.76 16.24-2.12 2.12"/><circle cx="12" cy="12" r="3"/>',
    datasets: '<path d="M21 5c0 1.7-4 3-9 3S3 6.7 3 5s4-3 9-3 9 1.3 9 3Z"/><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>',
    reviews: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    traces: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    docs: '<path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    profile: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    collapse: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="14 8 9 12 14 16"/>',
    project: '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    dots: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  };

  function icon(name, size) {
    const s = size || 18;
    return '<svg class="nav-item-icon" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  function iconRaw(name, w, h) {
    return '<svg viewBox="0 0 24 24" width="' + (w||14) + '" height="' + (h||14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  // ══════════════════════════════════════════════════
  // HTML BUILDERS
  // ══════════════════════════════════════════════════

  function buildNavItem(label, page, iconName, opts) {
    opts = opts || {};
    const href = opts.href || '#';
    const badge = opts.badge ? '<span class="nav-item-badge ' + (opts.badgeClass || 'count') + '">' + esc(opts.badge) + '</span>' : '';
    const extraClass = opts.className ? ' ' + opts.className : '';
    return '<a class="nav-item' + extraClass + '" href="' + esc(href) + '" data-tooltip="' + esc(label) + '" data-page="' + page + '">'
      + icon(iconName)
      + '<span class="nav-item-label">' + esc(label) + '</span>'
      + badge
      + '</a>';
  }

  function buildSidebarHTML() {
    const root = getAppRootPath();
    const projectSlug = _routeCtx.projectSlug;

    // Project switcher
    const projectName = _currentProject ? esc(_currentProject.name) : 'Select a project';

    // Project-scoped nav items
    const projectNav = [
      buildNavItem('Dashboard', 'overview', 'dashboard', { href: projectSlug ? projectUrl(projectSlug, 'overview') : '#' }),
      buildNavItem('Charts', 'charts', 'charts', { href: projectSlug ? projectUrl(projectSlug, 'charts') : '#' }),
      buildNavItem('Runs', 'runs', 'runs', { href: projectSlug ? projectUrl(projectSlug) : '#' }),
      buildNavItem('Models', 'models', 'models', { href: projectSlug ? projectUrl(projectSlug, 'models') : '#' }),
      buildNavItem('Auto-analysis', 'analysis', 'analysis', { href: projectSlug ? projectUrl(projectSlug, 'analysis') : '#' }),
      buildNavItem('Reviews', 'reviews', 'reviews', { href: projectSlug ? projectUrl(projectSlug, 'reviews') : '#' }),
      buildNavItem('Datasets', 'datasets', 'datasets', { href: projectSlug ? projectUrl(projectSlug, 'datasets') : '#' }),
      buildNavItem('Project Settings', 'settings', 'settings', { href: projectSlug ? projectUrl(projectSlug, 'settings') : '#' }),
    ].join('');

    return ''
      // Logo
      + '<div class="sidebar-logo">'
      +   '<a href="' + esc(root) + '">'
      // Embedded in shell.css, so the logo paints with the sidebar.
      +     '<span class="logo-icon-img" role="img" aria-label="قيِّم"></span>'
      +     '<span class="logo-text-img" aria-hidden="true"></span>'
      +   '</a>'
      + '</div>'


      // Nav
      + '<nav class="sidebar-nav">'
      +   '<div class="global-nav-items">'
      +     buildNavItem('Projects', 'projects', 'project', { href: root })
      +     buildNavItem('Docs', 'docs', 'docs', { href: root + 'docs-guide' })
      +   '</div>'
      +   '<div class="project-nav-items">' + projectNav + '</div>'
      +   '<div class="nav-section-label nav-section-role-admin">Platform</div>'
      +   buildNavItem('Admin', 'admin', 'admin', { href: root + 'admin', badge: 'Admin', badgeClass: 'admin-tag', className: 'nav-item-role-admin' })
      +   buildNavItem('Deleted Runs', 'trash', 'trash', { href: root + 'trash', className: 'nav-item-role-admin' })
      + '</nav>'

      // User Footer
      + '<div class="sidebar-footer">'
      +   '<div class="user-popover" id="shell-user-popover">'
      +     '<div class="user-popover-header">'
      +       '<div class="user-avatar" id="shell-popover-avatar">?</div>'
      +       '<div class="user-info">'
      +         '<div class="user-name" id="shell-popover-name">User</div>'
      +         '<span class="user-role" id="shell-popover-role"></span>'
      +       '</div>'
      +     '</div>'
      +     '<div class="user-popover-list">'
      +       '<a class="user-popover-item" href="' + esc(root) + 'profile">'
      +         iconRaw('profile', 15, 15)
      +         ' Profile'
      +       '</a>'
      +       '<div class="user-popover-divider"></div>'
      +       '<a class="user-popover-item danger" href="#" id="shell-signout-btn">'
      +         iconRaw('signout', 15, 15)
      +         ' Sign Out'
      +       '</a>'
      +     '</div>'
      +   '</div>'
      +   '<button class="user-trigger" id="shell-user-trigger">'
      +     '<div class="user-avatar" id="shell-user-avatar">?</div>'
      +     '<div class="user-info">'
      +       '<div class="user-name" id="shell-user-name">User</div>'
      +       '<div class="user-email" id="shell-user-email"></div>'
      +     '</div>'
      +     '<span class="user-trigger-dots">' + iconRaw('dots') + '</span>'
      +   '</button>'
      + '</div>';
  }

  function buildTopbarHTML() {
    return ''
      + '<div class="topbar-left">'
      +   '<button class="topbar-toggle" id="shell-collapse-btn" title="Toggle sidebar">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + ICONS.collapse + '</svg>'
      +   '</button>'
      +   '<nav class="breadcrumbs" id="shell-breadcrumbs"></nav>'
      + '</div>'
      + '<div class="topbar-stats" id="shell-topbar-stats"></div>';
  }

  // ══════════════════════════════════════════════════
  // BREADCRUMBS
  // ══════════════════════════════════════════════════

  const PAGE_LABELS = {
    projects: 'Projects',
    overview: 'Dashboard',
    dashboard: 'Dashboard',
    charts: 'Charts',
    runs: 'Runs',
    'run-detail': 'Run Detail',
    analyzer: 'Auto-analysis',
    analysis: 'Auto-analysis',
    models: 'Models',
    datasets: 'Datasets',
    reviews: 'Reviews',
    traces: 'Traces',
    settings: 'Project Settings',
    admin: 'Admin',
    trash: 'Deleted Runs',
    profile: 'Profile',
    compare: 'Compare',
    docs: 'Docs',
  };

  function computeBreadcrumbs(ctx) {
    var crumbs = [];
    var project = _currentProject || rememberedRouteProject(ctx);

    if (ctx.projectSlug && project) {
      // First crumb = project switcher
      crumbs.push({ label: project.name, projectSwitcher: true, project: project });

      if (ctx.page === 'analysis' || ctx.page === 'analyzer') {
        crumbs.push({ label: 'Auto-analysis', current: true });
      } else if (ctx.page === 'run-detail') {
        crumbs.push({ label: 'Runs', href: projectUrl(ctx.projectSlug) });
        crumbs.push({ label: ctx.subId || 'Run', current: true });
      } else if (ctx.page === 'compare') {
        crumbs.push({ label: 'Runs', href: projectUrl(ctx.projectSlug) });
        crumbs.push({ label: 'Compare', current: true });
      } else {
        crumbs.push({ label: PAGE_LABELS[ctx.page] || ctx.page, current: true });
      }
    } else if (ctx.page === 'analysis' || ctx.page === 'analyzer') {
      crumbs.push({ label: ctx.subId || 'Run', href: getAppRootPath() + 'run/' + encodeURIComponent(ctx.subId || '') });
      crumbs.push({ label: 'Auto-analysis', current: true });
    } else if (ctx.page === 'run-detail') {
      crumbs.push({ label: ctx.subId || 'Run Detail', current: true });
    } else {
      crumbs.push({ label: PAGE_LABELS[ctx.page] || 'Home', current: true });
    }

    return crumbs;
  }

  function renderBreadcrumbs(crumbs) {
    var bcEl = document.getElementById('shell-breadcrumbs');
    if (!bcEl) return;
    var html = '';
    for (var i = 0; i < crumbs.length; i++) {
      if (i > 0) html += '<span class="breadcrumb-sep">/</span>';
      var c = crumbs[i];
      if (c.projectSwitcher) {
        // Embedded project switcher as breadcrumb segment. Its project is the
        // crumb's (a remembered one before /v1/me answers), else the current.
        var crumbProject = c.project || _currentProject;
        html += '<div class="breadcrumb-project" id="breadcrumb-project">'
          + '<button class="breadcrumb-project-btn" id="shell-project-trigger">'
          +   '<span class="project-trigger-icon">'
          +     (crumbProject && crumbProject.slug
                  ? identiconHTML(crumbProject.slug, { cell: 2, gap: 1, showEmpty: false })
                  : iconRaw('project', 10, 10))
          +   '</span>'
          +   '<span class="project-trigger-text">' + esc(c.label) + '</span>'
          +   (isProjectArchived() ? '<span class="project-archived-tag">Archived</span>' : '')
          +   '<span class="project-trigger-chevron">' + iconRaw('chevronDown', 10, 10) + '</span>'
          + '</button>'
          + '<div class="project-popover" id="shell-project-popover">'
          +   '<div class="popover-search"><input type="text" placeholder="Search projects…" id="shell-project-search" /></div>'
          +   '<div class="popover-list" id="shell-project-list"></div>'
          +   '<div class="popover-footer"><button class="popover-footer-btn" id="shell-create-project-btn">' + iconRaw('plus') + ' Create Project</button></div>'
          + '</div>'
          + '</div>';
      } else if (c.current) {
        html += '<span class="breadcrumb-item current">' + esc(c.label) + '</span>';
      } else {
        html += '<a class="breadcrumb-item" href="' + esc(c.href) + '">' + esc(c.label) + '</a>';
      }
    }
    bcEl.innerHTML = html;

    // Rebind project switcher events if it was rendered
    bindProjectSwitcherEvents();
  }

  // ══════════════════════════════════════════════════
  // ACTIVE NAV STATE
  // ══════════════════════════════════════════════════

  // Map sub-pages to their parent nav section
  var NAV_PARENT = {
    'run-detail': 'runs',
    'analyzer': 'analysis',
    'compare': 'runs',
  };

  function setActiveNav(page) {
    var activePage = NAV_PARENT[page] || page;
    var items = document.querySelectorAll('.sidebar .nav-item');
    items.forEach(function (item) {
      var itemPage = item.getAttribute('data-page');
      if (itemPage === activePage) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // ══════════════════════════════════════════════════
  // PROJECT POPOVER
  // ══════════════════════════════════════════════════

  function renderProjectList(filter) {
    var list = document.getElementById('shell-project-list');
    if (!list) return;
    var query = (filter || '').toLowerCase();
    var listed = _projects.slice();
    if (isProjectArchived() && !listed.some(function (p) { return p.slug === _currentProject.slug; })) {
      listed.unshift(_currentProject);
    }
    var filtered = listed.filter(function (p) {
      return !query || p.name.toLowerCase().indexOf(query) !== -1 || p.slug.toLowerCase().indexOf(query) !== -1;
    });
    var html = '';
    filtered.forEach(function (p) {
      var isActive = _currentProject && _currentProject.slug === p.slug;
      html += '<a class="popover-item' + (isActive ? ' active' : '') + '" data-slug="' + esc(p.slug) + '" href="' + esc(projectUrl(p.slug)) + '">'
        + '<span class="popover-item-icon">' + identiconHTML(p.slug, { cell: 2, gap: 1, showEmpty: false }) + '</span>'
        + '<span>' + esc(p.name) + '</span>'
        + (p.is_active === false ? '<span class="project-archived-tag">Archived</span>' : '')
        + (isActive ? '<span class="popover-item-check">' + iconRaw('check', 14, 14) + '</span>' : '')
        + '</a>';
    });
    if (!filtered.length) html = '<div style="padding:8px 10px;font-size:var(--font-base);color:var(--text-muted)">No projects found</div>';
    list.innerHTML = html;

    // Bind click handlers
    list.querySelectorAll('.popover-item[data-slug]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (isModifiedEvent(e)) return;
        switchProject(item.getAttribute('data-slug'));
        e.preventDefault();
      });
    });
  }

  // ══════════════════════════════════════════════════
  // USER POPULATION
  // ══════════════════════════════════════════════════

  function populateUser(user) {
    if (!user) return;
    var displayName = user.display_name || (user.email ? user.email.split('@')[0] : 'User');
    var initials = getInitials(displayName);
    var sidebar = document.getElementById('qym-sidebar');
    if (sidebar) sidebar.dataset.userRole = user.role || '';

    var setText = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val || '';
    };

    setText('shell-user-avatar', initials);
    setText('shell-user-name', displayName);
    setText('shell-user-email', user.email || '');
    setText('shell-popover-avatar', initials);
    setText('shell-popover-name', displayName);
    setText('shell-popover-role', user.role || '');

    // Show/hide admin items based on role
    document.querySelectorAll('.nav-item[data-page="admin"], .nav-item[data-page="trash"]').forEach(function (el) {
      el.style.display = user.role === 'ADMIN' ? '' : 'none';
    });
  }

  // ══════════════════════════════════════════════════
  // EVENT BINDING
  // ══════════════════════════════════════════════════

  function bindProjectSwitcherEvents() {
    var projTrigger = document.getElementById('shell-project-trigger');
    var projPopover = document.getElementById('shell-project-popover');
    if (!projTrigger || !projPopover || projTrigger.dataset.bound) return;
    projTrigger.dataset.bound = '1';

    projTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = projPopover.classList.toggle('open');
      projTrigger.classList.toggle('open', isOpen);
      if (isOpen) {
        renderProjectList();
        var searchInput = document.getElementById('shell-project-search');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
      }
    });

    var projSearch = document.getElementById('shell-project-search');
    if (projSearch) {
      projSearch.addEventListener('input', function () {
        renderProjectList(projSearch.value);
      });
    }

    var createBtn = document.getElementById('shell-create-project-btn');
    if (createBtn) {
      createBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        projPopover.classList.remove('open');
        projTrigger.classList.remove('open');
        openCreateProjectDialog();
      });
    }
  }

  // Every shell dialog uses the shared modal focus contract
  // (QymUIComponents.openDialog): focus moves in, Tab stays inside, Escape
  // closes, and focus returns to the control that opened it.
  function manageDialog(modal, options) {
    var ui = window.QymUIComponents;
    return ui && ui.openDialog ? ui.openDialog(modal, options) : null;
  }

  function releaseManagedDialog(modal) {
    var ui = window.QymUIComponents;
    if (ui && ui.releaseDialog) ui.releaseDialog(modal);
  }

  function openCreateProjectDialog() {
    // Remove any existing dialog
    var existing = document.getElementById('shell-create-project-dialog');
    if (existing) existing.remove();

    var dialog = document.createElement('div');
    dialog.id = 'shell-create-project-dialog';
    dialog.className = 'shell-modal-backdrop';
    dialog.innerHTML = ''
      + '<div class="shell-modal" role="dialog" aria-modal="true" aria-labelledby="shell-create-project-title">'
      +   '<div class="shell-modal-header">'
      +     '<div class="shell-modal-title" id="shell-create-project-title">Create Project</div>'
      +     '<button class="shell-modal-close qym-icon-action" type="button" aria-label="Close">&times;</button>'
      +   '</div>'
      +   '<div class="shell-modal-body">'
      +     '<div class="shell-form-group">'
      +       '<label class="shell-form-label" for="shell-new-project-name">Project Name</label>'
      +       '<input class="shell-form-input" id="shell-new-project-name" type="text" placeholder="My Project" autofocus />'
      +     '</div>'
      +     '<div class="shell-form-group">'
      +       '<label class="shell-form-label" for="shell-new-project-slug">Slug</label>'
      +       '<input class="shell-form-input" id="shell-new-project-slug" type="text" placeholder="my-project" style="font-family:var(--font-mono);font-size:var(--font-base)" />'
      +     '</div>'
      +     '<div class="shell-form-error" id="shell-new-project-error"></div>'
      +   '</div>'
      +   '<div class="shell-modal-footer">'
      +     '<button class="shell-btn shell-btn-secondary" id="shell-create-cancel" type="button">Cancel</button>'
      +     '<button class="shell-btn shell-btn-primary" id="shell-create-submit" type="button">Create</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(dialog);

    var nameInput = document.getElementById('shell-new-project-name');
    var slugInput = document.getElementById('shell-new-project-slug');
    var errorEl = document.getElementById('shell-new-project-error');
    var cancelBtn = document.getElementById('shell-create-cancel');
    var submitBtn = document.getElementById('shell-create-submit');

    // Auto-generate slug from name
    var slugEdited = false;
    slugInput.addEventListener('input', function () { slugEdited = true; });
    nameInput.addEventListener('input', function () {
      if (!slugEdited) {
        slugInput.value = nameInput.value.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
      }
    });

    var modal = dialog.querySelector('.shell-modal');
    function closeDialog() { releaseManagedDialog(modal); dialog.remove(); }
    manageDialog(modal, { initialFocus: nameInput, onEscape: closeDialog });

    cancelBtn.addEventListener('click', closeDialog);
    var closeBtn = dialog.querySelector('.shell-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDialog);
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) closeDialog();
    });

    async function submit() {
      errorEl.textContent = '';
      var name = nameInput.value.trim();
      var slug = slugInput.value.trim();
      if (!name) { errorEl.textContent = 'Name is required'; return; }
      if (!slug) { errorEl.textContent = 'Slug is required'; return; }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
      try {
        var res = await fetch(apiUrl('v1/projects'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, slug: slug }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.detail || 'Failed to create project');
        closeDialog();
        // Refresh projects list and navigate to the new project
        upsertProject(data);
        navigateTo(projectUrl(data.slug));
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to create project';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
      }
    }

    submitBtn.addEventListener('click', submit);
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    slugInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  function openConfirmDialog(options) {
    options = options || {};

    var existing = document.getElementById('shell-confirm-dialog');
    if (existing) existing.remove();

    return new Promise(function (resolve) {
      var descriptions = Array.isArray(options.description) ? options.description : [options.description];
      descriptions = descriptions.filter(function (line) { return !!line; });
      var requiredText = options.requireText || '';
      var needsInput = !!requiredText;

      var dialog = document.createElement('div');
      dialog.id = 'shell-confirm-dialog';
      dialog.className = 'shell-modal-backdrop';
      dialog.innerHTML = ''
        + '<div class="shell-modal" role="dialog" aria-modal="true" aria-labelledby="shell-confirm-title">'
        +   '<div class="shell-modal-header">'
        +     '<div class="shell-modal-title" id="shell-confirm-title">' + esc(options.title || 'Confirm Action') + '</div>'
        +     '<button class="shell-modal-close qym-icon-action" type="button" aria-label="Close">&times;</button>'
        +   '</div>'
        +   '<div class="shell-modal-body">'
        +     descriptions.map(function (line) {
                return '<p class="shell-modal-description">' + esc(line) + '</p>';
              }).join('')
        +     confirmWarningHtml(options.warning)
        +     (options.note ? '<div class="shell-modal-note">' + esc(options.note) + '</div>' : '')
        +     (needsInput
                ? '<div class="shell-form-group" style="margin-top:var(--space-md)">'
                  + '<label class="shell-form-label" for="shell-confirm-input">' + esc(options.inputLabel || 'Type to Confirm') + '</label>'
                  + '<input class="shell-form-input" id="shell-confirm-input" type="text" placeholder="' + esc(options.inputPlaceholder || '') + '" autocomplete="off" />'
                  + '</div>'
                : '')
        +     '<div class="shell-form-error" id="shell-confirm-error"></div>'
        +   '</div>'
        +   '<div class="shell-modal-footer">'
        +     '<button class="shell-btn shell-btn-secondary" id="shell-confirm-cancel" type="button">' + esc(options.cancelLabel || 'Cancel') + '</button>'
        +     (options.altLabel
                ? '<button class="shell-btn shell-btn-secondary" id="shell-confirm-alt" type="button">' + esc(options.altLabel) + '</button>'
                : '')
        +     '<button class="shell-btn ' + (options.confirmClass || (options.danger === true ? 'shell-btn-danger' : 'shell-btn-primary')) + '" id="shell-confirm-submit" type="button">' + esc(options.confirmLabel || 'Confirm') + '</button>'
        +   '</div>'
        + '</div>';
      var mount = options.mount && options.mount.appendChild
        ? options.mount
        : document.body;
      mount.appendChild(dialog);

      var closeBtn = dialog.querySelector('.shell-modal-close');
      var cancelBtn = document.getElementById('shell-confirm-cancel');
      var altBtn = document.getElementById('shell-confirm-alt');
      var confirmBtn = document.getElementById('shell-confirm-submit');
      var input = document.getElementById('shell-confirm-input');
      var errorEl = document.getElementById('shell-confirm-error');

      function currentValue() {
        return input ? input.value.trim() : '';
      }

      function isValid() {
        return !needsInput || currentValue() === requiredText;
      }

      function refreshState() {
        if (confirmBtn) confirmBtn.disabled = needsInput && !isValid();
        if (errorEl && isValid()) errorEl.textContent = '';
      }

      var modal = dialog.querySelector('.shell-modal');

      function close(result) {
        releaseManagedDialog(modal);
        dialog.remove();
        resolve(result);
      }

      function submit() {
        if (!isValid()) {
          if (errorEl) errorEl.textContent = options.mismatchMessage || 'Confirmation text does not match.';
          if (input) input.focus();
          refreshState();
          return;
        }
        close({ confirmed: true, value: currentValue() });
      }

      if (closeBtn) closeBtn.addEventListener('click', function () { close({ confirmed: false, value: null }); });
      if (cancelBtn) cancelBtn.addEventListener('click', function () { close({ confirmed: false, value: null }); });
      // The optional third action (altLabel) resolves { alternative: true }.
      if (altBtn) altBtn.addEventListener('click', function () { close({ confirmed: false, alternative: true, value: null }); });
      if (confirmBtn) confirmBtn.addEventListener('click', submit);
      if (input) {
        input.addEventListener('input', refreshState);
        // Enter submits only from the confirmation field; on a button, Enter
        // activates that button (Enter on Cancel cancels).
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
      }
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) close({ confirmed: false, value: null });
      });
      refreshState();
      // Destructive confirms start on Cancel, so a stray Enter never confirms.
      var destructive = /danger/.test(options.confirmClass || '') || options.danger === true;
      manageDialog(modal, {
        initialFocus: input || (destructive ? cancelBtn : confirmBtn),
        onEscape: function () { close({ confirmed: false, value: null }); },
      });
    });
  }

  // A consequence the reader must see before confirming: a lead sentence, an
  // explanation and an optional list ({ title, meta } rows, then "and N more").
  function confirmWarningHtml(warning) {
    if (!warning) return '';
    var items = Array.isArray(warning.items) ? warning.items : [];
    var more = Number(warning.more) || 0;
    var rows = items.map(function (item) {
      return '<li style="color:var(--text-secondary);font-size:var(--font-sm);line-height:1.5;">'
        + '<span style="color:var(--text-primary);">' + esc(item.title) + '</span>'
        + (item.meta ? ' <span style="color:var(--text-muted);">· ' + esc(item.meta) + '</span>' : '')
        + '</li>';
    });
    if (more > 0) {
      rows.push('<li style="color:var(--text-muted);font-size:var(--font-sm);line-height:1.5;">and ' + esc(String(more)) + ' more</li>');
    }
    return '<div class="shell-modal-warning" role="note" style="margin-top:var(--space-md);padding:var(--space-sm) var(--space-md);'
      + 'background:var(--bg-elevated);border:1px solid var(--border-subtle);border-left:3px solid var(--warning);border-radius:var(--radius-md);">'
      + '<p style="margin:0;color:var(--text-secondary);font-size:var(--font-sm);line-height:1.5;">'
      + (warning.lead ? '<strong style="color:var(--warning);font-weight:600;">' + esc(warning.lead) + '</strong> ' : '')
      + esc(warning.text || '') + '</p>'
      + (rows.length
        ? '<ul aria-label="' + esc(warning.itemsLabel || 'Details') + '" style="margin:var(--space-sm) 0 0;padding-left:var(--space-lg);">' + rows.join('') + '</ul>'
        : '')
      + '</div>';
  }

  function formatDateTime(value) {
    var date = value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // Archive confirmation shared by Project Settings and Admin > Projects.
  // Archiving cuts off the project's API keys at once, so a run that is still
  // sending results loses the rest of them (unarchiving does not bring them
  // back): list those runs before the confirm button. Resolves like
  // openConfirmDialog.
  async function confirmArchiveProject(project) {
    project = project || {};
    var name = project.name || 'this project';
    var preview = null;
    try {
      var res = await fetch(apiUrl('v1/admin/projects/' + encodeURIComponent(project.id) + '/archive-preview'), {
        credentials: 'same-origin',
      });
      if (res.status === 403) {
        // Not a failed check: only admins can archive, so there is nothing to confirm.
        toast('Only an admin can archive a project.', 'error');
        return { confirmed: false };
      }
      if (res.ok) preview = await res.json();
    } catch (_err) {
      preview = null;
    }
    var warning = null;
    if (!preview) {
      warning = {
        lead: 'Runs in progress could not be checked.',
        text: 'Archiving stops the project\'s API keys at once, so the remaining results of any run still in progress will be lost. Unarchiving does not bring them back.',
      };
    } else if (preview.running_count > 0) {
      var count = Number(preview.running_count) || 0;
      var runs = Array.isArray(preview.running_runs) ? preview.running_runs : [];
      warning = {
        lead: count === 1 ? '1 run is still in progress.' : count + ' runs are still in progress.',
        text: 'Archiving stops the project\'s API keys at once, so ' + (count === 1 ? 'its' : 'their')
          + ' remaining results will be lost, and product evals the platform runs for this project are stopped.'
          + ' Unarchiving does not bring them back.',
        itemsLabel: 'Runs in progress',
        items: runs.map(function (run) {
          var started = formatDateTime(run.started_at);
          return { title: run.run_name || run.run_id, meta: started ? 'started ' + started : '' };
        }),
        more: Math.max(0, count - runs.length),
      };
    }
    return openConfirmDialog({
      title: 'Archive project?',
      description: project.description || [
        '"' + name + '" will be hidden from the project list and its API keys will stop working.',
      ],
      warning: warning,
      confirmLabel: warning ? 'Archive anyway' : 'Archive project',
      confirmClass: warning ? 'shell-btn-danger' : 'shell-btn-primary',
    });
  }

  // Unarchive confirmation shared by Admin > Projects and Project Settings.
  // Unarchiving turns the project's API keys back on at once, so name the keys
  // that start working again and offer to revoke them first, which stays
  // possible while the project is archived (Project Settings > API Keys).
  // Resolves like openConfirmDialog, or { confirmed: false, revokeFirst: true }.
  async function confirmUnarchiveProject(project) {
    project = project || {};
    var name = project.name || 'this project';
    var preview = null;
    try {
      var res = await fetch(apiUrl('v1/admin/projects/' + encodeURIComponent(project.id) + '/unarchive-preview'), {
        credentials: 'same-origin',
      });
      if (res.status === 403) {
        toast('Only an admin can unarchive a project.', 'error');
        return { confirmed: false };
      }
      if (res.ok) preview = await res.json();
    } catch (_err) {
      preview = null;
    }
    var count = preview ? Number(preview.active_api_key_count) || 0 : 0;
    var warning = null;
    if (!preview) {
      warning = {
        lead: 'API keys could not be checked.',
        text: 'Unarchiving turns every API key of this project that is not revoked back on at once.',
      };
    } else if (count > 0) {
      var keys = Array.isArray(preview.active_api_keys) ? preview.active_api_keys : [];
      warning = {
        lead: count === 1 ? '1 API key starts working again.' : count + ' API keys start working again.',
        text: 'Unarchiving turns ' + (count === 1 ? 'it' : 'them') + ' back on at once. To keep a key off, revoke it first in Project Settings > API Keys; that works while the project stays archived.',
        itemsLabel: 'API keys that start working again',
        items: keys.map(function (key) {
          var owner = key.creator ? (key.creator.display_name || key.creator.email) : '';
          return { title: key.name || 'default', meta: owner ? 'created by ' + owner : '' };
        }),
        more: Math.max(0, count - keys.length),
      };
    }
    var keysAhead = !preview || count > 0;
    var result = await openConfirmDialog({
      title: 'Unarchive project?',
      description: [
        '"' + name + '" returns to the project list and can be changed again.',
        preview && count === 0 ? 'It has no active API keys, so no key starts working again.' : '',
        'Deleted runs of the project in Trash resume their purge countdown where it paused.',
      ],
      warning: warning,
      altLabel: keysAhead ? 'Revoke keys first' : '',
      confirmLabel: keysAhead ? 'Unarchive anyway' : 'Unarchive project',
      confirmClass: keysAhead ? 'shell-btn-danger' : 'shell-btn-primary',
    });
    if (result && result.alternative) return { confirmed: false, revokeFirst: true };
    return result;
  }

  // ══════════════════════════════════════════════════
  // FORM DIALOG (generalized openConfirmDialog with fields)
  // ══════════════════════════════════════════════════

  function openFormDialog(options) {
    options = options || {};
    var fields = Array.isArray(options.fields) ? options.fields : [];

    var existing = document.getElementById('shell-form-dialog');
    if (existing) existing.remove();

    return new Promise(function (resolve) {
      var dialog = document.createElement('div');
      dialog.id = 'shell-form-dialog';
      dialog.className = 'shell-modal-backdrop';

      var fieldsHtml = fields.map(function (f, idx) {
        var id = 'shell-form-field-' + idx;
        var labelHtml = f.label ? '<label class="shell-form-label" for="' + id + '">' + esc(f.label) + '</label>' : '';
        var helpHtml = f.help ? '<div class="shell-modal-note" style="margin-top:4px;">' + esc(f.help) + '</div>' : '';
        var inputHtml = '';
        if (f.type === 'textarea') {
          // The value is set as a property after mounting (below), never as markup.
          inputHtml = '<textarea class="shell-form-input" id="' + id + '" data-field="' + esc(f.name) + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.placeholder || '') + '"></textarea>';
        } else if (f.type === 'select') {
          var opts = (f.options || []).map(function (o) {
            var ov = typeof o === 'object' ? o.value : o;
            var ol = typeof o === 'object' ? o.label : o;
            // String() first: esc() drops falsy values, and an option may be 0.
            return '<option value="' + esc(ov == null ? '' : String(ov)) + '"' + (String(ov) === String(f.value) ? ' selected' : '') + '>' + esc(ol == null ? '' : String(ol)) + '</option>';
          }).join('');
          inputHtml = '<select class="shell-form-input" id="' + id + '" data-field="' + esc(f.name) + '">' + opts + '</select>';
        } else if (f.type === 'checkbox') {
          inputHtml = '<label class="shell-form-checkbox">'
            + '<input type="checkbox" id="' + id + '" data-field="' + esc(f.name) + '"' + (f.value ? ' checked' : '') + '/>'
            + '<span class="shell-form-checkbox-copy">'
            +   '<span class="shell-form-checkbox-label">' + esc(f.checkboxLabel || f.label || '') + '</span>'
            +   (f.help ? ' <span class="shell-form-checkbox-help">' + esc(f.help) + '</span>' : '')
            + '</span>'
            + '</label>';
          labelHtml = '';
          helpHtml = '';
        } else {
          inputHtml = '<input class="shell-form-input" type="' + esc(f.type || 'text') + '" id="' + id + '" data-field="' + esc(f.name) + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off" />';
        }
        return '<div class="shell-form-group">' + labelHtml + inputHtml + helpHtml + '</div>';
      }).join('');

      var descHtml = '';
      if (options.description) {
        var lines = Array.isArray(options.description) ? options.description : [options.description];
        descHtml = lines.filter(Boolean).map(function (l) { return '<p class="shell-modal-description">' + esc(l) + '</p>'; }).join('');
      }
      var detailsHtml = '';
      if (Array.isArray(options.details) && options.details.length) {
        detailsHtml = '<div class="shell-modal-detail-list">'
          + options.details.map(function (item) {
            return '<div class="shell-modal-detail-item">'
              + '<span class="shell-modal-detail-icon" aria-hidden="true">' + esc(item.icon || '✓') + '</span>'
              + '<span class="shell-modal-detail-copy">'
              +   '<span class="shell-modal-detail-title">' + esc(item.title || '') + '</span>'
              +   (item.body ? ' <span class="shell-modal-detail-body">' + esc(item.body) + '</span>' : '')
              + '</span>'
              + '</div>';
          }).join('')
          + '</div>';
      }

      dialog.innerHTML = ''
        + '<div class="shell-modal" role="dialog" aria-modal="true" aria-labelledby="shell-form-title" style="width:' + (options.width || 480) + 'px;">'
        +   '<div class="shell-modal-header">'
        +     '<div class="shell-modal-title" id="shell-form-title">' + esc(options.title || 'Form') + '</div>'
        +     '<button class="shell-modal-close qym-icon-action" type="button" aria-label="Close">&times;</button>'
        +   '</div>'
        +   '<div class="shell-modal-body">'
        +     descHtml
        +     detailsHtml
        +     fieldsHtml
        +     '<div class="shell-form-error" id="shell-form-error"></div>'
        +   '</div>'
        +   '<div class="shell-modal-footer">'
        +     '<button class="shell-btn shell-btn-secondary" id="shell-form-cancel" type="button">' + esc(options.cancelLabel || 'Cancel') + '</button>'
        +     '<button class="shell-btn ' + (options.confirmClass || 'shell-btn-primary') + '" id="shell-form-submit" type="button">' + esc(options.confirmLabel || 'Save') + '</button>'
        +   '</div>'
        + '</div>';
      var mount = options.mount && options.mount.appendChild
        ? options.mount
        : document.body;
      mount.appendChild(dialog);
      // Text values go in as DOM properties, so quotes, angle brackets and
      // ampersands round-trip exactly and can never end an attribute early.
      fields.forEach(function (f, idx) {
        if (f.type === 'select' || f.type === 'checkbox') return;
        var input = dialog.querySelector('#shell-form-field-' + idx);
        if (input) input.value = f.value == null ? '' : String(f.value);
      });

      var closeBtn = dialog.querySelector('.shell-modal-close');
      var cancelBtn = document.getElementById('shell-form-cancel');
      var submitBtn = document.getElementById('shell-form-submit');
      var errorEl = document.getElementById('shell-form-error');

      function readValues() {
        var values = {};
        fields.forEach(function (f, idx) {
          var el = document.getElementById('shell-form-field-' + idx);
          if (!el) return;
          if (f.type === 'checkbox') values[f.name] = !!el.checked;
          else values[f.name] = el.value;
        });
        return values;
      }

      var modal = dialog.querySelector('.shell-modal');
      function close(result) { releaseManagedDialog(modal); dialog.remove(); resolve(result); }
      // Enter submits from a single-line field; on a button it activates that
      // button, so Enter on Cancel cancels.
      function onKey(e) {
        if (e.key !== 'Enter' || !e.target || !e.target.matches) return;
        if (e.target.matches('input:not([type="checkbox"]):not([type="radio"]), select')) { e.preventDefault(); submit(); }
      }
      function submit() {
        var values = readValues();
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          var v = values[f.name];
          if (f.required && (v == null || String(v).trim() === '')) {
            errorEl.textContent = (f.label || f.name) + ' is required.';
            var el = document.getElementById('shell-form-field-' + i);
            if (el) el.focus();
            return;
          }
          if (typeof f.validate === 'function') {
            var msg = f.validate(v, values);
            if (msg) { errorEl.textContent = msg; var ef = document.getElementById('shell-form-field-' + i); if (ef) ef.focus(); return; }
          }
        }
        errorEl.textContent = '';

        // When an async onSubmit handler is provided, keep the dialog open while it runs
        // and surface any error inline (instead of closing and losing the user's input).
        if (typeof options.onSubmit === 'function') {
          var prevLabel = submitBtn ? submitBtn.textContent : '';
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = options.submittingLabel || 'Saving…'; }
          if (cancelBtn) cancelBtn.disabled = true;
          Promise.resolve()
            .then(function () { return options.onSubmit(values); })
            .then(function () { close({ confirmed: true, values: values }); })
            .catch(function (err) {
              errorEl.textContent = (err && err.message) ? err.message : String(err || 'Something went wrong.');
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prevLabel; }
              if (cancelBtn) cancelBtn.disabled = false;
            });
          return;
        }

        close({ confirmed: true, values: values });
      }

      if (closeBtn) closeBtn.addEventListener('click', function () { close({ confirmed: false, values: null }); });
      if (cancelBtn) cancelBtn.addEventListener('click', function () { close({ confirmed: false, values: null }); });
      if (submitBtn) submitBtn.addEventListener('click', submit);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) close({ confirmed: false, values: null }); });
      modal.addEventListener('keydown', onKey);
      manageDialog(modal, {
        initialFocus: dialog.querySelector('input,textarea,select') || cancelBtn,
        onEscape: function () { close({ confirmed: false, values: null }); },
      });
    });
  }

  // ══════════════════════════════════════════════════
  // DRAWER (right-side panel)
  // ══════════════════════════════════════════════════

  function openDrawer(options) {
    options = options || {};
    var width = options.width || 480;
    var existing = document.getElementById('shell-drawer');
    if (existing) existing.remove();

    var drawer = document.createElement('div');
    drawer.id = 'shell-drawer';
    drawer.className = 'shell-drawer-backdrop';
    drawer.innerHTML = ''
      + '<div class="shell-drawer" role="dialog" aria-modal="true" aria-labelledby="shell-drawer-title" tabindex="-1" style="width:' + width + 'px;">'
      +   '<div class="shell-drawer-header">'
      +     '<div class="shell-drawer-title-wrap">'
      +       '<div class="shell-drawer-title" id="shell-drawer-title">' + esc(options.title || '') + '</div>'
      +       (options.subtitle ? '<div class="shell-drawer-subtitle" id="shell-drawer-subtitle">' + esc(options.subtitle) + '</div>' : '<div class="shell-drawer-subtitle" id="shell-drawer-subtitle"></div>')
      +     '</div>'
      +     '<div class="shell-drawer-actions" id="shell-drawer-actions"></div>'
      +     '<button class="shell-modal-close shell-drawer-close qym-icon-action" type="button" aria-label="Close">&times;</button>'
      +   '</div>'
      +   '<div class="shell-drawer-body" id="shell-drawer-body"></div>'
      +   '<div class="shell-drawer-footer" id="shell-drawer-footer" style="display:none;"></div>'
      + '</div>';
    document.body.appendChild(drawer);

    var body = document.getElementById('shell-drawer-body');
    var footer = document.getElementById('shell-drawer-footer');
    var actions = document.getElementById('shell-drawer-actions');
    var closeBtn = drawer.querySelector('.shell-drawer-close');
    var panel = drawer.querySelector('.shell-drawer');

    function setTitle(t) { var el = document.getElementById('shell-drawer-title'); if (el) el.textContent = t || ''; }
    function setSubtitle(t) { var el = document.getElementById('shell-drawer-subtitle'); if (el) el.textContent = t || ''; }
    function setBody(content) {
      if (!body) return;
      if (typeof content === 'string') body.innerHTML = content;
      else if (content instanceof Node) { body.innerHTML = ''; body.appendChild(content); }
    }
    function setFooter(content) {
      if (!footer) return;
      if (content == null) { footer.style.display = 'none'; footer.innerHTML = ''; return; }
      footer.style.display = '';
      if (typeof content === 'string') footer.innerHTML = content;
      else if (content instanceof Node) { footer.innerHTML = ''; footer.appendChild(content); }
    }
    function setActions(content) {
      if (!actions) return;
      if (Array.isArray(content)) { renderHeaderActions(content); return; }
      if (typeof content === 'string') actions.innerHTML = content;
      else if (content instanceof Node) { actions.innerHTML = ''; actions.appendChild(content); }
    }
    function renderHeaderActions(list) {
      if (!actions) return;
      actions.innerHTML = '';
      (list || []).forEach(function (a) {
        if (!a) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shell-drawer-header-action qym-icon-action';
        btn.innerHTML = esc(a.icon || a.label || '');
        var tip = a.tooltip || a.title;
        if (tip) { btn.title = tip; btn.setAttribute('aria-label', tip); }
        if (typeof a.onClick === 'function') {
          btn.addEventListener('click', function (e) { e.preventDefault(); a.onClick(api, e); });
        }
        actions.appendChild(btn);
      });
    }

    // Render any header actions supplied up-front.
    if (options.headerActions) renderHeaderActions(options.headerActions);

    var api = {
      el: drawer,
      body: body,
      footer: footer,
      actions: actions,
      setTitle: setTitle,
      setSubtitle: setSubtitle,
      setBody: setBody,
      setFooter: setFooter,
      setActions: setActions,
      close: function () { cleanup(); releaseManagedDialog(panel); drawer.remove(); document.dispatchEvent(new CustomEvent('qym:drawer-close')); if (typeof options.onClose === 'function') options.onClose(); },
    };

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }
      if (typeof options.onKey === 'function') options.onKey(e, api);
    }
    function cleanup() { document.removeEventListener('keydown', onKey); }

    if (closeBtn) closeBtn.addEventListener('click', api.close);
    drawer.addEventListener('click', function (e) {
      if (e.target === drawer && options.dismissOnBackdrop !== false) api.close();
    });
    document.addEventListener('keydown', onKey);

    if (typeof options.render === 'function') options.render(api);
    manageDialog(panel, { initialFocus: panel });
    document.dispatchEvent(new CustomEvent('qym:drawer-open'));

    return api;
  }

  function bindEvents() {
    // Collapse toggle
    var collapseBtn = document.getElementById('shell-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () { toggleSidebar(); });
    }

    // Project switcher (in breadcrumbs)
    bindProjectSwitcherEvents();

    // User trigger
    var userTrigger = document.getElementById('shell-user-trigger');
    var userPopover = document.getElementById('shell-user-popover');
    if (userTrigger && userPopover) {
      userTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        userPopover.classList.toggle('open');
      });
    }

    // Sign out
    var signoutBtn = document.getElementById('shell-signout-btn');
    if (signoutBtn) {
      signoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.QymAuth) window.QymAuth.logout();
      });
    }

    // Close popovers on outside click
    document.addEventListener('click', function (e) {
      var projPopover = document.getElementById('shell-project-popover');
      var projTrigger = document.getElementById('shell-project-trigger');
      if (projPopover && !e.target.closest('.breadcrumb-project')) {
        projPopover.classList.remove('open');
        if (projTrigger) projTrigger.classList.remove('open');
      }
      if (userPopover && !e.target.closest('.sidebar-footer')) {
        userPopover.classList.remove('open');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var projPopover = document.getElementById('shell-project-popover');
        var projTrigger = document.getElementById('shell-project-trigger');
        if (projPopover) { projPopover.classList.remove('open'); if (projTrigger) projTrigger.classList.remove('open'); }
        if (userPopover) userPopover.classList.remove('open');
      }
    });

  }

  // ══════════════════════════════════════════════════
  // SIDEBAR COLLAPSE
  // ══════════════════════════════════════════════════

  function toggleSidebar() {
    var sidebar = document.getElementById('qym-sidebar');
    if (!sidebar) return;
    var isCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('qym:sidebar-collapsed', isCollapsed ? '1' : '');
    // Close popovers when collapsing
    if (isCollapsed) {
      var pp = document.getElementById('shell-project-popover');
      var pt = document.getElementById('shell-project-trigger');
      var up = document.getElementById('shell-user-popover');
      if (pp) pp.classList.remove('open');
      if (pt) pt.classList.remove('open');
      if (up) up.classList.remove('open');
    }
  }

  function restoreCollapseState() {
    var narrowViewport = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    if (localStorage.getItem('qym:sidebar-collapsed') === '1' || narrowViewport) {
      var sidebar = document.getElementById('qym-sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
  }

  // ══════════════════════════════════════════════════
  // PROJECT SWITCHING
  // ══════════════════════════════════════════════════

  function switchProject(slug) {
    if (!(_archivedProject && _archivedProject.slug === slug)) {
      localStorage.setItem('qym:last-project-slug', slug);
    }
    navigateTo(projectUrl(slug));
  }

  // ══════════════════════════════════════════════════
  // AJAX NAVIGATION (SPA-like content swap)
  // ══════════════════════════════════════════════════

  // ── Page lifecycle ────────────────────────────────
  // Page scripts are re-executed on every in-app navigation, so anything a
  // page adds to document/window outlives its DOM unless it is removed.
  // Each mounted page gets one AbortController: pages pass
  // { signal: QymShell.pageSignal() } to document/window listeners (and may
  // register cleanups with QymShell.onPageUnmount); the shell aborts it right
  // after 'qym:before-navigate', before the next page's scripts run. Between
  // unmount and the next mount the signal is already aborted, so a late
  // registration by the outgoing page is dropped instead of leaking.
  var _pageController = typeof AbortController === 'function' ? new AbortController() : null;

  function pageSignal() {
    return _pageController ? _pageController.signal : undefined;
  }

  function onPageUnmount(fn) {
    var signal = pageSignal();
    if (!signal || typeof fn !== 'function') return;
    var run = function () {
      try { fn(); } catch (err) { console.error('[QymShell] page cleanup failed:', err); }
    };
    if (signal.aborted) { run(); return; }
    signal.addEventListener('abort', run, { once: true });
  }

  function unmountPage() {
    if (_pageController && !_pageController.signal.aborted) _pageController.abort();
  }

  function mountPage() {
    unmountPage();
    _pageController = typeof AbortController === 'function' ? new AbortController() : null;
  }

  // ── Per-history-entry view state ──────────────────
  // The scroll offsets of the page's scroll containers are kept in
  // history.state, so Back/Forward (and a reload) put the reader back where
  // they were once the page has rendered tall enough. View state (filters,
  // sort, page, tab, open item) lives in the query string, written by the
  // pages through replaceUrlQuery().
  var SCROLL_SCAN_DEPTH = 4;

  function scrollKey(el, content) {
    if (el === content) return { id: 'shell-content' };
    if (el.id) return { id: el.id };
    var cls = Array.prototype.slice.call(el.classList || []).filter(function (name) {
      return /^[A-Za-z_][-\w]*$/.test(name);
    });
    var selector = el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
    var matches = content.querySelectorAll(selector);
    return { sel: selector, nth: Array.prototype.indexOf.call(matches, el) };
  }

  function findScrollTarget(entry, content) {
    if (!content) return null;
    if (entry.id === 'shell-content') return content;
    if (entry.id) return document.getElementById(entry.id);
    if (!entry.sel) return null;
    try {
      return content.querySelectorAll(entry.sel)[entry.nth || 0] || null;
    } catch (err) {
      return null;
    }
  }

  function captureScrollPositions() {
    var content = document.getElementById('shell-content');
    if (!content) return [];
    var out = [];
    (function walk(el, depth) {
      if (el.scrollTop > 0) {
        var key = scrollKey(el, content);
        key.top = Math.round(el.scrollTop);
        out.push(key);
      }
      if (depth >= SCROLL_SCAN_DEPTH) return;
      for (var child = el.firstElementChild; child; child = child.nextElementSibling) walk(child, depth + 1);
    })(content, 0);
    return out;
  }

  function saveHistoryViewState() {
    if (_scrollRestore) return; // still restoring: keep the saved target
    try {
      var current = history.state && typeof history.state === 'object' ? history.state : {};
      var next = Object.assign({}, current, { qym: true, qymScroll: captureScrollPositions() });
      history.replaceState(next, '', window.location.href);
    } catch (err) { /* history unavailable */ }
  }

  var _scrollSaveTimer = 0;
  function clearScheduledViewStateSave() {
    if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = 0;
  }

  function scheduleHistoryViewStateSave() {
    clearScheduledViewStateSave();
    _scrollSaveTimer = setTimeout(function () {
      _scrollSaveTimer = 0;
      // While a navigation is in flight the current entry may already be the
      // target (popstate): never write the outgoing page's offsets into it.
      if (_navFetch || _navSwapping) return;
      saveHistoryViewState();
    }, 250);
  }

  var _scrollRestore = null;

  function cancelScrollRestore() {
    if (_scrollRestore) _scrollRestore.cancel();
  }

  // Apply the saved offsets until they hold: data renders after the scripts
  // run, so the page may be too short at first. Any user input stops it.
  function restoreScrollPositions(entries) {
    cancelScrollRestore();
    if (!Array.isArray(entries) || !entries.length) return;
    var content = document.getElementById('shell-content');
    var started = Date.now();
    var settledSince = 0;
    var cancelled = false;
    var frame = 0;
    var inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    var handle = { cancel: cancel };
    function cancel() {
      if (cancelled) return;
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      inputs.forEach(function (type) { window.removeEventListener(type, cancel, true); });
      if (_scrollRestore === handle) _scrollRestore = null;
    }
    _scrollRestore = handle;
    inputs.forEach(function (type) { window.addEventListener(type, cancel, true); });
    function tick() {
      frame = 0;
      if (cancelled) return;
      var allHeld = true;
      entries.forEach(function (entry) {
        var el = findScrollTarget(entry, content);
        if (!el) { allHeld = false; return; }
        if (Math.abs(el.scrollTop - entry.top) > 1) {
          el.scrollTop = entry.top;
          if (Math.abs(el.scrollTop - entry.top) > 1) allHeld = false;
        }
      });
      var now = Date.now();
      if (allHeld) {
        if (!settledSince) settledSince = now;
      } else {
        settledSince = 0;
      }
      // Hold the position briefly after it first sticks: late sections above
      // the target (charts, KPIs) can still change height.
      if ((settledSince && now - settledSince > 600) || now - started > 6000) { cancel(); return; }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }

  // Replace query parameters of the current entry without adding history or
  // losing its saved view state. updates: { key: string | string[] | null };
  // an empty value removes the key. Returns the new relative URL.
  function replaceUrlQuery(updates) {
    var url = new URL(window.location.href);
    Object.keys(updates || {}).forEach(function (key) {
      var value = updates[key];
      url.searchParams.delete(key);
      if (value === null || value === undefined || value === '') return;
      (Array.isArray(value) ? value : [value]).forEach(function (item) {
        if (item !== null && item !== undefined && item !== '') url.searchParams.append(key, String(item));
      });
    });
    var next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      try { history.replaceState(history.state, '', next); } catch (err) { /* ignore */ }
    }
    return next;
  }

  // Copy text to the clipboard; resolves true on success.
  function copyText(text) {
    var value = String(text == null ? '' : text);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).then(function () { return true; }, function () { return fallbackCopy(value); });
    }
    return Promise.resolve(fallbackCopy(value));
  }

  function fallbackCopy(value) {
    var area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  // ── Navigation ────────────────────────────────────
  // The latest click wins: a navigation that is still fetching is abandoned
  // when another starts. While a page is being swapped in, a new request
  // waits for the swap to finish and then runs.
  var _navSeq = 0;
  var _navFetch = null;
  var _navSwapping = false;
  var _queuedNav = null;

  // The run page's data, asked for at the click: the page itself only asks
  // once its HTML and scripts are in, ~250ms later. It takes this response
  // (takePrefetch) when it asks for the same URL; anything else fetches as
  // usual.
  var _prefetch = null;
  function prefetchPageData(url, signal) {
    _prefetch = null;
    var path;
    try { path = new URL(url, window.location.href).pathname.replace(/\/+$/, ''); } catch (_err) { return; }
    var match = path.match(/\/projects\/[^/]+\/runs\/(.+)$/) || path.match(/\/run\/(.+)$/);
    if (!match || /\/analyzer$/.test(match[1])) return;
    var runId;
    try { runId = decodeURIComponent(match[1]); } catch (_err) { return; }
    var dataUrl = new URL(apiUrl('api/runs/' + runId + '?view=compact'), window.location.href).href;
    var response = fetch(dataUrl, signal ? { signal: signal } : undefined);
    response.catch(function () { /* the page asks again */ });
    _prefetch = { url: dataUrl, response: response };
  }

  function takePrefetch(url) {
    var entry = _prefetch;
    if (!entry) return null;
    var wanted;
    try { wanted = new URL(url, window.location.href).href; } catch (_err) { return null; }
    if (entry.url !== wanted) return null;
    _prefetch = null;
    return entry.response;
  }

  function navigateTo(url, opts) {
    opts = opts || {};
    _loadStartedAt = performance.now();
    if (_navSwapping) {
      _queuedNav = { url: url, opts: opts };
      return;
    }
    var content = document.getElementById('shell-content');
    var seq = ++_navSeq;
    if (_navFetch) _navFetch.abort();
    var fetchController = typeof AbortController === 'function' ? new AbortController() : null;
    _navFetch = fetchController;

    clearScheduledViewStateSave();
    if (opts.historyMode !== 'none') saveHistoryViewState();
    cancelScrollRestore();
    document.dispatchEvent(new CustomEvent('qym:before-navigate', { detail: { url: url, opts: opts } }));
    unmountPage();
    if (!content) { window.location.href = url; return; }

    closeShellPopovers();
    setNavigationPending(true);
    prefetchPageData(url, fetchController ? fetchController.signal : undefined);

    fetchAndSwap(url, opts, { seq: seq, signal: fetchController ? fetchController.signal : undefined }).then(function (swapped) {
      if (seq !== _navSeq) return;
      _navFetch = null;
      setNavigationPending(false);
      if (swapped && opts.historyMode === 'none') {
        restoreScrollPositions(history.state && history.state.qymScroll);
      }
    }, function (err) {
      if (seq !== _navSeq) return;
      _navFetch = null;
      setNavigationPending(false);
      console.error('[QymShell] Navigation failed, falling back:', err);
      window.location.href = url;
    }).then(function () {
      if (_navSwapping || !_queuedNav) return;
      var queued = _queuedNav;
      _queuedNav = null;
      navigateTo(queued.url, queued.opts);
    });
  }

  async function fetchAndSwap(url, opts, nav) {
    opts = opts || {};
    nav = nav || {};
    var res = await fetch(url, { credentials: 'same-origin', signal: nav.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var html = await res.text();
    // A later navigation started while this one was fetching: drop this one.
    if (nav.seq !== undefined && nav.seq !== _navSeq) return false;
    _navSwapping = true;
    try {
      return await swapPage(url, opts, html);
    } finally {
      _navSwapping = false;
    }
  }

  async function swapPage(url, opts, html) {

    // Parse the fetched HTML
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');

    // Relative asset URLs (compare.html and trash.html use ./static/) belong
    // to the fetched page. The parsed document resolves them against the
    // page we are leaving, which 404s from nested routes such as
    // /projects/<slug>/runs and forced a full reload.
    var pageUrl = new URL(url, window.location.href);
    function resolveForPage(value) {
      try { return new URL(value, pageUrl).href; } catch (e) { return value; }
    }
    doc.body.querySelectorAll('link[href]').forEach(function (link) {
      link.setAttribute('href', resolveForPage(link.getAttribute('href')));
    });

    // Update page title
    var newTitle = doc.querySelector('title');
    if (newTitle) document.title = newTitle.textContent;

    // Collect page-specific <style> tags from <head>
    var newStyles = doc.querySelectorAll('head > style');

    // Collect all body content (this is what shell would wrap)
    var newBody = doc.body;

    // Remove shell/auth scripts from the new content — they're singletons
    // that must not re-execute (they'd re-init the shell itself).
    newBody.querySelectorAll('script[src*="shell.js"], script[src*="auth.js"]').forEach(function (s) { s.remove(); });

    // Remove previously-injected page scripts so re-execution works cleanly.
    // Stateless libs (metrics.js) stay cached by the browser but will be
    // re-executed; that's a no-op because they only define globals.
    document.querySelectorAll('script[data-shell-exec]').forEach(function (s) { s.remove(); });

    // Extract scripts from BOTH head and body. The new page may declare
    // scripts in <head> (e.g. run.html loads metrics.js, trace_viewer.js,
    // playground.js there).
    var scriptInfos = [];
    var allScripts = [].concat(
      Array.prototype.slice.call(doc.head.querySelectorAll('script')),
      Array.prototype.slice.call(newBody.querySelectorAll('script'))
    );
    allScripts.forEach(function (script) {
      if (script.src && (script.src.indexOf('shell.js') !== -1 || script.src.indexOf('auth.js') !== -1)) return;
      scriptInfos.push({
        src: script.getAttribute('src') ? resolveForPage(script.getAttribute('src')) : null,
        text: script.textContent || '',
        type: script.type || '',
      });
      script.remove();
    });
    // Scripts run in order, each after the one before has loaded; fetched
    // one at a time that way, the run page's seven cost ~400ms. All of them
    // start loading now, in parallel, so each is in hand when its turn comes.
    document.querySelectorAll('link[data-shell-preload]').forEach(function (link) { link.remove(); });
    scriptInfos.forEach(function (info) {
      if (!info.src) return;
      var preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'script';
      preload.href = info.src;
      preload.setAttribute('data-shell-preload', '');
      document.head.appendChild(preload);
    });

    // Get the content area
    var content = document.getElementById('shell-content');
    if (!content) throw new Error('No shell-content');

    // Remove old page-specific styles
    document.querySelectorAll('style[data-shell-page]').forEach(function (s) { s.remove(); });

    // Keep route-local rules before the canonical component layer. Appending
    // them to <head> made legacy page CSS win only after client-side
    // navigation, even though a full load had the correct source order.
    var sharedComponentsLink = document.querySelector('link[href*="ui_components.css"]');
    newStyles.forEach(function (style) {
      var s = document.createElement('style');
      s.setAttribute('data-shell-page', '1');
      s.textContent = style.textContent;
      document.head.insertBefore(s, sharedComponentsLink || null);
    });

    var fragment = document.createDocumentFragment();
    while (newBody.firstChild) {
      fragment.appendChild(newBody.firstChild);
    }
    // The incoming page owns everything registered from here on.
    mountPage();
    expandSkeletonMarkers(fragment);
    content.replaceChildren(fragment);
    watchArrivals(content);

    if (opts.historyMode !== 'none') {
      history.pushState({ qym: true }, '', url);
    }

    _pendingPageProject = null;
    _routeCtx = parseRoute();
    setActiveNav(_routeCtx.page);
    updateCurrentProjectForRoute();
    if (_user) dropMissingGuessedProject();
    if (_routeCtx.explicitProject && _user && !projectExists(_routeCtx.projectSlug)
        && await loadArchivedProject(_routeCtx.projectSlug)) {
      updateCurrentProjectForRoute();
    }

    if (_routeCtx.projectSlug && _user && !projectExists(_routeCtx.projectSlug)) {
      renderProjectNotFound(_routeCtx.projectSlug);
      return false;
    }

    renderBreadcrumbs(computeBreadcrumbs(_routeCtx));
    // The new page's numbers as last seen, until it loads its own.
    clearTopbarStats();
    showRememberedTopbarStats();
    // A new page starts at the top; Back/Forward put the saved offsets back
    // once the page has rendered (restoreScrollPositions in navigateTo).
    content.scrollTop = 0;

    // Expose the shell user before page scripts run so route scripts can
    // render immediately without waiting for a second shell-ready cycle.
    window.__QYM_USER__ = _user;

    for (var i = 0; i < scriptInfos.length; i++) {
      await executeScript(scriptInfos[i]);
    }

    document.dispatchEvent(new CustomEvent('qym:shell-ready'));
    return true;
  }

  function executeScript(info) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      if (info.type) s.type = info.type;
      s.setAttribute('data-shell-exec', '1');

      if (info.src) {
        s.src = info.src;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('Failed to load script: ' + info.src)); };
        document.body.appendChild(s);
        return;
      }

      if (info.text) {
        s.textContent = info.text;
      }
      document.body.appendChild(s);
      resolve();
    });
  }

  function rebuildNavHrefs() {
    var slug = _routeCtx.projectSlug;
    if (!slug) return;
    var mapping = {
      'overview': projectUrl(slug, 'overview'),
      'charts': projectUrl(slug, 'charts'),
      'runs': projectUrl(slug),
      'models': projectUrl(slug, 'models'),
      'analysis': projectUrl(slug, 'analysis'),
      'datasets': projectUrl(slug, 'datasets'),
      'reviews': projectUrl(slug, 'reviews'),
      'traces': '#',
      'settings': projectUrl(slug, 'settings'),
    };
    document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(function (item) {
      var page = item.getAttribute('data-page');
      if (mapping[page]) item.setAttribute('href', mapping[page]);
    });
  }

  function interceptNavClicks() {
    document.addEventListener('click', function (e) {
      // A page that handled the click itself (its own in-app navigation)
      // already called preventDefault: do not navigate a second time.
      if (e.defaultPrevented) return;
      var link = e.target.closest('#qym-app a[href]');
      if (!canInterceptLink(link, e)) return;
      e.preventDefault();
      navigateTo(link.getAttribute('href'));
    });

    window.addEventListener('popstate', function () {
      clearScheduledViewStateSave();
      var event = new CustomEvent('qym:popstate', {
        cancelable: true,
        detail: { url: window.location.pathname + window.location.search },
      });
      if (!document.dispatchEvent(event)) return;
      navigateTo(window.location.pathname + window.location.search, { historyMode: 'none' });
    });
  }

  // ══════════════════════════════════════════════════
  // TOPBAR STATS
  // ══════════════════════════════════════════════════

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  // The top bar's numbers as last shown at this URL in this tab, painted when
  // the shell is built so a reload does not blank them until the page's
  // numbers load. The page's first numbers replace them. Pages also report
  // "no numbers yet" while loading, so an empty set clears remembered
  // numbers only after a grace period; leaving the page clears them at once.
  var TOPBAR_STATS_KEY = 'qym:topbar-stats:';
  var _topbarStatsRemembered = false;
  var _topbarStatsClearTimer = null;

  // Runs, Dashboard, Charts and Models show the same project numbers when
  // unfiltered: one remembered entry serves all four, so moving between
  // them never blanks the numbers.
  function topbarStatsKey() {
    var path = window.location.pathname;
    var search = window.location.search;
    var family = path.match(/^(.*\/projects\/[^/]+)(?:\/(?:overview|charts|models))?\/?$/);
    if (family && !search) return TOPBAR_STATS_KEY + family[1] + '|all';
    return TOPBAR_STATS_KEY + path + search;
  }

  function showRememberedTopbarStats() {
    var remembered = null;
    try { remembered = JSON.parse(sessionStorage.getItem(topbarStatsKey()) || 'null'); } catch (_err) { /* private mode */ }
    if (!remembered || !Array.isArray(remembered.stats) || !remembered.stats.length) return;
    setTopbarStats(remembered.stats, remembered.options);
    _topbarStatsRemembered = true;
    _topbarStatsClearTimer = setTimeout(clearTopbarStats, 5000);
  }

  // Off the screen only: what this URL showed stays remembered.
  function clearTopbarStats() {
    _topbarStatsRemembered = false;
    clearTimeout(_topbarStatsClearTimer);
    var el = document.getElementById('shell-topbar-stats');
    if (el) el.innerHTML = '';
  }

  function setTopbarStats(stats, options) {
    var el = document.getElementById('shell-topbar-stats');
    if (!el) return;
    if (!stats || !stats.length) {
      if (_topbarStatsRemembered) return;  // still loading: keep them for now
      el.innerHTML = '';
      try { sessionStorage.removeItem(topbarStatsKey()); } catch (_err) { /* private mode */ }
      return;
    }
    _topbarStatsRemembered = false;
    clearTimeout(_topbarStatsClearTimer);
    try {
      sessionStorage.setItem(topbarStatsKey(), JSON.stringify({ stats: stats, options: options || null }));
    } catch (_err) { /* private mode or full */ }
    var html = '';
    if (options && options.scope) {
      html += '<span class="topbar-stats-scope"'
        + (options.scopeTitle ? ' title="' + escAttr(options.scopeTitle) + '"' : '')
        + '>' + esc(options.scope) + '</span>';
    }
    stats.forEach(function (s) {
      html += '<div class="topbar-stat' + (s.secondary ? ' topbar-stat--secondary' : '') + '"'
        + (s.title ? ' title="' + escAttr(s.title) + '"' : '') + '>'
        + '<span class="topbar-stat-dot" style="background:' + (s.color || 'var(--accent-primary)') + '"></span>'
        + '<span class="topbar-stat-value">' + esc(String(s.value)) + '</span> ' + esc(s.label)
        + '</div>';
    });
    el.innerHTML = html;
  }

  // ══════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════

  // options.action = { label, onClick } adds one button (e.g. Undo) that runs
  // once and closes the toast; options.duration keeps it longer than 4s.
  function toast(message, type, options) {
    var container = document.getElementById('shell-toast-container');
    if (!container) return;
    options = options || {};
    var el = document.createElement('div');
    el.className = 'shell-toast' + (type ? ' ' + type : '');
    // Errors are announced at once; other toasts politely (C038).
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { el.remove(); }, 300);
    }
    var action = options.action;
    if (action && action.label && typeof action.onClick === 'function') {
      el.classList.add('shell-toast--action');
      var text = document.createElement('span');
      text.className = 'shell-toast-message';
      text.textContent = message;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'shell-toast-action';
      button.textContent = action.label;
      button.addEventListener('click', function () {
        if (dismissed) return;
        button.disabled = true;
        dismiss();
        action.onClick();
      });
      el.appendChild(text);
      el.appendChild(button);
    } else {
      el.textContent = message;
    }
    container.appendChild(el);
    setTimeout(dismiss, Math.max(1000, Number(options.duration) || 4000));
    return { element: el, dismiss: dismiss };
  }

  // ══════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════

  function init() {
    // Skip if already initialized
    if (document.getElementById('qym-app')) return;

    // The inline styles present on the initial full-page load belong to that
    // route. Mark them so the first client-side navigation removes them just
    // like styles injected by later navigations.
    document.querySelectorAll('head > style:not([data-shell-page])').forEach(function (style) {
      style.setAttribute('data-shell-page', '1');
    });

    // Parse current route
    _routeCtx = parseRoute();
    _cachedMe = readCachedMe();

    // Build shell DOM
    var wrapper = document.createElement('div');
    wrapper.className = 'qym-app';
    wrapper.id = 'qym-app';

    // Sidebar
    var sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.id = 'qym-sidebar';
    sidebar.dataset.userRole = _cachedMe ? (_cachedMe.role || '') : '';
    if (!_routeCtx.projectSlug) sidebar.classList.add('no-project');
    sidebar.innerHTML = buildSidebarHTML();

    // Main area
    var mainArea = document.createElement('div');
    mainArea.className = 'main-area';

    // Topbar
    var topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = buildTopbarHTML();

    // Content area — move existing body children here
    var content = document.createElement('main');
    content.className = 'shell-content';
    content.id = 'shell-content';

    // Move all existing body children into the content area
    while (document.body.firstChild) {
      content.appendChild(document.body.firstChild);
    }

    // Read-only notice of an archived project (renderArchivedNotice).
    var archivedNotice = document.createElement('div');
    archivedNotice.className = 'shell-archived-notice';
    archivedNotice.id = 'shell-archived-notice';
    archivedNotice.setAttribute('role', 'note');
    archivedNotice.hidden = true;

    // Assemble
    mainArea.appendChild(topbar);
    mainArea.appendChild(archivedNotice);
    mainArea.appendChild(content);
    wrapper.appendChild(sidebar);
    wrapper.appendChild(mainArea);
    document.body.appendChild(wrapper);

    // Toast container
    var toastContainer = document.createElement('div');
    toastContainer.className = 'shell-toast-container';
    toastContainer.id = 'shell-toast-container';
    // Screen readers announce toasts; errors interrupt (role=alert per toast).
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastContainer);

    // Restore collapse state
    restoreCollapseState();

    // Set active nav
    setActiveNav(_routeCtx.page);

    // The user menu as last seen, until /v1/me answers.
    if (_cachedMe) populateUser(_cachedMe);

    // Render initial breadcrumbs
    renderBreadcrumbs(computeBreadcrumbs(_routeCtx));
    showRememberedTopbarStats();

    // The page's loading spots become skeletons before its first frame.
    expandSkeletonMarkers(document);
    watchArrivals(document);

    // The shell is whole: the page shows inside it from this frame on.
    endShellPending();

    // Keep the entry's saved view state across a reload, and keep saving the
    // scroll offsets while the reader scrolls (Back from the next page can
    // no longer read them).
    var initialState = history.state && typeof history.state === 'object' ? history.state : {};
    history.replaceState(Object.assign({}, initialState, { qym: true }), '', window.location.href);
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (Array.isArray(initialState.qymScroll) && initialState.qymScroll.length) {
      document.addEventListener('qym:shell-ready', function () {
        restoreScrollPositions(initialState.qymScroll);
      }, { once: true });
    }
    document.addEventListener('scroll', scheduleHistoryViewStateSave, { capture: true, passive: true });
    window.addEventListener('pagehide', saveHistoryViewState);

    // Bind events
    bindEvents();

    // Intercept nav clicks for SPA-like navigation
    interceptNavClicks();

    // Fetch user and projects
    fetchUserAndProjects();
  }

  async function fetchUserAndProjects() {
    try {
      var res = await fetch(apiUrl('v1/me'), { credentials: 'same-origin' });
      if (res.status === 401) {
        forgetCachedMe();
        if (window.QymAuth) window.QymAuth.redirectToLogin();
        return;
      }
      if (!res.ok) return;
      _user = await res.json();
      _projects = _user.projects || [];
      cacheMe(_user);
      // An archived project named in the URL opens read-only. Load it before
      // pages see the user, so they start from the right project.
      if (_routeCtx.explicitProject && !projectExists(_routeCtx.projectSlug)) {
        await loadArchivedProject(_routeCtx.projectSlug);
      }
      window.__QYM_USER__ = _user;
      populateUser(_user);

      // Fetch all projects for the switcher
      updateCurrentProjectForRoute();
      dropMissingGuessedProject();
      if (_pendingPageProject) setPageProject(_pendingPageProject);
      if (_routeCtx.projectSlug && !projectExists(_routeCtx.projectSlug)) {
        renderProjectNotFound(_routeCtx.projectSlug);
        return;
      }
      renderBreadcrumbs(computeBreadcrumbs(_routeCtx));
      renderProjectList();

    } catch (e) {
      console.error('[QymShell] Failed to fetch user:', e);
    }

    // Signal that shell is ready
    document.dispatchEvent(new CustomEvent('qym:shell-ready'));
  }

  // ══════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════

  // Deterministic entity identicon (datasets, projects, ...): an FNV-1a hash
  // of the seed picks a hue (continuous, 0-360 — quantized palettes made
  // unrelated entities share colors) and a horizontally symmetric 5x5 fill
  // pattern, so the same seed renders the same mark on every page and two
  // different seeds practically never render the same one.
  function identiconHTML(seed, opts) {
    opts = opts || {};
    var cell = opts.cell || 10;
    var gap = opts.gap != null ? opts.gap : 3;
    var s = String(seed || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h >>>= 0;
    var hue = h % 360;
    var palette = ['hsl(' + hue + ', 66%, 58%)', 'hsl(' + hue + ', 70%, 40%)'];
    var halves = [];
    var bits = h, filled = 0;
    for (var row = 0; row < 5; row++) {
      halves.push([null, null, null]);
      for (var col = 0; col < 3; col++) {
        bits = Math.imul(bits ^ (row * 3 + col + 0x9e3779b9), 16777619) >>> 0;
        bits = (bits ^ (bits >>> 13)) >>> 0;
        var v = bits % 4;
        halves[row][col] = v >= 2 ? palette[v - 2] : null;
        if (halves[row][col]) filled++;
      }
    }
    // Very sparse patterns read as near-identical specks — densify from the
    // same full-entropy stream (position AND shade) until the mark has body.
    for (var k = 0; filled < 4 && k < 30; k++) {
      bits = Math.imul(bits ^ (k + 0x85ebca6b), 16777619) >>> 0;
      bits = (bits ^ (bits >>> 13)) >>> 0;
      var at = bits % 15;
      var fr = (at / 3) | 0, fc = at % 3;
      if (!halves[fr][fc]) { halves[fr][fc] = palette[bits % 2]; filled++; }
    }
    var rows = halves.map(function (half) { return [half[0], half[1], half[2], half[1], half[0]]; });
    var radius = Math.max(1, Math.round(cell / 5));
    var cells = '';
    rows.forEach(function (cols) {
      cols.forEach(function (color) {
        var bg = color ? ';background:' + color : (opts.showEmpty === false ? ';background:transparent' : '');
        cells += '<i style="border-radius:' + radius + 'px' + bg + '"></i>';
      });
    });
    var style = 'grid-template-columns:repeat(5,' + cell + 'px);grid-auto-rows:' + cell + 'px;gap:' + gap + 'px';
    var cls = 'qym-identicon' + (opts.className ? ' ' + esc(opts.className) : '');
    var mark = '<span class="' + cls + '" aria-hidden="true" style="' + style + '">' + cells + '</span>';
    if (!opts.chip) return mark;
    // Small rounded container for inline/text contexts where a bare mark
    // reads as noise (run meta lines, pickers, ...).
    var size = 5 * cell + 4 * gap + 6;
    return '<span class="qym-identicon-chip" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px">' + mark + '</span>';
  }
  function identicon(seed, opts) {
    var host = document.createElement('span');
    host.innerHTML = identiconHTML(seed, opts);
    return host.firstChild;
  }

  // The resolved version label, meant to sit INSIDE the dataset-name block — a divider +
  // muted mono style makes it visually distinct from the name. Empty for ad-hoc/CSV runs.
  function datasetVersionInline(version) {
    return version ? '<span class="ds-version" title="Dataset version">' + esc(version) + '</span>' : '';
  }
  // Trailing alias tags for a dataset reference (production shown as "prod"), placed AFTER
  // the name block. Empty when there are no aliases.
  function datasetAliasTags(aliases) {
    var list = Array.isArray(aliases) ? aliases : [];
    var html = '';
    list.forEach(function (a) {
      var label = a === 'production' ? 'prod' : a;
      var cls = 'ds-alias' + (a === 'production' ? ' production' : '');
      html += '<span class="' + cls + '" title="' + esc(a) + '">' + esc(label) + '</span>';
    });
    return html;
  }

  // ══════════════════════════════════════════════════
  // PAGE ARRIVAL (shell.css "PAGE ARRIVAL")
  // ══════════════════════════════════════════════════

  // Loading, timed so a quick load never flashes (shell.css "PAGE ARRIVAL"):
  // a skeleton waits SKELETON_DELAY_MS before it fades in, so a load quicker
  // than that shows none; one that did show stays at least SKELETON_MIN_MS;
  // and content fades in only where a skeleton the reader saw leaves
  // (arrive), otherwise it is simply there and only its charts move.
  var SKELETON_DELAY_MS = 300;
  var SKELETON_MIN_MS = 400;
  var SKELETON_FADE_MS = 200;
  // When the current load started: the page's navigation (0 on a full load).
  var _loadStartedAt = 0;
  function skeletonWait(since) {
    return Math.round(SKELETON_DELAY_MS - (performance.now() - since)) + 'ms';
  }

  // A loading skeleton in a page's own layout: 'table' (a toolbar line and
  // rows), 'cards' (a grid of cards), 'list' (stacked rows), 'lines' (rows
  // inside a table or card), 'chart' (a headline and bars) or 'value' (one
  // number). `label` is
  // what a screen reader hears ("Loading runs…"). Its wait counts from
  // `since` (a performance.now() time; default now), or from the page's
  // navigation when `immediate` (one drawn after the page's first frame as
  // part of its load, e.g. redrawn with its section: it shows when the
  // page's other skeletons do, never blinking out and back).
  function skeletonHTML(kind, options) {
    var opts = options || {};
    var bone = function (style) { return '<span class="qym-skeleton__bone"' + (style ? ' style="' + style + '"' : '') + '></span>'; };
    var html = '';
    var i;
    var wrapperClass = '';
    var wrapperStyle = '';
    if (kind === 'value') {
      // Inline, in the text's own line: the number replaces it without the
      // line growing or shrinking.
      wrapperClass = ' qym-skeleton--inline';
      html = bone('display:inline-block;vertical-align:-0.1em;width:' + (opts.width || 64) + 'px;height:0.8em');
    } else if (kind === 'lines') {
      for (i = 0; i < (opts.rows || 3); i++) {
        html += '<div class="qym-skeleton__row">' + bone('width:' + (30 + (i * 19) % 25) + '%') + bone('width:14%') + bone('width:12%;margin-left:auto') + '</div>';
      }
      // `height`: the content's usual height, so it neither grows nor shrinks
      // when the rows arrive.
      if (opts.height) wrapperStyle = 'height:' + opts.height + 'px;gap:0;justify-content:space-evenly';
    } else if (kind === 'chart') {
      var bars = '';
      for (i = 0; i < (opts.count || 14); i++) {
        bars += bone('flex:1;height:' + (28 + (i * 37) % 62) + '%;border-radius:3px 3px 1px 1px');
      }
      html = '<div class="qym-skeleton__row">' + bone('width:120px;height:18px') + bone('width:80px') + '</div>'
        + '<div class="qym-skeleton__row" style="align-items:flex-end;height:' + (opts.height || 160) + 'px">' + bars + '</div>';
    } else if (kind === 'cards') {
      var count = opts.count || 6;
      var cards = '';
      for (i = 0; i < count; i++) {
        cards += '<div class="qym-skeleton__card">'
          + '<div class="qym-skeleton__row">' + bone('width:36px;height:36px;border-radius:8px') + bone('width:40%;height:14px') + '</div>'
          + bone('width:70%') + bone('width:55%')
          + '<div class="qym-skeleton__row" style="margin-top:auto">' + bone('width:30%;height:10px') + bone('width:20%;height:10px') + '</div>'
          + '</div>';
      }
      html = '<div class="qym-skeleton__grid"'
        + (opts.minWidth ? ' style="--qym-skeleton-card-min:' + opts.minWidth + 'px;--qym-skeleton-card-h:' + (opts.height || 160) + 'px"'
          : (opts.height ? ' style="--qym-skeleton-card-h:' + opts.height + 'px"' : ''))
        + '>' + cards + '</div>';
    } else if (kind === 'list') {
      for (i = 0; i < (opts.rows || 6); i++) {
        html += '<div class="qym-skeleton__card" style="min-height:0;padding:var(--space-md)">'
          + '<div class="qym-skeleton__row">' + bone('width:' + (38 + (i * 17) % 30) + '%;height:13px') + bone('width:12%;margin-left:auto') + '</div>'
          + bone('width:' + (55 + (i * 23) % 35) + '%;height:10px')
          + '</div>';
      }
    } else {
      var rows = '<div class="qym-skeleton__table-row qym-skeleton__table-row--head">' + bone() + bone() + bone() + bone() + bone() + bone() + '</div>';
      for (i = 0; i < (opts.rows || 10); i++) {
        rows += '<div class="qym-skeleton__table-row">'
          + bone('width:' + (55 + (i * 29) % 40) + '%') + bone('width:70%') + bone('width:60%') + bone('width:50%') + bone('width:65%') + bone('width:40%')
          + '</div>';
      }
      html = (opts.toolbar === false ? '' : '<div class="qym-skeleton__row">' + bone('width:220px;height:24px') + bone('width:90px;height:24px') + bone('width:90px;height:24px') + '</div>')
        + '<div class="qym-skeleton__table">' + rows + '</div>';
    }
    var since = typeof opts.since === 'number' ? opts.since : (opts.immediate ? _loadStartedAt : performance.now());
    wrapperStyle = '--qym-skeleton-wait:' + skeletonWait(since) + (wrapperStyle ? ';' + wrapperStyle : '');
    var tag = kind === 'value' ? 'span' : 'div';
    return '<' + tag + ' class="qym-skeleton' + wrapperClass + '" role="status"'
      + ' style="' + wrapperStyle + '">'
      + '<span class="qym-skeleton__label">' + esc(opts.label || 'Loading…') + '</span>'
      + '<' + tag + ' aria-hidden="true" style="display:contents">' + html + '</' + tag + '>'
      + '</' + tag + '>';
  }

  // A page marks where its content will load with data-qym-skeleton="table"
  // (or "cards" / "list"), plus data-qym-skeleton-label, -rows, -count,
  // -height; the shell fills each with its skeleton before the page's first
  // frame, on a full load (init) and on in-app navigation (swapPage).
  function expandSkeletonMarkers(root) {
    if (!root || !root.querySelectorAll) return;
    // A heading that names the project shows the name from its first frame
    // (the remembered one until /v1/me answers), not a placeholder title.
    var project = _currentProject || rememberedRouteProject(_routeCtx);
    if (project && project.name) {
      root.querySelectorAll('[data-qym-project-name]').forEach(function (node) { node.textContent = project.name; });
    }
    root.querySelectorAll('[data-qym-skeleton]').forEach(function (marker) {
      var number = function (name) { var value = parseInt(marker.getAttribute('data-qym-skeleton-' + name), 10); return value > 0 ? value : undefined; };
      // One page, two layouts by route: data-qym-skeleton-match (a pattern
      // on the path) picks data-qym-skeleton-match-kind instead.
      var kind = marker.getAttribute('data-qym-skeleton');
      var match = marker.getAttribute('data-qym-skeleton-match');
      try {
        if (match && new RegExp(match).test(window.location.pathname)) kind = marker.getAttribute('data-qym-skeleton-match-kind') || kind;
      } catch (_err) { /* a bad pattern keeps the default */ }
      marker.innerHTML = skeletonHTML(kind, {
        since: _loadStartedAt,
        label: marker.getAttribute('data-qym-skeleton-label') || undefined,
        rows: number('rows'), count: number('count'), height: number('height'), minWidth: number('min-width'), width: number('width'),
        toolbar: marker.getAttribute('data-qym-skeleton-toolbar') !== 'false',
      });
      marker.removeAttribute('data-qym-skeleton');
    });
    // A page's own skeleton (data-qym-skeleton-root) keeps the same clock.
    root.querySelectorAll('[data-qym-skeleton-root]').forEach(function (skeleton) {
      skeleton.style.setProperty('--qym-skeleton-wait', skeletonWait(_loadStartedAt));
    });
  }

  // A skeleton is "shown" once its fade-in starts (after its wait).
  document.addEventListener('animationstart', function (event) {
    var target = event.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('qym-skeleton') || target.hasAttribute('data-qym-skeleton-root')) {
      target.dataset.qymShownAt = String(performance.now() - (event.elapsedTime || 0) * 1000);
    }
  }, true);
  function shownFor(skeleton) {
    return skeleton.dataset.qymShownAt ? performance.now() - Number(skeleton.dataset.qymShownAt) : 0;
  }

  // A skeleton the reader saw, leaving (`ghost`: it, or a copy of it):
  // laid over the page at `box`, kept until it has been up SKELETON_MIN_MS,
  // then faded out while the content fades in under it (arrive, which
  // waits as long).
  var _seenSkeleton = null;
  function retireShownSkeleton(ghost, box, opacity, visibleFor) {
    var wait = Math.max(0, Math.round(SKELETON_MIN_MS - visibleFor));
    ghost.removeAttribute('id');
    ghost.removeAttribute('role');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('qym-skeleton-leaving');
    Object.assign(ghost.style, {
      top: box.top + 'px', left: box.left + 'px', width: box.width + 'px',
      animation: 'none', opacity: String(opacity),
    });
    document.body.appendChild(ghost);
    ghost.getBoundingClientRect();  // commit the start opacity
    ghost.style.opacity = wait > 0 ? '1' : '0';
    if (wait > 0) setTimeout(function () { ghost.style.opacity = '0'; }, wait);
    setTimeout(function () { ghost.remove(); }, wait + 260);
    // What arrives in this same task fades in, after that wait.
    if (!_seenSkeleton) {
      _seenSkeleton = { wait: 0 };
      setTimeout(function () { _seenSkeleton = null; }, 0);
    }
    _seenSkeleton.wait = Math.max(_seenSkeleton.wait, wait);
  }

  // A skeleton just replaced by the content (watchArrivals): laid back over
  // its container if the reader saw it.
  function fadeOutRemovedSkeleton(skeleton, container) {
    var visibleFor = shownFor(skeleton);
    var opacity = Math.min(1, visibleFor / SKELETON_FADE_MS);
    if (opacity < 0.05) return;
    var box = container.getBoundingClientRect();
    var style = getComputedStyle(container);
    retireShownSkeleton(skeleton, {
      top: box.top + parseFloat(style.paddingTop || 0),
      left: box.left + parseFloat(style.paddingLeft || 0),
      width: Math.max(0, box.width - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0)),
    }, opacity, visibleFor);
  }

  // For a page that redraws a region in place: the skeletons on screen in
  // it before the redraw, then those the redraw removed, laid back where
  // they stood (as fadeOutRemovedSkeleton).
  function noteSkeletons(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.map.call(root.querySelectorAll('.qym-skeleton'), function (skeleton) {
      return { skeleton: skeleton, box: skeleton.getBoundingClientRect(), opacity: parseFloat(getComputedStyle(skeleton).opacity) || 0 };
    }).filter(function (note) { return note.opacity >= 0.05 && note.box.width > 0; });
  }
  function retireRemovedSkeletons(notes) {
    (notes || []).forEach(function (note) {
      if (!note.skeleton.isConnected) retireShownSkeleton(note.skeleton, note.box, note.opacity, shownFor(note.skeleton));
    });
  }

  // Containers marked data-qym-arrive arrive (QymShell.arrive) the moment
  // the page first renders into them, i.e. when their last skeleton is
  // replaced: no page code needed. Set up when the page's DOM is placed,
  // before its scripts render (init; swapPage).
  function watchArrivals(root) {
    if (!root || !root.querySelectorAll || typeof MutationObserver !== 'function') return;
    root.querySelectorAll('[data-qym-arrive]').forEach(function (container) {
      if (container.dataset.qymArriveWatched || !container.querySelector('.qym-skeleton')) return;
      container.dataset.qymArriveWatched = '1';
      var observer = new MutationObserver(function (mutations) {
        var removed = null;
        mutations.forEach(function (mutation) {
          mutation.removedNodes.forEach(function (node) {
            if (removed || node.nodeType !== 1) return;
            removed = node.classList.contains('qym-skeleton') ? node : node.querySelector('.qym-skeleton');
          });
        });
        if (!removed || container.querySelector('.qym-skeleton')) return;
        observer.disconnect();
        if (container.isConnected) fadeOutRemovedSkeleton(removed, container);
        arrive(container);
      });
      observer.observe(container, { childList: true, subtree: true });
    });
  }

  // Before content replaces a skeleton: one the reader can see is laid over
  // the page and stays its minimum, then fades out while the content fades
  // in, so there is no blank frame between them. One still waiting to show
  // simply goes. `container` may itself be the skeleton (a page's own, with
  // data-qym-skeleton-root).
  function liftSkeleton(container) {
    var root = container || document;
    var skeletons = [];
    if (root.matches && root.matches('.qym-skeleton, [data-qym-skeleton-root]')) skeletons.push(root);
    if (root.querySelectorAll) Array.prototype.push.apply(skeletons, root.querySelectorAll('.qym-skeleton'));
    skeletons.forEach(function (skeleton) {
      if (!skeleton.isConnected) return;
      var opacity = parseFloat(getComputedStyle(skeleton).opacity) || 0;
      var box = skeleton.getBoundingClientRect();
      if (opacity < 0.05 || !box.width) return;
      retireShownSkeleton(skeleton.cloneNode(true), box, opacity, shownFor(skeleton));
    });
  }

  // The content's arrival, once per element per page load: its bars grow
  // and tracks draw (shell.css); where a skeleton the reader saw just left,
  // it also fades in, once that skeleton's minimum is up. Ends when the
  // beat is over or at the reader's first click or key, so nothing they
  // cause replays it. Bars that grow get their place for the left-to-right
  // sweep.
  var ARRIVE_MS = 700;
  function arrive(element) {
    if (!element || element.dataset.qymArrived) return;
    element.dataset.qymArrived = '1';
    element.classList.remove('qym-await');
    var groups = new Map();
    element.querySelectorAll('.qym-arrive-bar, .dist-chart-col .bar-fill').forEach(function (bar) {
      var group = bar.closest('.dist-chart, [data-qym-arrive-group]') || bar.parentElement;
      var index = groups.get(group) || 0;
      groups.set(group, index + 1);
      bar.style.setProperty('--qym-arrive-i', String(Math.min(index, 10)));
    });
    var wait = _seenSkeleton ? _seenSkeleton.wait : 0;
    element.style.setProperty('--qym-arrive-wait', wait + 'ms');
    if (_seenSkeleton) element.classList.add('qym-arriving--fade');
    element.classList.add('qym-arriving');
    var timer = null;
    var settle = function () {
      clearTimeout(timer);
      element.classList.remove('qym-arriving', 'qym-arriving--fade');
      element.style.removeProperty('--qym-arrive-wait');
      document.removeEventListener('pointerdown', settle, true);
      document.removeEventListener('keydown', settle, true);
    };
    timer = setTimeout(settle, ARRIVE_MS + wait);
    document.addEventListener('pointerdown', settle, true);
    document.addEventListener('keydown', settle, true);
  }

  // For a page with its own entrance (the run page): whether content
  // arriving now replaces a skeleton the reader saw ({ wait } in ms before
  // it fades in), or null.
  function pendingArrival() {
    return _seenSkeleton ? { wait: _seenSkeleton.wait } : null;
  }

  // A page whose content is built hidden behind a separate skeleton block:
  // the skeleton goes (fading out under it if it was on screen) and the
  // content shows and arrives.
  function reveal(skeleton, content) {
    if (skeleton && skeleton.isConnected) {
      liftSkeleton(skeleton);
      skeleton.remove();
    }
    if (!content) return;
    content.hidden = false;
    arrive(content);
  }

  // Ends an arrival now: content redrawn during it shows in its final state
  // instead of fading and drawing again.
  function settleArrival(element) {
    if (element) element.classList.remove('qym-arriving');
  }

  // Both, around a page's first render of its content.
  function arriveWith(container, render) {
    liftSkeleton(container);
    var result = render();
    arrive(container);
    return result;
  }

  window.QymShell = {
    init: init,
    skeletonHTML: skeletonHTML,
    liftSkeleton: liftSkeleton,
    arrive: arrive,
    arriveWith: arriveWith,
    watchArrivals: watchArrivals,
    reveal: reveal,
    settleArrival: settleArrival,
    noteSkeletons: noteSkeletons,
    retireRemovedSkeletons: retireRemovedSkeletons,
    pendingArrival: pendingArrival,
    takePrefetch: takePrefetch,
    identicon: identicon,
    identiconHTML: identiconHTML,
    datasetVersionInline: datasetVersionInline,
    datasetAliasTags: datasetAliasTags,
    getUser: function () { return _user; },
    getProject: function () { return _currentProject; },
    // The current project, or before /v1/me answers the one this URL names
    // as last seen ({slug, name}): for labels a page draws at once.
    getRememberedProject: function () { return _currentProject || rememberedRouteProject(_routeCtx); },
    getPageContext: function () { return _routeCtx; },
    switchProject: switchProject,
    setTopbarStats: setTopbarStats,
    setBreadcrumbs: renderBreadcrumbs,
    toggleSidebar: toggleSidebar,
    toast: toast,
    apiUrl: apiUrl,
    navigateTo: navigateTo,
    pageSignal: pageSignal,
    onPageUnmount: onPageUnmount,
    replaceUrlQuery: replaceUrlQuery,
    copyText: copyText,
    openCreateProjectDialog: openCreateProjectDialog,
    openConfirmDialog: openConfirmDialog,
    confirmArchiveProject: confirmArchiveProject,
    confirmUnarchiveProject: confirmUnarchiveProject,
    isProjectArchived: isProjectArchived,
    upsertProject: upsertProject,
    removeProject: removeProject,
    projectExists: projectExists,
    setPageProject: setPageProject,
    renderProjectNotFound: renderProjectNotFound,
    openFormDialog: openFormDialog,
    openDrawer: openDrawer,
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
