"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHA = /^[a-f0-9]{40}$/;
const WRITE = new Set(["write", "maintain", "admin"]);
const MAX_FINDINGS = 20;

function number(value) {
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error("Invalid PR number");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Invalid PR number");
  return parsed;
}

function sha(value) {
  if (!SHA.test(value || "")) throw new Error("Invalid commit SHA");
  return value;
}

function marker(head, base) {
  return `<!-- qym-codex-review:${sha(head)}:${sha(base)} -->`;
}

async function isWriter(github, repo, username) {
  try {
    const response = await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo, username,
    });
    return WRITE.has(response.data.permission);
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function alreadyReviewed(github, repo, prNumber, head, base) {
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...repo, pull_number: prNumber, per_page: 100,
  });
  return reviews.some(review => review.user?.login === "github-actions[bot]"
    && review.body?.includes(marker(head, base)));
}

async function prepare({ github, context, core, env }) {
  core.setOutput("enabled", "false");
  const skip = async message => {
    core.notice(message);
    await core.summary.addRaw(message).write();
  };
  if (env.HAS_REVIEW_KEY !== "true") {
    await skip("Shared review is waiting for the OPENAI_API_KEY repository secret.");
    return;
  }
  const manual = context.eventName === "workflow_dispatch";
  const prNumber = number(manual ? context.payload.inputs?.pr_number
    : context.payload.pull_request?.number);
  const repo = context.repo;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: prNumber });
  if (pr.state !== "open" || pr.draft || pr.base.ref !== "main"
      || pr.base.repo.full_name.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) {
    await skip("Review skipped: PR must be open, ready for review, and target qym/main.");
    return;
  }
  const authors = new Set((env.REVIEW_AUTHORS || "").split(",")
    .map(name => name.trim().toLowerCase()).filter(Boolean));
  const trusted = async login => authors.has(login.toLowerCase())
    || await isWriter(github, repo, login);
  const authorized = manual
    ? await isWriter(github, repo, context.actor)
    : await trusted(context.actor) && await trusted(pr.user.login);
  if (!authorized) {
    await skip("Review skipped: contributor is not enabled. A maintainer can run this workflow manually.");
    return;
  }
  const head = sha(pr.head.sha), base = sha(pr.base.sha);
  if (await alreadyReviewed(github, repo, prNumber, head, base)) {
    await skip(`PR #${prNumber} already has a shared review for these commits.`);
    return;
  }
  for (const [key, value] of Object.entries({
    enabled: "true", pr_number: String(prNumber), head_sha: head,
    base_sha: base, actor: context.actor,
  })) core.setOutput(key, value);
}

function validateReport(raw) {
  if (typeof raw !== "string" || raw.length > 100000) throw new Error("Missing or oversized review output");
  const report = JSON.parse(raw);
  if (!report || typeof report.summary !== "string" || report.summary.length > 2000
      || !Array.isArray(report.limitations) || report.limitations.length > 10
      || report.limitations.some(item => typeof item !== "string" || item.length > 1000)
      || !Array.isArray(report.findings) || report.findings.length > MAX_FINDINGS) {
    throw new Error("Invalid review output structure");
  }
  for (const finding of report.findings) {
    if (!finding || ![0, 1, 2].includes(finding.priority)
        || typeof finding.title !== "string" || !finding.title.trim() || finding.title.length > 200
        || typeof finding.body !== "string" || !finding.body.trim() || finding.body.length > 2000
        || typeof finding.path !== "string" || !finding.path || finding.path.length > 1000
        || finding.path.startsWith("/") || finding.path.split("/").includes("..")
        || /[\x00-\x1f\\]/.test(finding.path)
        || !Number.isSafeInteger(finding.line) || finding.line < 1) {
      throw new Error("Invalid finding in review output");
    }
  }
  return report;
}

// Prevent raw HTML and unsolicited user/team notifications in model output.
function text(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/@/g, "@\u200b");
}

function rightLines(patch) {
  const lines = new Set();
  let current = null;
  for (const line of (patch || "").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { current = Number(hunk[1]); continue; }
    if (current !== null && (line.startsWith("+") || line.startsWith(" "))) {
      lines.add(current++);
    }
  }
  return lines;
}

async function publish({ github, context, core, env }) {
  const report = validateReport(env.REVIEW_REPORT);
  const repo = context.repo;
  const prNumber = number(env.REVIEW_PR_NUMBER);
  const head = sha(env.REVIEW_HEAD_SHA), base = sha(env.REVIEW_BASE_SHA);
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: prNumber });
  if (pr.state !== "open" || pr.draft || pr.head.sha !== head || pr.base.sha !== base) {
    core.notice("Review discarded because the PR changed while it was running.");
    return;
  }
  if (await alreadyReviewed(github, repo, prNumber, head, base)) return;
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...repo, pull_number: prNumber, per_page: 100,
  });
  const changed = new Map(files.map(file => [file.filename, rightLines(file.patch)]));
  const comments = [], unanchored = [];
  for (const finding of report.findings) {
    if (!changed.has(finding.path)) throw new Error("Review cites a file outside the PR");
    const body = `**[P${finding.priority}] ${text(finding.title)}**\n\n${text(finding.body)}`;
    if (changed.get(finding.path).has(finding.line)) {
      comments.push({ path: finding.path, line: finding.line, side: "RIGHT", body });
    } else {
      // GitHub omits patches for some large/binary files. Preserve the finding
      // in the summary instead of inventing an inline location or dropping it.
      unanchored.push(`${body}\n\nFile: ${text(finding.path)}, line ${finding.line}.`);
    }
  }
  const runUrl = `${context.serverUrl || "https://github.com"}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const body = [
    marker(head, base), "## Codex review",
    `Reviewed commit \`${head.slice(0, 12)}\`. [Workflow run](${runUrl}).`,
    text(report.summary),
    report.findings.length ? `${report.findings.length} finding(s). See the inline comments and any findings below.`
      : "No actionable P0, P1, or P2 findings identified.",
    ...unanchored,
    "### Validation limits",
    ...report.limitations.map(item => `- ${text(item)}`),
    "- Automated source review only. PR code and tests were not executed; required CI and human approval still apply.",
  ].join("\n\n");
  await github.rest.pulls.createReview({
    ...repo, pull_number: prNumber, commit_id: head, event: "COMMENT", body, comments,
  });
  await core.summary.addRaw(`Published ${report.findings.length} finding(s) on PR #${prNumber}.`).write();
}

function writePrompt(env) {
  const base = sha(env.REVIEW_BASE_SHA), head = sha(env.REVIEW_HEAD_SHA);
  const template = fs.readFileSync(path.join(__dirname, "review.md"), "utf8");
  fs.writeFileSync(path.join(env.RUNNER_TEMP, "qym-review-prompt.md"),
    `${template}\nExact commits for this review:\nBASE=${base}\nHEAD=${head}\n`);
}

module.exports = { prepare, publish, validateReport, rightLines, writePrompt, marker };
if (require.main === module) {
  if (process.argv[2] !== "prompt") throw new Error("Expected prompt command");
  writePrompt(process.env);
}
