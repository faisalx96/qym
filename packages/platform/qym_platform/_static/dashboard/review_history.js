// Run review history — the append-only timeline of submissions, decisions and
// withdrawn decisions for one run (GET /api/runs/{id}/review-history).
// Mounted from run.html under the run summary; renders nothing for runs that
// were never submitted. All run data is written with textContent.
(function () {
  "use strict";

  const ACTIONS = {
    submit: { label: "Submitted", tone: "" },
    approve: { label: "Approved", tone: "qym-tag--success" },
    reject: { label: "Rejected", tone: "qym-tag--danger" },
    unapprove: { label: "Approval withdrawn", tone: "qym-tag--warning" },
    unreject: { label: "Rejection withdrawn", tone: "qym-tag--warning" },
  };

  const STYLE = `
    .qym-review-history {
      margin-bottom: var(--space-lg);
      padding: var(--space-md) var(--space-lg);
      background: var(--bg-surface);
      border: 1px solid var(--border-default);
      border-radius: 10px;
    }
    .qym-review-history__title {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text-primary);
    }
    .qym-review-history__copy {
      margin-top: 2px;
      font-size: var(--font-sm);
      color: var(--text-muted);
    }
    .qym-review-history__list {
      list-style: none;
      margin: var(--space-sm) 0 0;
      padding: 0;
    }
    .qym-review-history__entry {
      padding: var(--space-sm) 0;
      border-top: 1px solid var(--border-subtle);
    }
    .qym-review-history__entry:first-child {
      border-top: 0;
    }
    .qym-review-history__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
      font-size: var(--font-base);
      color: var(--text-secondary);
    }
    .qym-review-history__actor {
      color: var(--text-primary);
    }
    .qym-review-history__when {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      color: var(--text-muted);
    }
    .qym-review-history__comment {
      margin-top: var(--space-xs);
      font-size: var(--font-base);
      color: var(--text-secondary);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .qym-review-history__note {
      margin-top: var(--space-xs);
      font-size: var(--font-sm);
      color: var(--text-muted);
    }
  `;

  function ensureStyle() {
    if (document.getElementById("qym-review-history-style")) return;
    const style = document.createElement("style");
    style.id = "qym-review-history-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function statusLabel(status) {
    return String(status || "").toLowerCase();
  }

  function render(container, payload) {
    if (!container) return;
    const events = Array.isArray(payload && payload.events) ? payload.events : [];
    container.replaceChildren();
    if (!events.length) return;
    ensureStyle();

    const section = node("section", "qym-review-history");
    section.setAttribute("aria-label", "Review history");
    section.appendChild(node("div", "qym-review-history__title", "Review history"));
    section.appendChild(node(
      "div",
      "qym-review-history__copy",
      "Every submission and review decision on this run, oldest first.",
    ));

    const list = node("ol", "qym-review-history__list");
    events.forEach((event) => {
      const action = ACTIONS[event.action] || { label: String(event.action || "Changed"), tone: "" };
      const entry = node("li", "qym-review-history__entry");
      entry.dataset.action = String(event.action || "");

      const head = node("div", "qym-review-history__head");
      head.appendChild(node("span", "qym-tag " + action.tone, action.label));
      const actor = event.actor
        ? (event.actor.display_name || event.actor.email || event.actor.id)
        : "Unknown user";
      head.appendChild(node("span", "qym-review-history__actor", actor));
      if (event.to_status && (event.action === "unapprove" || event.action === "unreject")) {
        head.appendChild(node("span", "", "returned the run to " + statusLabel(event.to_status)));
      }
      const when = formatWhen(event.at);
      if (when) {
        const time = node("time", "qym-review-history__when", when);
        time.dateTime = String(event.at);
        head.appendChild(time);
      }
      entry.appendChild(head);

      if (event.comment) {
        entry.appendChild(node("div", "qym-review-history__comment", "“" + event.comment + "”"));
      }
      if (event.recorded === false) {
        entry.appendChild(node(
          "div",
          "qym-review-history__note",
          "Reconstructed from the approval record; earlier changes were not kept.",
        ));
      }
      list.appendChild(entry);
    });
    section.appendChild(list);
    container.appendChild(section);
  }

  // One request per distinct key (the run's status): polling re-renders of the
  // run page do not refetch, while a status change does.
  let loadedKey = null;
  let requestSeq = 0;

  async function load(container, url, key) {
    if (!container || !url) return;
    const cacheKey = url + "|" + String(key || "");
    if (cacheKey === loadedKey) return;
    loadedKey = cacheKey;
    const seq = ++requestSeq;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      if (seq === requestSeq) render(container, payload);
    } catch (err) {
      // History is supplementary; the run page stays usable without it.
      if (seq === requestSeq) {
        container.replaceChildren();
        loadedKey = null;
      }
    }
  }

  window.QymReviewHistory = { load, render };
})();
