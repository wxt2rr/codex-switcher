# Codex Switcher v0.1.104

- Added automatic Switcher HTTP/HTTPS proxy synchronization for Claude Code, including WebFetch and Git network support.
- Re-applies Claude Code proxy settings when the Switcher proxy changes and preserves user-owned settings when no Switcher proxy is active.
- Fixed proxy resynchronization so it updates only Claude Code's managed JSON fields without starting a local gateway as a side effect.
- Keeps Claude Code configuration history and rollback behavior intact while avoiding unsupported SOCKS proxy values.
