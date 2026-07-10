# Desktop GitHub Release Design

## Goal

Publish the macOS and Windows installers produced by the existing native packaging jobs as downloadable assets on a GitHub Release associated with each `desktop-v*` tag.

## Architecture

The existing `package-macos` and `package-windows` jobs remain responsible for native build, test, package, and artifact upload. A new `release` job depends on both jobs and runs on `ubuntu-latest` only when the workflow ref is a `desktop-v*` tag.

The release job downloads both workflow artifacts into one staging directory, then creates or updates the GitHub Release for `GITHUB_REF_NAME`. Separating packaging from publication prevents concurrent native jobs from racing to create the same release.

## Permissions

The workflow keeps `contents: read` as its default permission. Only the release job receives `contents: write`. Packaging jobs do not receive repository write access.

The release command uses the automatically provided `GITHUB_TOKEN` through `GH_TOKEN`; no personal access token or new repository secret is required.

## Release Behavior

- Tag trigger: `desktop-v*`.
- Manual workflow runs on ordinary branches still build Artifacts but skip the release job.
- The release title matches the tag name.
- Release notes are generated from Git history.
- The tag must already exist before the release is created.
- Because the installers are not signed or notarized, the release is marked as a pre-release.
- DMG, macOS ZIP, Windows EXE, and generated blockmap files are attached.
- A rerun for an existing release uploads assets with replacement enabled instead of failing on duplicate names.

## Failure Semantics

The release job starts only after both native package jobs succeed. Missing downloaded files fail before publication. A failure to create or upload the GitHub Release fails the workflow; a successful build with a failed publication is not reported as a successful release.

## Versioning

The implementation increments the desktop package version to `0.1.3` and publishes tag `desktop-v0.1.3`. Earlier tags remain immutable historical records:

- `desktop-v0.1.0` and `desktop-v0.1.1`: failed packaging attempts.
- `desktop-v0.1.2`: successful Actions Artifacts without a GitHub Release.
- `desktop-v0.1.3`: first automated GitHub Pre-release with macOS and Windows assets.

## Verification

- The workflow contract test asserts the release dependency, tag-only condition, job-level write permission, artifact download, generated notes, pre-release flag, and replace-on-rerun behavior.
- YAML parsing, desktop tests, and desktop production build pass locally.
- The implementation is complete only after the `desktop-v0.1.3` workflow succeeds and the GitHub Release API lists both platform assets.
