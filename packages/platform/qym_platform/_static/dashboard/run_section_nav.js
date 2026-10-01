/**
 * Run page sticky section nav (C058).
 *
 * One row under the run header: the run name and status (once stuck), a link
 * per section with an underline on the section in view (scroll-spy), the item
 * Filters + Clear (owned by run.html) and back to top. Sections are marked by
 * their header: any element with ``data-run-section="<key>"`` inside the
 * page content. Links name the keys they jump to with
 * ``data-run-section-link``; sections without a link (repeat analysis, root
 * cause) count as part of the linked section above them.
 *
 * The page re-renders sections above the reader when a filter changes. The
 * nav keeps the section the reader is in still: it remembers where that
 * section's header sat and restores it after every DOM change, until the
 * reader scrolls again.
 *
 * shell.js re-runs page scripts on in-app navigation: no top-level
 * const/let/class, and every listener is bound to this page's elements.
 */
(function () {
  'use strict';

  var GAP_BELOW_NAV = 16;      // px between the stuck nav and a jumped-to header
  var SPY_LINE_OFFSET = 64;    // px below the nav where the active section starts
  var SETTLE_MS = 250;         // scrolls this soon after a DOM change are layout clamps

  function create(options) {
    var host = options.scrollHost;
    var content = options.content;
    var nav = options.nav;
    if (!host || !content || !nav) return null;
    var links = nav.querySelector('.run-section-nav__links');
    var ink = nav.querySelector('.run-section-nav__ink');
    var identity = nav.querySelector('.run-section-nav__identity');
    var topButton = nav.querySelector('.run-section-nav__top');

    var currentKey = null;
    var anchor = null;            // {key, offset}: header position to keep
    var domChangedAt = 0;
    var userIntentAt = 0;
    var programmatic = false;     // our own smooth scroll is running
    var programmaticTimer = null;
    var refreshQueued = false;

    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

    function isShown(element) {
      return !!element && element.isConnected && element.getClientRects().length > 0;
    }

    function heads() {
      return Array.prototype.filter.call(content.querySelectorAll('[data-run-section]'), function (head) {
        return !nav.contains(head) && isShown(head);
      });
    }

    function linkFor(key) {
      return links ? links.querySelector('[data-run-section-link="' + key + '"]') : null;
    }

    function linkedHeads() {
      return heads().filter(function (head) { return !!linkFor(head.getAttribute('data-run-section')); });
    }

    function headFor(key) {
      var all = heads();
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-run-section') === key) return all[i];
      }
      return null;
    }

    // Top of an element in the scroll host's content coordinates.
    function contentTop(element) {
      return host.scrollTop + element.getBoundingClientRect().top - host.getBoundingClientRect().top;
    }

    // Height the nav covers at the top of the scroll host once stuck. A
    // sticky box sticks inside the host's padding, offset by its own top
    // (negative here, so it also hides that padding).
    function stuckHeight() {
      var top = parseFloat(getComputedStyle(nav).top) || 0;
      var padding = parseFloat(getComputedStyle(host).paddingTop) || 0;
      return Math.max(0, padding + top + nav.offsetHeight);
    }

    function setScrollTop(value) {
      var next = Math.max(0, Math.round(value));
      if (Math.abs(host.scrollTop - next) > 1) host.scrollTop = next;
    }

    // ---- keep the reader's section still -------------------------------

    function resolveAnchorHead() {
      if (!anchor) return null;
      var head = headFor(anchor.key);
      if (head) return head;
      // The section went away (no errors left, say): keep the next one still.
      var order = anchor.order || [];
      var start = order.indexOf(anchor.key);
      for (var i = start + 1; start >= 0 && i < order.length; i++) {
        head = headFor(order[i]);
        if (head) return head;
      }
      return null;
    }

    function pin() {
      if (!anchor) return;
      var head = resolveAnchorHead();
      if (!head) return;
      setScrollTop(contentTop(head) - anchor.offset);
    }

    // The header of the section being read: the last one (with a nav link
    // or not) that starts above the reading line.
    function readingHead() {
      var line = host.scrollTop + stuckHeight() + SPY_LINE_OFFSET;
      var found = null;
      heads().forEach(function (head) {
        if (!found || contentTop(head) <= line) found = head;
      });
      return found;
    }

    function rememberAnchor() {
      var head = host.scrollTop > 0 ? readingHead() : null;
      if (!head) { anchor = null; return; }
      anchor = {
        key: head.getAttribute('data-run-section'),
        offset: contentTop(head) - host.scrollTop,
        order: Array.prototype.map.call(content.querySelectorAll('[data-run-section]'), function (node) {
          return node.getAttribute('data-run-section');
        }),
      };
    }

    function endProgrammatic() {
      programmatic = false;
      if (programmaticTimer) { clearTimeout(programmaticTimer); programmaticTimer = null; }
    }

    function startProgrammatic() {
      programmatic = true;
      if (programmaticTimer) clearTimeout(programmaticTimer);
      // scrollend is not everywhere; a smooth scroll is over well within this.
      programmaticTimer = setTimeout(endProgrammatic, 1200);
    }

    // ---- scroll-spy -----------------------------------------------------

    function moveInk() {
      if (!ink) return;
      var link = currentKey ? linkFor(currentKey) : null;
      if (!link || !isShown(link)) { ink.style.width = '0px'; return; }
      ink.style.width = link.offsetWidth + 'px';
      ink.style.transform = 'translateX(' + link.offsetLeft + 'px)';
    }

    function spy() {
      var stuck = host.scrollTop > 0 && nav.getBoundingClientRect().top <= host.getBoundingClientRect().top + 1;
      if (nav.classList.contains('is-stuck') !== stuck) nav.classList.toggle('is-stuck', stuck);
      var shown = linkedHeads();
      var key = null;
      if (shown.length) {
        var line = host.scrollTop + stuckHeight() + SPY_LINE_OFFSET;
        key = shown[0].getAttribute('data-run-section');
        shown.forEach(function (head) {
          if (contentTop(head) <= line) key = head.getAttribute('data-run-section');
        });
        if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) {
          key = shown[shown.length - 1].getAttribute('data-run-section');
        }
      }
      if (key !== currentKey) {
        currentKey = key;
        Array.prototype.forEach.call(links ? links.querySelectorAll('[data-run-section-link]') : [], function (link) {
          var active = link.getAttribute('data-run-section-link') === key;
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
        var activeLink = key ? linkFor(key) : null;
        if (activeLink && links && links.scrollWidth > links.clientWidth) {
          var left = activeLink.offsetLeft;
          if (left < links.scrollLeft || left + activeLink.offsetWidth > links.scrollLeft + links.clientWidth) {
            links.scrollLeft = Math.max(0, left - 16);
          }
        }
      }
      moveInk();
    }

    // ---- links, counts and identity --------------------------------------

    function refresh() {
      refreshQueued = false;
      var shownKeys = {};
      heads().forEach(function (head) { shownKeys[head.getAttribute('data-run-section')] = true; });
      Array.prototype.forEach.call(links ? links.querySelectorAll('[data-run-section-link]') : [], function (link) {
        var hidden = !shownKeys[link.getAttribute('data-run-section-link')];
        if (link.hidden !== hidden) link.hidden = hidden;
      });
      if (identity) {
        var nameSource = document.querySelector('.hero-run-name');
        var nameTarget = identity.querySelector('.run-section-nav__name');
        var name = nameSource ? nameSource.textContent : '';
        if (nameTarget && nameTarget.textContent !== name) {
          nameTarget.textContent = name;
          nameTarget.title = name;
        }
        var statusSource = document.querySelector('.hero-status');
        var statusTarget = identity.querySelector('.run-section-nav__status');
        if (statusTarget) {
          var statusText = statusSource ? statusSource.textContent.trim() : '';
          if (statusTarget.textContent !== statusText) {
            statusTarget.textContent = statusText;
            statusTarget.className = 'run-section-nav__status qym-badge ' +
              (statusSource ? Array.prototype.filter.call(statusSource.classList, function (name) {
                return name !== 'hero-status' && name !== 'qym-badge';
              }).join(' ') : '');
            statusTarget.hidden = !statusText;
          }
        }
      }
      spy();
    }

    function scheduleRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      window.requestAnimationFrame(refresh);
    }

    function setCount(key, text, tone) {
      var link = linkFor(key);
      if (!link) return;
      var slot = link.querySelector('.run-section-nav__count');
      if (!slot) return;
      var value = text == null ? '' : String(text);
      if (slot.textContent !== value) slot.textContent = value;
      slot.hidden = !value;
      var danger = tone === 'danger';
      if (slot.classList.contains('qym-tag--danger') !== danger) slot.classList.toggle('qym-tag--danger', danger);
      scheduleRefresh();
    }

    // ---- jumping ------------------------------------------------------------

    function scrollToSection(key, opts) {
      var head = headFor(key);
      if (!head) return false;
      var behavior = (opts && opts.behavior) || 'smooth';
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
      var first = linkedHeads()[0];
      var offset = stuckHeight() + GAP_BELOW_NAV;
      var top = head === first ? 0 : contentTop(head) - offset;
      // Hold the destination: re-renders during the scroll cannot pull it back.
      anchor = top <= 0 ? null : {
        key: key,
        offset: offset,
        order: Array.prototype.map.call(content.querySelectorAll('[data-run-section]'), function (node) {
          return node.getAttribute('data-run-section');
        }),
      };
      if (behavior === 'smooth') startProgrammatic();
      host.scrollTo({ top: Math.max(0, top), behavior: behavior });
      if (behavior !== 'smooth') spy();
      return true;
    }

    function onNavClick(event) {
      var link = event.target.closest('[data-run-section-link]');
      if (link && nav.contains(link)) {
        event.preventDefault();
        scrollToSection(link.getAttribute('data-run-section-link'));
        return;
      }
      if (topButton && event.target.closest('.run-section-nav__top') === topButton) {
        anchor = null;
        startProgrammatic();
        host.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    // ---- events ---------------------------------------------------------------

    function onUserIntent() {
      userIntentAt = now();
      endProgrammatic();
    }

    function onScroll() {
      spy();
      if (programmatic) return;
      var t = now();
      // A scroll right after a re-render is the browser clamping or our own
      // pin, not the reader moving: keep the remembered position.
      if (t - domChangedAt < SETTLE_MS && t - userIntentAt > SETTLE_MS) return;
      rememberAnchor();
    }

    var observer = new MutationObserver(function (records) {
      var relevant = records.some(function (record) {
        return !nav.contains(record.target);
      });
      if (!relevant) return;
      domChangedAt = now();
      // Microtask after the change, before paint: no frame shows the jump.
      pin();
      scheduleRefresh();
    });
    observer.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'hidden'],
    });

    host.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('wheel', onUserIntent, { passive: true });
    host.addEventListener('touchstart', onUserIntent, { passive: true });
    host.addEventListener('keydown', onUserIntent);
    host.addEventListener('pointerdown', function (event) {
      // Dragging the scrollbar: a pointerdown on the host itself.
      if (event.target === host) onUserIntent();
    });
    if ('onscrollend' in window) host.addEventListener('scrollend', endProgrammatic);
    nav.addEventListener('click', onNavClick);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { moveInk(); }).observe(nav);
    }
    window.addEventListener('resize', scheduleRefresh);

    refresh();

    return {
      setCount: setCount,
      scrollToSection: scrollToSection,
      // The page is about to scroll somewhere itself (a deep-linked item):
      // hold nothing until that scroll is over.
      yieldToScroll: function () { anchor = null; startProgrammatic(); },
    };
  }

  window.QymRunSectionNav = { create: create };
})();
