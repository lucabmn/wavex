---
name: releases
description: Plan, version, tag, verify, or publish a wavex macOS release. Use when changing versions, updating CHANGELOG.md, creating v* tags, or working with the signed Tauri release workflow.
---

# Releases

wavex uses Semantic Versioning and stable tags shaped as `vMAJOR.MINOR.PATCH`.
The current scripts and GitHub workflow support stable releases only; do not
create an `-rc` tag until `scripts/verify-release.mjs`, version bumping, and the
workflow explicitly support prereleases.

## Version source set

A release version must agree in:

- `package.json`
- `[workspace.package]` in `Cargo.toml`
- the wavex package entry in `Cargo.lock`
- `src-tauri/tauri.conf.json`
- the matching section in `CHANGELOG.md`

Use the repository script rather than editing version files independently:

```sh
pnpm set-version 0.2.0
```

Then write concise user-facing Keep a Changelog notes.

## Release gate

1. Start from a clean, current `main` and confirm intended changes are merged.
2. Choose PATCH, MINOR, or MAJOR from user impact.
3. Confirm the exact version with the user before changing or publishing it.
4. Run `pnpm set-version <version>`.
5. Update `CHANGELOG.md` with the release date and user-visible changes.
6. Run `node scripts/verify-release.mjs <version>`.
7. Run `pnpm check` and confirm required CI is green.
8. Review the release diff and create the release commit only when asked.

## Tag publication

Pushing a `v*` tag triggers `.github/workflows/release.yml`. That workflow:

- verifies version and distribution inputs;
- builds the Apple Silicon Tauri app and DMG;
- signs, notarizes, staples, and Gatekeeper-checks them;
- creates signed updater artifacts and `latest.json`;
- publishes only after artifact verification and updater smoke testing.

Create a signed tag when signing is configured, otherwise an annotated tag:

```sh
git tag -s v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

Do not manually run `gh release create` for the normal path; the workflow owns
the GitHub release and its notes come from the matching changelog section.
Never move or reuse a published tag. Creating or pushing a tag requires explicit
approval.
