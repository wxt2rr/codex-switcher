import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("create-update-index builds a platform-aware GitHub release index", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-index-"));
  const output = join(root, "latest.json");
  try {
    writeFileSync(join(root, "codex-switcher-1.2.3-arm64-mac.zip"), "mac");
    writeFileSync(join(root, "codex-switcher-1.2.3-arm64.dmg"), "dmg");
    writeFileSync(join(root, "codex-switcher-1.2.3.AppImage"), "linux");
    writeFileSync(join(root, "codex-switcher-1.2.3.exe"), "windows");
    writeFileSync(join(root, "codex-switcher-1.2.3.exe.blockmap"), "ignored");
    writeFileSync(join(root, "codex-switcher-1.2.3.exe.manifest.json"), "ignored");

    execFileSync(process.execPath, ["scripts/create-update-index.mjs",
      "--dir", root,
      "--version", "1.2.3",
      "--channel", "stable",
      "--release-url", "https://github.com/wxt2rr/codex-switcher/releases/tag/desktop-v1.2.3",
      "--artifact-base-url", "https://github.com/wxt2rr/codex-switcher/releases/download/desktop-v1.2.3",
      "--out", output,
    ], { cwd: process.cwd(), stdio: "pipe" });

    const index = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(index.version, "1.2.3");
    assert.equal(index.releaseUrl, "https://github.com/wxt2rr/codex-switcher/releases/tag/desktop-v1.2.3");
    assert.deepEqual(index.artifacts.map((item) => [item.platform, item.kind]).sort(), [
      ["darwin-arm64", "mac-dmg"],
      ["linux-x64", "linux-appimage"],
      ["win32-x64", "win-nsis"],
    ].sort());
    assert.equal(index.artifacts.filter((item) => item.platform === "darwin-arm64").length, 1);
    assert.equal(index.artifacts.every((item) => item.url.startsWith("https://github.com/")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
