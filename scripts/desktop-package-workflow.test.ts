import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("desktop packaging workflow builds native installers for version tags and manual runs", async () => {
  const workflow = await readFile(join(process.cwd(), ".github", "workflows", "desktop-package.yml"), "utf8");
  const installSmoke = await readFile(join(process.cwd(), "scripts", "package-install-smoke.mjs"), "utf8");
  const requiredContent = [
    "workflow_dispatch:",
    'tags: ["desktop-v*"]',
    "permissions:",
    "contents: read",
    "package-macos:",
    "runs-on: macos-latest",
    "package-windows:",
    "runs-on: windows-latest",
    "package-linux:",
    "runs-on: ubuntu-latest",
    "npm run desktop:build",
    "Run macOS plugin sandbox smoke test",
    "macos-sandbox.json",
    "Upload macOS sandbox evidence",
    "Run Linux plugin sandbox smoke test",
    "linux-sandbox.json",
    "Upload Linux sandbox evidence",
    "posix-plugin-sandbox-smoke.mjs",
    "Verify Windows plugin sandbox helper",
    "codex-switcher-plugin-sandbox.exe",
    "Windows AppContainer plugin sandbox helper was not built",
    "Run Windows plugin sandbox smoke test",
    "windows-sandbox.json",
    "Upload Windows sandbox evidence",
    "windows-plugin-sandbox-smoke.cjs",
    "npm run desktop:test",
    "npm run desktop:package:mac",
    "release/mac-arm64/codex-switcher.app",
    "release/mac/codex-switcher.app",
    "Smoke-install macOS package",
    "package-install-smoke.mjs apps/desktop/release",
    "package-install-darwin.json",
    "! -name '*-arm64.dmg'",
    "! -name '*-arm64-mac.zip'",
    "npm run desktop:package:win",
    "Remove-Item Env:WIN_CSC_LINK",
    "Remove-Item Env:WIN_CSC_KEY_PASSWORD",
    "Remove-Item Env:CSC_LINK",
    "Remove-Item Env:CSC_KEY_PASSWORD",
    "Verify packaged Windows plugin sandbox helper",
    "apps/desktop/release/win-unpacked/resources/native/windows/codex-switcher-plugin-sandbox.exe",
    "Packaged Windows AppContainer helper not found",
    "Packaged Windows AppContainer helper is not a PE executable",
    "CODEX_SWITCHER_WINDOWS_CSC_LINK",
    "CODEX_SWITCHER_WINDOWS_CSC_KEY_PASSWORD",
    "WIN_CSC_LINK",
    "WIN_CSC_KEY_PASSWORD",
    "Verify Windows installer",
    "Get-ChildItem apps/desktop/release -Filter *.exe",
    "Windows installer not found",
    "Smoke-install Windows package",
    "package-install-win32.json",
    "npm run desktop:package:linux",
    "release/$(basename \"$appimage\")",
    "release/$(basename \"$deb\")",
    "Smoke-install Linux package",
    "package-install-linux.json",
    "Install and verify bubblewrap",
    "sudo dpkg --add-architecture i386",
    "sudo apt-get install --yes bubblewrap apparmor-utils libc6:i386 libcrypt1:i386",
    "bwrap --version",
    "Allow bubblewrap user namespaces on Ubuntu runners",
    "/etc/apparmor.d/codex-switcher-bwrap",
    "apparmor_parser -r",
    "codex-switcher-linux-x64",
    "codex-switcher-macos",
    "codex-switcher-windows-x64",
    "release:",
    "needs: [package-macos, package-windows, package-linux]",
    "startsWith(github.ref, 'refs/tags/desktop-v')",
    "contents: write",
    "GH_REPO: ${{ github.repository }}",
    "actions/download-artifact@v8",
    "pattern: codex-switcher-*",
    "merge-multiple: true",
    "path: release-assets",
    "Flatten release assets",
    "release-assets-flat",
    "Generate optional update manifests",
    "CODEX_SWITCHER_UPDATE_SIGNING_KEY",
    "create-update-manifest.mjs",
    "verify-update-manifest.mjs",
    "--key-file",
    "manifest.json",
    "gh release view",
    "gh release upload",
    "--clobber",
    "gh release create",
    "--verify-tag",
    "--generate-notes",
    "--prerelease",
  ];

  for (const content of requiredContent) {
    assert.ok(workflow.includes(content), `desktop package workflow should include: ${content}`);
  }
  assert.ok(installSmoke.includes("package-install-recovery.ts"));
  assert.ok(installSmoke.includes('findAncestorBySuffix(installedExecutable, ".app")'));
  assert.ok(installSmoke.includes("rollbackSmoke"));
  assert.equal(workflow.match(/actions\/checkout@v7/g)?.length, 4);
  assert.equal(workflow.match(/actions\/setup-node@v6/g)?.length, 3);
  assert.equal(workflow.match(/actions\/upload-artifact@v7/g)?.length, 3);
  assert.equal(workflow.match(/if-no-files-found: error/g)?.length, 6);
  assert.equal(workflow.match(/actions\/upload-artifact@v4/g)?.length, 3);
  assert.equal(workflow.match(/retention-days: 14/g)?.length, 3);
  assert.equal(workflow.match(/contents: read/g)?.length, 1);
  assert.equal(workflow.match(/contents: write/g)?.length, 1);
});
