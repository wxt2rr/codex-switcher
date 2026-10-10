import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLinuxAppImageInstallScript,
  createWindowsInstallScript,
  resolveUpdateInstallMode,
} from "./update-installer.js";

test("update installer selects platform-safe install modes", () => {
  assert.equal(resolveUpdateInstallMode("win-nsis", "win32"), "automatic");
  assert.equal(resolveUpdateInstallMode("linux-appimage", "linux"), "automatic");
  assert.equal(resolveUpdateInstallMode("mac-dmg", "darwin"), "manual");
  assert.equal(resolveUpdateInstallMode("linux-deb", "linux"), "unsupported");
});

test("Windows helper waits for the current process and launches the NSIS installer", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-installer-win-"));
  const scriptPath = join(root, "install.cmd");
  try {
    createWindowsInstallScript({
      artifactKind: "win-nsis",
      downloadedPath: "C:\\Users\\test user\\update.exe",
      currentPid: 1234,
      executablePath: "C:\\Program Files\\codex-switcher\\codex-switcher.exe",
    }, scriptPath);
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /PID eq 1234/);
    assert.match(script, /update\.exe/);
    assert.match(script, /\/S/);
    assert.match(script, /start \/wait/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Linux AppImage helper replaces the running image and relaunches it", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-installer-linux-"));
  const scriptPath = join(root, "install.sh");
  try {
    createLinuxAppImageInstallScript({
      artifactKind: "linux-appimage",
      downloadedPath: "/tmp/codex-switcher-update.AppImage",
      currentPid: 5678,
      executablePath: "/opt/codex-switcher.AppImage",
      appImagePath: "/opt/codex-switcher.AppImage",
    }, scriptPath);
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /kill -0 5678/);
    assert.match(script, /chmod \+x/);
    assert.match(script, /mv -f/);
    assert.match(script, /nohup/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
