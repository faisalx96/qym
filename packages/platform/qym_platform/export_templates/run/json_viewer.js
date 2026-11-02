/**
 * QymJsonViewer — a reusable, dependency-free JSON viewer.
 *
 *   QymJsonViewer.parse(value)            The object/array behind a value: the
 *                                         value itself, or a string holding
 *                                         JSON. null for scalars, empty
 *                                         containers and invalid JSON.
 *   QymJsonViewer.preview(data, max)      One-line compact text of the data.
 *   QymJsonViewer.summary(data)           "3 keys" / "5 items".
 *   QymJsonViewer.previewHtml(value, opts) Markup for a clickable preview
 *                                         button; '' when the value is not
 *                                         structured. opts: {title, className}.
 *   QymJsonViewer.createTree(data, opts)  A collapsible, syntax-colored tree
 *                                         element. opts: {expandDepth}.
 *   QymJsonViewer.open(value, opts)       The tree in a modal, with expand /
 *                                         collapse all and copy. opts: {title}.
 *
 * Any element with [data-qjv-json] opens the viewer on click; the attribute
 * holds the JSON text and [data-qjv-title] the modal title. That keeps the
 * preview working across innerHTML re-renders without rebinding.
 */
(function () {
  "use strict";

  var COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
  var DEFAULT_DEPTH = 2;

  // qym_safe.js loads before this file on every page that uses the viewer.
  function escapeHtml(value) {
    return window.QymSafe.escapeHtml(value);
  }

  function isContainer(value) {
    return value !== null && typeof value === "object";
  }

  function isEmpty(value) {
    return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  }

  function parse(value) {
    var data = value;
    if (typeof value === "string") {
      var text = value.trim();
      var first = text.charAt(0);
      var last = text.charAt(text.length - 1);
      if (!((first === "{" && last === "}") || (first === "[" && last === "]"))) return null;
      try { data = JSON.parse(text); } catch (_) { return null; }
    }
    if (!isContainer(data) || isEmpty(data)) return null;
    return data;
  }

  function summary(data) {
    if (Array.isArray(data)) return data.length + (data.length === 1 ? " item" : " items");
    var n = Object.keys(data).length;
    return n + (n === 1 ? " key" : " keys");
  }

  function preview(data, max) {
    var limit = max || 80;
    var text;
    try { text = JSON.stringify(data); } catch (_) { text = String(data); }
    if (text.length > limit) text = text.slice(0, limit - 1) + "…";
    return text;
  }

  function toText(data) {
    try { return JSON.stringify(data, null, 2); } catch (_) { return String(data); }
  }

  function previewHtml(value, opts) {
    var data = parse(value);
    if (!data) return "";
    var options = opts || {};
    var json = toText(data);
    var title = options.title || "JSON";
    var label = "View " + title + " as JSON (" + summary(data) + ")";
    return '<button type="button" class="qjv-preview' + (options.className ? " " + escapeHtml(options.className) : "") + '"' +
      ' data-qjv-json="' + escapeHtml(json) + '" data-qjv-title="' + escapeHtml(title) + '"' +
      ' aria-haspopup="dialog" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">' +
      '<span class="qjv-preview__count">' + escapeHtml(summary(data)) + "</span>" +
      '<span class="qjv-preview__text">' + escapeHtml(preview(data, 120)) + "</span>" +
    "</button>";
  }

  /* ── tree ── */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function scalarNode(value) {
    if (value === null) return el("span", "qjv-null", "null");
    if (typeof value === "string") return el("span", "qjv-string", JSON.stringify(value));
    if (typeof value === "number") return el("span", "qjv-number", String(value));
    if (typeof value === "boolean") return el("span", "qjv-boolean", String(value));
    return el("span", "qjv-string", JSON.stringify(String(value)));
  }

  function keyNode(key, isIndex) {
    if (isIndex) return el("span", "qjv-index", String(key));
    return el("span", "qjv-key", JSON.stringify(String(key)));
  }

  function entriesOf(value) {
    if (Array.isArray(value)) return value.map(function (v, i) { return [i, v]; });
    return Object.keys(value).map(function (k) { return [k, value[k]]; });
  }

  function buildNode(key, value, depth, opts, isIndex, isLast) {
    var row = el("div", "qjv-node");
    row.setAttribute("role", "treeitem");
    var line = el("div", "qjv-line");
    row.appendChild(line);
    var comma = isLast ? null : el("span", "qjv-punct", ",");

    if (!isContainer(value) || isEmpty(value)) {
      line.appendChild(el("span", "qjv-toggle-spacer"));
      if (key !== undefined) {
        line.appendChild(keyNode(key, isIndex));
        line.appendChild(el("span", "qjv-punct", ": "));
      }
      if (isContainer(value)) line.appendChild(el("span", "qjv-punct", Array.isArray(value) ? "[]" : "{}"));
      else line.appendChild(scalarNode(value));
      if (comma) line.appendChild(comma);
      return row;
    }

    var isArray = Array.isArray(value);
    var toggle = el("button", "qjv-toggle");
    toggle.type = "button";
    toggle.innerHTML = CHEVRON;
    toggle.setAttribute("aria-label", (key === undefined ? "root" : String(key)));
    line.appendChild(toggle);
    if (key !== undefined) {
      line.appendChild(keyNode(key, isIndex));
      line.appendChild(el("span", "qjv-punct", ": "));
    }
    line.appendChild(el("span", "qjv-punct", isArray ? "[" : "{"));
    var collapsedHint = el("span", "qjv-collapsed");
    collapsedHint.appendChild(el("span", "qjv-ellipsis", "…"));
    collapsedHint.appendChild(el("span", "qjv-punct", isArray ? "]" : "}"));
    collapsedHint.appendChild(el("span", "qjv-count", summary(value)));
    line.appendChild(collapsedHint);
    if (comma) collapsedHint.insertBefore(comma.cloneNode(true), collapsedHint.querySelector(".qjv-count"));

    var children = el("div", "qjv-children");
    children.setAttribute("role", "group");
    var close = el("div", "qjv-line qjv-close");
    close.appendChild(el("span", "qjv-toggle-spacer"));
    close.appendChild(el("span", "qjv-punct", isArray ? "]" : "}"));
    if (comma) close.appendChild(comma);
    row.appendChild(children);
    row.appendChild(close);

    var built = false;
    function build() {
      if (built) return;
      built = true;
      var entries = entriesOf(value);
      entries.forEach(function (entry, i) {
        children.appendChild(buildNode(entry[0], entry[1], depth + 1, opts, isArray, i === entries.length - 1));
      });
    }
    row.__qjvSet = function (open) {
      if (open) build();
      row.classList.toggle("qjv-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      row.setAttribute("aria-expanded", open ? "true" : "false");
    };
    row.__qjvBuild = build;
    toggle.addEventListener("click", function () {
      row.__qjvSet(!row.classList.contains("qjv-open"));
    });
    collapsedHint.addEventListener("click", function () { row.__qjvSet(true); });
    row.__qjvSet(depth < opts.expandDepth);
    return row;
  }

  function createTree(data, opts) {
    var options = { expandDepth: (opts && opts.expandDepth != null) ? opts.expandDepth : DEFAULT_DEPTH };
    var tree = el("div", "qjv-tree");
    tree.setAttribute("role", "tree");
    tree.appendChild(buildNode(undefined, data, 0, options, false, true));
    return tree;
  }

  function setAll(tree, open) {
    // Expanding builds children lazily, so walk until no closed node is left.
    var guard = 0;
    for (;;) {
      var nodes = tree.querySelectorAll(".qjv-node");
      var changed = false;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node.__qjvSet) continue;
        var isOpen = node.classList.contains("qjv-open");
        if (open && !isOpen) { node.__qjvSet(true); changed = true; }
        else if (!open && isOpen && node.parentElement !== tree) { node.__qjvSet(false); }
      }
      if (!open || !changed || ++guard > 64) break;
    }
  }

  /* ── clipboard ── */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    return new Promise(function (resolve) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (_) { /* best effort */ }
      area.remove();
      resolve();
    });
  }

  /* ── modal ── */

  function open(value, opts) {
    var data = parse(value);
    if (!data) return null;
    var options = opts || {};
    var title = options.title || "JSON";
    var json = toText(data);

    var backdrop = el("div", "shell-modal-backdrop qjv-backdrop");
    backdrop.innerHTML =
      '<div class="shell-modal qjv-modal" role="dialog" aria-modal="true">' +
        '<div class="shell-modal-header qjv-modal__header">' +
          '<div class="qjv-modal__heading">' +
            '<h2 class="shell-modal-title qjv-modal__title" data-qym-dialog-title></h2>' +
            '<span class="qjv-modal__meta"></span>' +
          "</div>" +
          '<div class="qjv-modal__actions">' +
            '<button type="button" class="qym-inline-action qym-inline-action--neutral" data-qjv-expand>Expand all</button>' +
            '<button type="button" class="qym-inline-action qym-inline-action--neutral" data-qjv-collapse>Collapse all</button>' +
            '<button type="button" class="qym-icon-action qjv-copy" data-qjv-copy aria-label="Copy JSON" title="Copy JSON">' + COPY_ICON + "</button>" +
            '<button type="button" class="shell-modal-close qym-icon-action" data-qjv-close aria-label="Close">&times;</button>' +
          "</div>" +
        "</div>" +
        '<div class="qjv-modal__body"></div>' +
      "</div>";
    var modal = backdrop.querySelector(".qjv-modal");
    modal.querySelector(".qjv-modal__title").textContent = title;
    modal.querySelector(".qjv-modal__meta").textContent = summary(data);
    var tree = createTree(data, { expandDepth: options.expandDepth });
    modal.querySelector(".qjv-modal__body").appendChild(tree);
    document.body.appendChild(backdrop);

    var components = window.QymUIComponents;
    function close() {
      if (components && components.releaseDialog) components.releaseDialog(modal);
      backdrop.remove();
      if (!components && options.trigger && options.trigger.focus) options.trigger.focus();
    }
    if (components && components.openDialog) {
      components.openDialog(modal, { initialFocus: "[data-qjv-close]", onEscape: close, returnFocus: options.trigger });
    } else {
      modal.setAttribute("tabindex", "-1");
      modal.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      var closeBtn = modal.querySelector("[data-qjv-close]");
      if (closeBtn) closeBtn.focus();
    }
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    modal.querySelector("[data-qjv-close]").addEventListener("click", close);
    modal.querySelector("[data-qjv-expand]").addEventListener("click", function () { setAll(tree, true); });
    modal.querySelector("[data-qjv-collapse]").addEventListener("click", function () { setAll(tree, false); });
    var copyBtn = modal.querySelector("[data-qjv-copy]");
    copyBtn.addEventListener("click", function () {
      copyText(json).then(function () {
        copyBtn.classList.add("copied");
        copyBtn.setAttribute("aria-label", "Copied");
        copyBtn.title = "Copied";
        setTimeout(function () {
          copyBtn.classList.remove("copied");
          copyBtn.setAttribute("aria-label", "Copy JSON");
          copyBtn.title = "Copy JSON";
        }, 1500);
      });
    });
    return { element: modal, tree: tree, close: close };
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest("[data-qjv-json]") : null;
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute("data-qjv-json"), {
      title: trigger.getAttribute("data-qjv-title") || "JSON",
      trigger: trigger,
    });
  });

  window.QymJsonViewer = {
    parse: parse,
    preview: preview,
    summary: summary,
    previewHtml: previewHtml,
    createTree: createTree,
    open: open,
  };
})();
