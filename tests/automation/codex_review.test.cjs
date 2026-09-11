"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepare, publish, rightLines, validateReport, writePrompt, marker } =
  require("../../.github/codex/review.cjs");

const HEAD = "a".repeat(40), BASE = "b".repeat(40);
const fixture = (overrides = {}) => {
  const output = {}, notices = [], published = [];
  const pr = {
    number: 38, state: "open", draft: false, user: { login: "teammate" },
    head: { sha: HEAD, repo: { full_name: "teammate/qym" } },
    base: { sha: BASE, ref: "main", repo: { full_name: "owner/qym" } },
    ...overrides,
  };
  const reviews = [], files = [{
    filename: "app.py", patch: "@@ -9,3 +9,4 @@\n context\n-old\n+new\n+added\n context",
  }];
  const context = { repo: { owner: "owner", repo: "qym" }, actor: "teammate",
    eventName: "pull_request_target", payload: { pull_request: { number: 38 } }, runId: 123 };
  const core = { setOutput: (k, v) => { output[k] = v; }, notice: m => notices.push(m),
    summary: { addRaw() { return this; }, async write() {} } };
  const github = { rest: {
    repos: { getCollaboratorPermissionLevel: async ({ username }) =>
      ({ data: { permission: username === "owner" ? "admin" : "read" } }) },
    pulls: {
      get: async () => ({ data: pr }),
      listReviews: "reviews", listFiles: "files",
      createReview: async payload => { published.push(payload); },
    },
  }, paginate: async method => method === "reviews" ? reviews : files };
  const env = { HAS_REVIEW_KEY: "true", REVIEW_AUTHORS: "owner,teammate",
    REVIEW_PR_NUMBER: "38", REVIEW_HEAD_SHA: HEAD, REVIEW_BASE_SHA: BASE,
    REVIEW_REPORT: JSON.stringify({ summary: "A regression", limitations: [], findings: [{
      priority: 2, title: "Keep the selected pass", body: "Pass two exports all passes.",
      path: "app.py", line: 11,
    }] }),
  };
  return { github, context, core, env, pr, output, notices, published, reviews, files };
};

test("automatically reviews enabled teammates' fork PRs", async () => {
  const f = fixture();
  await prepare(f);
  assert.deepEqual(f.output, { enabled: "true", pr_number: "38", head_sha: HEAD,
    base_sha: BASE, actor: "teammate" });
});

test("unknown PR authors and actors cannot spend the shared API allowance", async () => {
  for (const field of ["author", "actor"]) {
    const f = fixture();
    if (field === "actor") f.context.actor = "outsider";
    else f.pr.user.login = "outsider";
    await prepare(f);
    assert.equal(f.output.enabled, "false");
    assert.equal(f.published.length, 0);
  }
});

test("a maintainer can manually review an external contributor's PR", async () => {
  const f = fixture();
  f.context.actor = "owner";
  f.context.eventName = "workflow_dispatch";
  f.context.payload = { inputs: { pr_number: "38" } };
  f.pr.user.login = "outsider";
  await prepare(f);
  assert.equal(f.output.enabled, "true");
});

test("an allowlisted contributor without write access cannot dispatch arbitrary PRs", async () => {
  const f = fixture();
  f.context.eventName = "workflow_dispatch";
  f.context.payload = { inputs: { pr_number: "38" } };
  await prepare(f);
  assert.equal(f.output.enabled, "false");
});

test("missing key, drafts, closed PRs and other target branches skip review", async () => {
  for (const mutation of [f => { f.env.HAS_REVIEW_KEY = "false"; },
    f => { f.pr.draft = true; }, f => { f.pr.state = "closed"; },
    f => { f.pr.base.ref = "release"; }]) {
    const f = fixture(); mutation(f);
    await prepare(f);
    assert.equal(f.output.enabled, "false");
    assert.equal(f.notices.length, 1);
  }
});

test("a prior bot review prevents duplicate review runs and publication", async () => {
  const f = fixture();
  f.reviews.push({ user: { login: "github-actions[bot]" }, body: marker(HEAD, BASE) });
  await prepare(f);
  await publish(f);
  assert.equal(f.output.enabled, "false");
  assert.equal(f.published.length, 0);
});

test("a user cannot suppress reviews by copying the bot marker", async () => {
  const f = fixture();
  f.reviews.push({ user: { login: "teammate" }, body: marker(HEAD, BASE) });
  await prepare(f);
  assert.equal(f.output.enabled, "true");
});

test("head or base changes during review discard stale findings", async () => {
  for (const ref of ["head", "base"]) {
    const f = fixture(); f.pr[ref].sha = "c".repeat(40);
    await publish(f);
    assert.equal(f.published.length, 0);
    assert.match(f.notices[0], /changed/);
  }
});

test("posts P2 findings on verified diff lines as an advisory GitHub review", async () => {
  const f = fixture();
  await publish(f);
  assert.equal(f.published.length, 1);
  const result = f.published[0];
  assert.equal(result.commit_id, HEAD);
  assert.equal(result.event, "COMMENT");
  assert.equal(result.comments[0].line, 11);
  assert.equal(result.comments[0].side, "RIGHT");
  assert.match(result.comments[0].body, /\[P2\]/);
  assert.match(result.body, /PR code and tests were not executed/);
});

test("findings without an anchor stay in the summary, not a fabricated inline comment", async () => {
  const f = fixture();
  f.files[0].patch = undefined;
  await publish(f);
  assert.equal(f.published[0].comments.length, 0);
  assert.match(f.published[0].body, /Pass two exports all passes/);
});

test("files outside the PR and malformed model responses never get published", async () => {
  const f = fixture();
  f.files.length = 0;
  await assert.rejects(publish(f), /outside the PR/);
  assert.equal(f.published.length, 0);
  for (const raw of ["", "not JSON", "null", "{}", JSON.stringify({ summary: "s",
    limitations: [], findings: [{ priority: 2, title: "t", body: "b", path: "../key", line: 1 }] })]) {
    assert.throws(() => validateReport(raw));
  }
});

test("diff positions track separate hunks and deletions correctly", () => {
  assert.deepEqual([...rightLines("@@ -1,2 +1,1 @@\n-old\n context\n@@ -20 +19,2 @@\n+new\n same")], [1, 19, 20]);
});

test("a clean result never approves or merges the PR", async () => {
  const f = fixture();
  f.env.REVIEW_REPORT = JSON.stringify({ summary: "No issues found", findings: [], limitations: [] });
  await publish(f);
  assert.equal(f.published[0].event, "COMMENT");
  assert.match(f.published[0].body, /No actionable P0, P1, or P2/);
});

test("review text cannot embed raw HTML or notify arbitrary teams", async () => {
  const f = fixture(), report = JSON.parse(f.env.REVIEW_REPORT);
  report.findings[0].body = '<img src=x> @owner/team';
  f.env.REVIEW_REPORT = JSON.stringify(report);
  await publish(f);
  assert.doesNotMatch(f.published[0].comments[0].body, /<img|@owner/);
});

test("the prompt uses validated immutable commits, never PR titles or bodies", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qym-review-test-"));
  try {
    writePrompt({ RUNNER_TEMP: dir, REVIEW_BASE_SHA: BASE, REVIEW_HEAD_SHA: HEAD });
    const prompt = fs.readFileSync(path.join(dir, "qym-review-prompt.md"), "utf8");
    assert.ok(prompt.endsWith(`BASE=${BASE}\nHEAD=${HEAD}\n`));
    assert.match(prompt, /Do not check out the PR/);
    assert.throws(() => writePrompt({ RUNNER_TEMP: dir, REVIEW_BASE_SHA: "$(bad)", REVIEW_HEAD_SHA: HEAD }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
