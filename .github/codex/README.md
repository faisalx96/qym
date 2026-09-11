# Shared PR reviews

The `Shared Codex PR review` workflow reviews ready PRs targeting `main` when
they are opened, reopened, marked ready, or updated. It posts a GitHub review
with inline P0/P1/P2 findings. Teammates use GitHub normally and do not need
individual ChatGPT accounts.

## Enable

1. Create a dedicated OpenAI project/API key with access to the chosen model
   and funded API billing. Set an appropriate project budget and usage alerts.
2. Add the key under **Settings → Secrets and variables → Actions → New
   repository secret**, named `OPENAI_API_KEY`. Do not put the value in code,
   PR comments, or chat. ChatGPT subscriptions do not fund API usage.
3. Merge this workflow into `main`. Existing PRs need a new push or a manual
   run. Under **Actions → Shared Codex PR review → Run workflow**, enter the
   PR number, such as `38`.

Without the secret, the preparation job explains the missing configuration
and skips the paid review. Adding the secret does not itself trigger a run.

## Team and model settings

Repository **Actions variables** control the shared reviewer:

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_REVIEW_AUTHORS` | `faisalx96,saudalsulaiman,waleed-6` | Comma-separated GitHub logins allowed to trigger automatic reviews, including fork contributors. Both PR author and triggering actor must be enabled. Users with repository write access are also allowed. Set `none` to allow only writers. |
| `CODEX_REVIEW_MODEL` | Codex CLI's default | Optional API model override. |

A repository writer can manually review an outside contributor's PR. Unknown
contributors do not automatically consume the shared API budget. Add future
teammates to `CODEX_REVIEW_AUTHORS` without granting repository write access.
To stop reviews, disable the workflow in GitHub Actions.

Review instructions live in `review.md`; JSON output is defined by
`review-schema.json`. Model findings are validated before publication, and
locations outside GitHub's available diff are included in the summary. Reviews
are advisory comments, not automatic approvals, merge actions, or replacements
for the regression suite. Each head/base commit pair is reviewed at most once.

## How fork access stays separate

`pull_request_target` runs the trusted workflow from the base repository. Every
checkout uses `main` or its verified base commit. The PR head is fetched only
as git objects; no PR checkout, dependency installation, builds, or tests run.
The reviewer uses `git diff` and `git show` in a read-only sandbox and follows
the base branch's guidance. This source-only review does not reproduce bugs by
executing PR code. Existing CI remains responsible for tests.

Only `openai/codex-action` receives the API key, through its protected proxy.
The model job has no GitHub write permission. A separate job checks the PR is
still current and publishes the validated report. It has no OpenAI key and
never executes model output. Actions and the Codex CLI are pinned.

## Validate changes

```sh
node --test tests/automation/*.test.cjs
actionlint .github/workflows/codex-review.yml .github/workflows/tests.yml
```

The Node tests run in the existing regression workflow. They cover contributor
authorization, fork access, missing configuration, stale results, duplicate
reviews, diff anchors, malformed output, and advisory-only publication.

References: [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action),
[API pricing](https://developers.openai.com/api/docs/pricing).
