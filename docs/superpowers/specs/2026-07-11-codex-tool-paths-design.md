# Codex Tool Paths Design

## Goal

Make Codex CLI and Codex App discovery reliable on macOS and Windows, while allowing users to override failed or unusual installations from the Operations page.

## Architecture

- Persist desktop-only overrides in `~/.codex-switcher/desktop-settings.json`.
- Detect CLI and App independently because they are different executables.
- Resolution order is manual override, explicit environment variable, system PATH/known candidates, then unavailable.
- Every desktop action receives an effective environment containing the resolved CLI and App paths.
- The Operations page loads detection status, supports re-detection, saving manual paths, and restoring automatic detection.

## Validation

- CLI manual paths must exist and successfully execute `--version`.
- App manual paths must exist and be executable.
- Invalid paths are rejected without replacing the previous valid setting.
- Missing tools produce a clear actionable error instead of `spawn ENOENT`.

## Platforms

- macOS searches PATH, Homebrew locations, and standard application bundles.
- Windows searches PATH, standard Codex install directories, and executable extensions.
