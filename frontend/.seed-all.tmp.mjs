// ../../../../../../tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/seed-all.mts
import { writeFileSync } from "node:fs";

// e2e/run-detail/unionSeed.ts
import { randomUUID } from "node:crypto";

// e2e/run-detail/seed.ts
async function call(client2, method, path, body, headers = {}) {
  const h = { ...client2.headers ?? {}, ...headers };
  let payload;
  if (body !== void 0) {
    if (typeof body === "string") payload = body;
    else {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${client2.baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
async function ensureProject(client2, name, slug) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await call(client2, "POST", "/v1/projects", { name, slug });
    } catch (err) {
      lastError = err;
      if (String(err).includes("-> 409")) {
        return call(
          client2,
          "GET",
          `/v1/projects/by-slug/${encodeURIComponent(slug)}`
        );
      }
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}
async function createApiKey(client2, projectId) {
  const res = await call(client2, "POST", `/v1/projects/${projectId}/api-keys`, {
    name: "seed"
  });
  return res.token;
}
function r7Snake(len) {
  const words = [
    "customer",
    "eligibility",
    "assessment",
    "result",
    "after",
    "policy",
    "review",
    "step",
    "with",
    "exceptions",
    "applied",
    "to",
    "segment",
    "and",
    "region"
  ];
  let k = "";
  for (let w = 0; k.length < len; w++) k += (k ? "_" : "") + words[w % words.length];
  return k.slice(0, len).replace(/_$/, "x");
}
function r7Camel(len) {
  const words = [
    "Retrieved",
    "Policy",
    "Document",
    "Identifiers",
    "Used",
    "To",
    "Ground",
    "The",
    "Final",
    "Answer",
    "Text",
    "After",
    "Rerank"
  ];
  let k = "retrieved";
  for (let w = 1; k.length < len; w++) k += words[w % words.length];
  return k.slice(0, len);
}
var R7_KEYS = {
  k10: "confidence",
  k40: r7Snake(40),
  k80: r7Snake(80),
  c40: r7Camel(40),
  c80: r7Camel(80),
  /** An Arabic key and an Arabic metadata key. */
  ar: "\u062A\u062D\u0644\u064A\u0644_\u0623\u0647\u0644\u064A\u0629_\u0627\u0644\u0639\u0645\u064A\u0644_\u0628\u0639\u062F_\u0645\u0631\u0627\u062C\u0639\u0629_\u0627\u0644\u0633\u064A\u0627\u0633\u0629_\u0648\u0627\u0644\u0627\u0633\u062A\u062B\u0646\u0627\u0621\u0627\u062A_\u0627\u0644\u0645\u0637\u0628\u0642\u0629_\u0639\u0644\u0649_\u0627\u0644\u0634\u0631\u064A\u062D\u0629",
  arTag: "\u062A\u0635\u0646\u064A\u0641_\u0627\u0644\u0639\u0645\u064A\u0644_\u062D\u0633\u0628_\u0627\u0644\u0634\u0631\u064A\u062D\u0629_\u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629"
};
for (const [k, v] of Object.entries(R7_KEYS))
  if (/^[kc]\d+$/.test(k) && v.length !== Number(k.slice(1))) throw new Error(`key ${k} is ${v.length}`);

// e2e/helpers.ts
import { expect } from "@playwright/test";
function uniqueSlug(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// e2e/run-detail/unionSeed.ts
var UNION_METRICS = ["answer_correctness", "faithfulness", "tone"];
var MOCK_ENTRIES = [
  { name: "support-tickets", items: 412, errors: 3, means: [0.661, 0.842, 0.774] },
  { name: "support-tickets", items: 438, errors: 5, means: [0.708, 0.857, 0.781] },
  { name: "billing-faq", items: 96, errors: 0, means: [0.719, 0.901, 0.812], alias: "production" }
];
async function call2(client2, method, path, body, headers = {}) {
  const h = { ...client2.headers ?? {}, ...headers };
  let payload;
  if (body !== void 0) {
    if (typeof body === "string") payload = body;
    else {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${client2.baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
var rawId = (n) => `t-${String(n + 1).padStart(4, "0")}`;
async function makeDatasets(client2, slug, entries) {
  const made = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    let ds = made.get(entry.name);
    if (!ds) {
      const created2 = await call2(client2, "POST", "/v1/datasets", {
        name: entry.name,
        project_slug: slug
      });
      ds = { ...created2.dataset, versions: [] };
      made.set(entry.name, ds);
    }
    const previous = ds.versions[ds.versions.length - 1];
    const created = await call2(
      client2,
      "POST",
      `/v1/datasets/${encodeURIComponent(ds.slug)}/versions?project_slug=${slug}`,
      previous ? { from_version: previous.version } : {}
    );
    const version = created.version.version;
    const upserts = Array.from({ length: entry.items }, (_, n) => ({
      item_id: rawId(n),
      input: `Customer ticket ${n + 1}: where is my refund for order ${88e3 + n}?`,
      expected_output: "Refunds take 5 business days.",
      metadata: { channel: n % 2 ? "email" : "chat" }
    })).slice(previous?.items ?? 0);
    for (let i = 0; i < upserts.length; i += 1e3) {
      await call2(
        client2,
        "POST",
        `/v1/datasets/${encodeURIComponent(ds.slug)}/versions/${version}/items:bulk?project_slug=${slug}`,
        { upserts: upserts.slice(i, i + 1e3) }
      );
    }
    await call2(
      client2,
      "POST",
      `/v1/datasets/${encodeURIComponent(ds.slug)}/versions/${version}:publish?project_slug=${slug}`,
      entry.alias ? { set_alias: entry.alias } : {}
    );
    ds.versions.push({ id: created.version.id, version, items: entry.items });
  }
  return made;
}
async function seedUnionRun(client2, o = {}) {
  const entries = o.entries ?? MOCK_ENTRIES;
  const name = o.name ?? "release-gate-nightly";
  const slug = o.slug ?? uniqueSlug("union");
  const project = await ensureProject(client2, "Multi demo", slug);
  const token = await createApiKey(client2, project.id);
  const datasets = await makeDatasets(client2, slug, entries);
  const seenNames = /* @__PURE__ */ new Map();
  const described = entries.map((entry, position) => {
    const ds = datasets.get(entry.name);
    const ordinal = seenNames.get(entry.name) ?? 0;
    seenNames.set(entry.name, ordinal + 1);
    const version = ds.versions[ordinal];
    return { entry, position, ds, version };
  });
  const label = described.map((d2) => `${d2.entry.name}@${d2.entry.alias ?? d2.version.version}`).join(" + ").slice(0, 120);
  const entryList = described.map((d2) => ({
    dataset: d2.entry.name,
    dataset_id: d2.ds.id,
    dataset_version_id: d2.version.id,
    version: d2.version.version,
    alias: d2.entry.alias ?? null,
    items: d2.entry.items,
    disabled_items: 0
  }));
  const specs = Object.fromEntries(
    UNION_METRICS.map((m2) => [m2, { score_type: "percentage", direction: "maximize", pass_threshold: 0.7, schema_version: 2 }])
  );
  const total = entries.reduce((n, e) => n + e.items, 0);
  const first = entryList[0];
  const runBody = {
    external_run_id: name,
    task: "answer-ticket",
    dataset: label,
    model: "openai/gpt-4o",
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    dataset_id: first.dataset_id,
    dataset_version_id: first.dataset_version_id,
    datasets: entryList,
    versioning_details: o.versioning ?? { agent_version: "v2.4.1" },
    run_metadata: { datasets: entryList, total_items: total },
    run_config: { run_name: name, max_concurrency: 8 }
  };
  const created = await call2(client2, "POST", "/v1/runs", runBody, { Authorization: `Bearer ${token}` });
  const runId = created.run_id;
  const sent = new Date(Date.UTC(2026, 9, 22, 12, 0, 0)).toISOString();
  let seq = 0;
  const lines = [];
  const push = (type, payload) => lines.push(
    JSON.stringify({
      schema_version: 1,
      event_id: randomUUID(),
      sequence: ++seq,
      sent_at: sent,
      type,
      run_id: runId,
      payload
    })
  );
  push("run_started", {
    external_run_id: name,
    task: "answer-ticket",
    dataset: label,
    model: "openai/gpt-4o",
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    datasets: entryList,
    total_items: total,
    started_at: sent,
    run_config: { run_name: name, max_concurrency: 8 },
    run_metadata: { datasets: entryList, total_items: total }
  });
  let index = 0;
  for (const d2 of described) {
    const { entry } = d2;
    for (let n = 0; n < entry.items; n++) {
      const id = `${entry.name}@${d2.version.version}/${rawId(n)}`;
      push("item_started", {
        item_id: id,
        index,
        input: `Customer ticket ${n + 1}: where is my refund for order ${88e3 + n}?`,
        expected: "Refunds take 5 business days.",
        item_metadata: {
          channel: n % 2 ? "email" : "chat",
          qym_dataset: entry.name,
          qym_dataset_version: d2.version.version,
          qym_dataset_index: d2.position,
          qym_item_id: rawId(n),
          qym_dataset_version_id: d2.version.id
        }
      });
      if (n < entry.errors) {
        push("item_failed", { item_id: id, index, error: "Timeout calling the ticket model", latency_ms: 3e4 });
      } else {
        UNION_METRICS.forEach((metric, k) => {
          const s = Math.min(1, entry.means[k] * entry.items / (entry.items - entry.errors));
          push("metric_scored", { item_id: id, metric_name: metric, score_numeric: s, score_value: s, score_raw: s });
        });
        push("item_completed", {
          item_id: id,
          index,
          output: "Your refund arrives within 5 business days.",
          latency_ms: 900 + index * 37 % 600
        });
      }
      index++;
    }
  }
  push("run_completed", { ended_at: sent, final_status: "COMPLETED" });
  for (let i = 0; i < lines.length; i += 400) {
    const res = await call2(
      client2,
      "POST",
      `/v1/runs/${runId}/events`,
      lines.slice(i, i + 400).join("\n") + "\n",
      { Authorization: `Bearer ${token}`, "Content-Type": "application/x-ndjson" }
    );
    if (res.rejected) throw new Error(`events rejected: ${JSON.stringify(res.rejected_events).slice(0, 600)}`);
  }
  for (const gone of o.deleteAfter ?? []) {
    const ds = datasets.get(gone);
    if (ds) await call2(client2, "DELETE", `/v1/datasets/${encodeURIComponent(ds.slug)}?project_slug=${slug}`);
  }
  return { slug, projectId: project.id, token, runId, name, datasets };
}
async function seedSingleRunOn(client2, union, name, datasetName, items, mean) {
  const ds = union.datasets.get(datasetName);
  const version = ds.versions[0];
  const specs = Object.fromEntries(
    UNION_METRICS.map((m2) => [m2, { score_type: "percentage", direction: "maximize", pass_threshold: 0.7, schema_version: 2 }])
  );
  const created = await call2(
    client2,
    "POST",
    "/v1/runs",
    {
      external_run_id: name,
      task: "answer-ticket",
      dataset: ds.name,
      model: "openai/gpt-4o",
      metrics: [...UNION_METRICS],
      metric_specs: specs,
      dataset_id: ds.id,
      dataset_version_id: version.id,
      versioning_details: { agent_version: "v2.4.1" },
      run_config: { run_name: name, max_concurrency: 8 }
    },
    { Authorization: `Bearer ${union.token}` }
  );
  const runId = created.run_id;
  const sent = new Date(Date.UTC(2026, 9, 22, 11, 0, 0)).toISOString();
  let seq = 0;
  const lines = [];
  const push = (type, payload) => lines.push(
    JSON.stringify({ schema_version: 1, event_id: randomUUID(), sequence: ++seq, sent_at: sent, type, run_id: runId, payload })
  );
  push("run_started", {
    external_run_id: name,
    task: "answer-ticket",
    dataset: ds.name,
    model: "openai/gpt-4o",
    metrics: [...UNION_METRICS],
    metric_specs: specs,
    dataset_id: ds.id,
    dataset_version_id: version.id,
    total_items: items,
    started_at: sent,
    run_config: { run_name: name }
  });
  for (let n = 0; n < items; n++) {
    const id = rawId(n);
    push("item_started", { item_id: id, index: n, input: `Customer ticket ${n + 1}`, expected: "Refunds take 5 business days." });
    UNION_METRICS.forEach(
      (metric) => push("metric_scored", { item_id: id, metric_name: metric, score_numeric: mean, score_value: mean, score_raw: mean })
    );
    push("item_completed", { item_id: id, index: n, output: "Your refund arrives within 5 business days.", latency_ms: 900 });
  }
  push("run_completed", { ended_at: sent, final_status: "COMPLETED" });
  for (let i = 0; i < lines.length; i += 400) {
    await call2(client2, "POST", `/v1/runs/${runId}/events`, lines.slice(i, i + 400).join("\n") + "\n", {
      Authorization: `Bearer ${union.token}`,
      "Content-Type": "application/x-ndjson"
    });
  }
  return runId;
}
function manyEntries() {
  const names = ["support-tickets", "billing-faq", "refund-cases", "onboarding-checks"];
  return Array.from({ length: 12 }, (_, i) => ({
    name: names[i % 4],
    items: 80 + i * 17,
    errors: i % 5 === 0 ? 1 : 0,
    means: [0.6 + i % 5 / 20, 0.8 + i % 3 / 30, 0.75 + i % 4 / 40]
  }));
}

// ../../../../../../tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/seed-all.mts
var client = { baseUrl: "http://127.0.0.1:5998" };
var stamp = Date.now().toString(36);
var out = {};
var u = await seedUnionRun(client, { slug: `md-${stamp}` });
out.slug = u.slug;
out.union = u.runId;
out.single = await seedSingleRunOn(client, u, "ticket-triage-nightly", "support-tickets", 412, 0.661);
var m = await seedUnionRun(client, { slug: `mdmany-${stamp}`, name: "nightly-all-sets", entries: manyEntries() });
out.manySlug = m.slug;
out.many = m.runId;
var d = await seedUnionRun(client, { slug: `mddel-${stamp}`, deleteAfter: ["billing-faq"] });
out.delSlug = d.slug;
out.deleted = d.runId;
var s2 = await seedUnionRun(client, { slug: `mdsingle-${stamp}`, entries: [{ name: "support-tickets", items: 412, errors: 3, means: [0.661, 0.842, 0.774] }], name: "only-single" });
out.singleSlug = s2.slug;
out.onlySingle = s2.runId;
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
