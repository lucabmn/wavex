---
name: github-repository-setup
description: Audit or configure wavex's GitHub repository baseline, including issue forms, PR templates, CI, release automation, Dependabot, rulesets, labels, and security settings.
---

# GitHub repository setup

Prefer versioned policy when GitHub supports it. Remote settings are for controls
that cannot live in the repository.

## Current versioned baseline

Maintain these existing files and locations:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/dependabot.yml`
- root `CONTRIBUTING.md` and `SECURITY.md`

Do not claim nonexistent `pr-policy`, technical-task, or generated-release-notes
files are required. Add governance only for a demonstrated need and owner.

## Main branch ruleset

When asked to configure it, recommend:

- Require pull requests and block direct pushes.
- Require at least one approval and conversation resolution.
- Require the actual CI checks from `.github/workflows/ci.yml` (`CI / web` and
  `CI / rust`, subject to the names GitHub reports).
- Require linear history; block force pushes and deletion.
- Allow squash merge and automatic branch deletion if that matches the owner's
  preference.
- Protect `v*` tags from updates and deletion because a tag triggers signed,
  notarized release publication.

Do not invent a required check until the workflow exists and has reported on the
default branch.

## Security and labels

- Keep a small label set using the existing taxonomy.
- Enable private vulnerability reporting, dependency alerts, secret scanning,
  and push protection when available for the repository plan.
- Never expose Apple signing, notarization, updater, or GitHub credentials while
  auditing release settings.

## Audit procedure

1. Inspect the versioned `.github` files and root contribution/security docs.
2. Read current remote settings with `gh` only when authenticated and asked.
3. Report gaps before changing anything.
4. Apply the smallest approved change.
5. Re-read the setting or workflow and report the exact result.

Never weaken protection, enable auto-merge, create secrets, or modify remote
settings without explicit approval.
