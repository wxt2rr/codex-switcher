# Skills management

The desktop Skills page uses Codex environments as the canonical skill stores. Other providers remain global and can optionally project one Codex environment through managed per-skill links.

## Storage model

- Every Codex environment stores skills in `<environment home>/skills`, for example `~/.codex-envs/personal/home/skills`.
- Codex environments stay isolated. Installing, updating, or uninstalling a skill in one environment does not change another environment.
- Claude Code, Qoder, ZCode, CodeBuddy/WorkBuddy, and Cursor each use one global skills directory.
- Each global provider is disabled by default. When enabled, it binds to exactly one Codex source environment.
- Different providers may bind to different Codex environments. A provider never merges skills from multiple environments.

Default global directories are:

| Provider | Directory |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| Qoder | `~/.qoder/skills` |
| ZCode | `~/.zcode/skills` |
| CodeBuddy/WorkBuddy | `~/.codebuddy/skills` |
| Cursor | `~/.cursor/skills` |

The persisted provider binding may override its target directory. On macOS and Linux, managed entries are relative symbolic links. Windows uses directory junction-compatible links.

## Marketplace and sources

The desktop app uses the same public search endpoint as the official skills CLI to load up to 100 popular matching skills without embedded credentials. Results are sorted by install count.

- Set `CODEX_SWITCHER_SKILLS_CATALOG_URL` to a trusted JSON catalog endpoint to replace the default public search transport with a complete leaderboard or private catalog.
- The authenticated skills.sh V1 leaderboard, detail, and audit APIs still require Vercel OIDC and should be accessed through a trusted proxy when those fields are needed.

Catalog responses are normalized and cached under the desktop state directory. An unavailable refresh may fall back to a previously validated cache. The app does not scrape marketplace HTML and does not embed marketplace credentials.

Git installation accepts a GitHub HTTPS repository, `owner/repository`, or an absolute local Git repository path. The app validates `SKILL.md`, frontmatter, file counts, total size, and symlink containment before committing the skill. Repository scripts and install hooks are never executed.

## Ownership and conflicts

Only canonical skills recorded in an environment lock file can be updated or uninstalled by the app. Before an update, local content hashes are compared with the recorded hash so modified content is not silently replaced.

Provider routing owns only the links recorded in its routing manifest. Existing files, directories, and unrecognized links in a provider directory are foreign content and are preserved. A name collision is reported as a conflict instead of being overwritten.

Changing or disabling a binding removes only app-owned links. Repair recreates missing managed links from the selected Codex environment. If a conflict remains, rename or move the foreign provider entry, then run repair again.

## Recovery

Install and update operations stage content before committing it and keep bounded backups. If an operation fails, retry from the Codex environment tab. Provider routing can be repaired independently of marketplace connectivity because both inventory and routing operate on local files.

If an environment is removed outside the app, disable any provider binding that points to it or bind the provider to an existing environment. Foreign provider content is not removed during this cleanup.
