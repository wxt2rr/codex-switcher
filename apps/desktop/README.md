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
- Provider plugins use OS-level isolation where available: macOS `sandbox-exec`, Linux `bubblewrap`, and Windows AppContainer; required isolation fails closed when the launcher is unavailable

Current limitation:
- Default Electron icon is still used
- Tagged release builds support macOS Developer ID signing/notarization through GitHub Actions secrets; local builds without those secrets receive a complete ad-hoc resource seal so local packages are internally valid
- Some desktop actions still use the legacy CLI compatibility path and have not been migrated to direct core services yet
- Runtime logs can be viewed in Settings and refresh automatically while the page is open

Commands:
- `npm run desktop:build` from repo root: build desktop frontend
- `npm run desktop:dev` from repo root: run Vite + Electron development shell
- `npm run desktop:electron` from repo root: run the built Electron app
- `npm run desktop:test` from repo root: run desktop bridge and packaging tests
- `npm run desktop:package:mac` from repo root: build macOS `dmg` + `zip` installers for Apple Silicon and Intel
- `npm run desktop:package:mac:dir` from repo root: build directory-style macOS `.app` packages for Apple Silicon and Intel
- `npm run desktop:package:linux` from repo root: build Linux `AppImage` + `deb` installers for x64
- `npm run desktop:package:win` from repo root: build a Windows `nsis` installer target
- `npm run package:dir --workspace ./apps/desktop`: build a generic directory-style Electron package

Packaging notes:
- Build macOS installers on macOS for best results.
- Build Windows installers on Windows for best results.
- macOS Developer ID signing / notarization requires the configured GitHub Actions release secrets. Local packages use ad-hoc signing and remain unidentified to Gatekeeper when downloaded.
- Ad-hoc signatures do not provide a stable TCC identity across rebuilt versions, so local macOS updates may require Accessibility authorization again. Developer ID signing is required to preserve that authorization across releases.
- After installing the unsigned macOS package, remove the quarantine attribute and launch it with:

```bash
xattr -dr com.apple.quarantine "/Applications/codex-switcher.app"
open "/Applications/codex-switcher.app"
```

- Windows packages are also unsigned. If Microsoft Defender SmartScreen warns about the installer, first verify that it came from this repository's GitHub Releases, then choose **More info** → **Run anyway** (or keep the download in the browser) to continue.

GitHub Actions packaging:
- Ordinary pushes and pull requests run CI but do not package installers.
- Run the `desktop-package` workflow manually from the Actions page to test packaging without creating a version tag.
- To package a version automatically, make sure `apps/desktop/package.json` contains the intended version, then push a matching desktop tag:

```bash
git tag desktop-v0.1.30
git push origin desktop-v0.1.30
```

- Tag builds create a GitHub Pre-release containing the DMG, macOS ZIP, Windows EXE, Linux AppImage, Linux deb, and blockmap files.
- The workflow also keeps `codex-switcher-macos`, `codex-switcher-windows-x64`, and `codex-switcher-linux-x64` Actions artifacts for 14 days for build diagnostics.
- Tagged GitHub Pre-release packages are signed/notarized by the release workflow when its macOS and Windows certificate secrets are configured; manual runs without those secrets intentionally remain ad-hoc/unsigned.

Verification status:
- `npm run desktop:test`: passing
- `npm run desktop:build`: passing
- `npm run package:dir --workspace ./apps/desktop`: passing
- packaged app startup verified from `release/mac-arm64/codex-switcher.app` and `release/mac/codex-switcher.app`

Performance note:
- GUI startup and explicit manual refresh still load auth metrics
- Routine Operations-page actions now refresh overview state without automatically reloading auth metrics
