# codex-switcher Desktop

Electron desktop app for `codex-switcher`.

Current scope:
- Apple-native desktop shell
- Desktop bridge is moving from CLI wrapper hops to direct core services for common GUI operations
- Overview, env/account switching, env creation, runtime updates
- Native login/relogin for `auth`, `apikey`, and `sub2api`
- Confirmation flows for env/account deletion
- Proxy, token refresh, doctor, recover, app status, CLI launch, logs, and advanced bridged commands
- Structured result summaries with raw output fallback

Current limitation:
- Default Electron icon is still used
- macOS code signing / notarization is not configured yet
- Some desktop actions still use the legacy CLI compatibility path and have not been migrated to direct core services yet
- Live log streaming and richer task history UX are not implemented yet

Commands:
- `npm run desktop:build` from repo root: build desktop frontend
- `npm run desktop:dev` from repo root: run Vite + Electron development shell
- `npm run desktop:electron` from repo root: run the built Electron app
- `npm run desktop:test` from repo root: run desktop bridge and packaging tests
- `npm run desktop:package:mac` from repo root: build macOS `dmg` + `zip` installers for Apple Silicon
- `npm run desktop:package:mac:dir` from repo root: build a directory-style macOS `.app`
- `npm run desktop:package:win` from repo root: build a Windows `nsis` installer target
- `npm run package:dir --workspace ./apps/desktop`: build a generic directory-style Electron package

Packaging notes:
- Build macOS installers on macOS for best results.
- Build Windows installers on Windows for best results.
- macOS code signing / notarization is still not configured, so local packages are unsigned.

GitHub Actions packaging:
- Ordinary pushes and pull requests run CI but do not package installers.
- Run the `desktop-package` workflow manually from the Actions page to test packaging without creating a version tag.
- To package a version automatically, make sure `apps/desktop/package.json` contains the intended version, then push a matching desktop tag:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

- Download `codex-switcher-macos-arm64` and `codex-switcher-windows-x64` from the completed workflow run.
- Workflow artifacts are retained for 14 days.
- GitHub Actions packages are unsigned and are not published to GitHub Releases. Signing, notarization, and public release publishing require a separate release configuration.

Verification status:
- `npm run desktop:test`: passing
- `npm run desktop:build`: passing
- `npm run package:dir --workspace ./apps/desktop`: passing
- packaged app startup verified from `release/mac-arm64/codex-switcher.app`

Performance note:
- GUI startup and explicit manual refresh still load auth metrics
- Routine Operations-page actions now refresh overview state without automatically reloading auth metrics
