import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copyInstallForRollback, restoreInstallFromRollback } from "./update-rollback.js";

test("rollback backup atomically copies and restores a directory install", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-rollback-dir-"));
  const install = join(root, "install.app");
  const backup = join(root, "updates", "install.app");
  try {
    mkdirSync(join(install, "Contents"), { recursive: true });
    writeFileSync(join(install, "Contents", "version.txt"), "1.0.0", "utf8");
    copyInstallForRollback(install, backup);
    writeFileSync(join(install, "Contents", "version.txt"), "2.0.0", "utf8");
    restoreInstallFromRollback(install, backup);
    assert.equal(readFileSync(join(install, "Contents", "version.txt"), "utf8"), "1.0.0");
    assert.equal(existsSync(backup), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback backup copies and restores a single-file install", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-rollback-file-"));
  const install = join(root, "codex-switcher.exe");
  const backup = join(root, "updates", "codex-switcher.exe");
  try {
    writeFileSync(install, "version-one", "utf8");
    copyInstallForRollback(install, backup);
    writeFileSync(install, "version-two", "utf8");
    restoreInstallFromRollback(install, backup);
    assert.equal(readFileSync(install, "utf8"), "version-one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback backup refresh preserves the previous backup until replacement succeeds", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-rollback-refresh-"));
  const install = join(root, "install.app");
  const backup = join(root, "updates", "install.app");
  try {
    mkdirSync(install, { recursive: true });
    writeFileSync(join(install, "version.txt"), "1.0.0", "utf8");
    copyInstallForRollback(install, backup);
    writeFileSync(join(install, "version.txt"), "2.0.0", "utf8");
    copyInstallForRollback(install, backup);
    assert.equal(readFileSync(join(backup, "version.txt"), "utf8"), "2.0.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback restore fails closed when the backup is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-rollback-missing-"));
  try {
    assert.throws(() => restoreInstallFromRollback(join(root, "install"), join(root, "missing")), /Rollback backup is not available/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
