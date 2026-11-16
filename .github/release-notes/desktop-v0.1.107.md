# Codex Switcher v0.1.107

- Fixed a Windows AppContainer sandbox smoke-test false failure when runner ACL cleanup exceeds the previous launcher wait window.
- Kept the sandbox child process timeout fail-closed while allowing the launcher cleanup more time on Windows CI runners.
