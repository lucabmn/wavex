---
name: github-issues
description: Create, refine, triage, or close GitHub issues for wavex. Use when the user asks to file or manage an issue, when substantial work needs tracking, or when preparing a PR linked to an existing issue.
---

# GitHub issues

Write issues in concise English. Describe the observed problem or desired
outcome, not the agent's working notes.

## Before creating

1. Search open and closed issues for duplicates.
2. Confirm the behavior is reproducible or the requested outcome is understood.
3. Use an existing form:
   - `.github/ISSUE_TEMPLATE/bug_report.yml`
   - `.github/ISSUE_TEMPLATE/feature_request.yml`
4. Use existing labels only.

Small pull requests do not require a manufactured issue. Create one when the
user asks, the change is substantial, or the problem needs independent tracking.

## Writing

- Use a short sentence-case title without a trailing period.
- For bugs, include wavex and macOS versions, affected provider CLI when
  relevant, observed behavior, minimal reproduction, and expected behavior.
- For features, explain the user problem, desired behavior, and completion
  criteria.
- Include logs, screenshots, or constraints only when they make the issue more
  actionable. Redact tokens, credentials, private paths, prompts, and repository
  contents.
- Keep one concern per issue and avoid prescribing implementation unless it is a
  genuine constraint.
- Security vulnerabilities go through the private advisory flow documented in
  `SECURITY.md`, never a public issue.

## Lifecycle

- Use `Related to #123` for context and `Closes #123` only when the eventual PR
  fully resolves the issue.
- Update the issue if scope changes materially.
- Close duplicates with a link to the canonical issue.
- Do not close an issue before the fix is merged or the proposal is explicitly
  declined.

Use `gh issue list`, `gh issue view`, and `gh issue create` when authenticated.
Never mutate GitHub unless the user asked.
