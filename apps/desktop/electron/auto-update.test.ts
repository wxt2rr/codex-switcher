import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDesktopAutoUpdateController, restartAfterRollback, type AutoUpdaterLike } from "./auto-update.js";
import { createUpdateRollbackJournal, signUpdateManifest, type DesktopUpdateManifest, validateUpdateManifest, verifyUpdateManifest } from "./update-security.js";
import { copyInstallForRollback, restoreInstallFromRollback } from "./update-rollback.js";

function fakeUpdater() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let checks = 0;
  let installs = 0;
  const updater: AutoUpdaterLike = {
    setFeedURL() {},
    async checkForUpdates() { checks += 1; listeners.get("update-downloaded")?.({ version: "2.0.0" }); },
    quitAndInstall() { installs += 1; },
    on(event, listener) { listeners.set(event, listener); },
  };
  return { updater, listeners, get checks() { return checks; }, get installs() { return installs; } };
}

test("failed upgraded boot restarts after the rollback install is restored", () => {
  const calls: string[] = [];
  assert.equal(restartAfterRollback("restored", {
    relaunch: () => calls.push("relaunch"),
    exit: (code) => calls.push(`exit:${code}`),
  }), true);
  assert.deepEqual(calls, ["relaunch", "exit:0"]);
  assert.equal(restartAfterRollback("armed", {
    relaunch: () => calls.push("unexpected-relaunch"),
    exit: () => calls.push("unexpected-exit"),
  }), false);
});

test("update manifest validation rejects malformed release metadata", () => {
  const valid = {
    version: "2.0.0",
    channel: "stable" as const,
    platforms: ["darwin-arm64"],
    artifactUrl: "https://updates.example.test/codex.pkg",
    sha256: "a".repeat(64),
    publishedAt: 1,
  };
  assert.equal(validateUpdateManifest(valid), true);
  assert.equal(validateUpdateManifest({ ...valid, sha256: "short" }), false);
  assert.equal(validateUpdateManifest({ ...valid, version: "latest" }), false);
  assert.equal(validateUpdateManifest({ ...valid, platforms: [] }), false);
  assert.deepEqual(verifyUpdateManifest({ ...valid, version: "latest" }), { ok: false, reason: "Update manifest metadata is invalid" });
});

test("explicitly unsigned development feeds report downloaded updates and install only after download", async () => {
  const fake = fakeUpdater();
  const controller = createDesktopAutoUpdateController(fake.updater, { feedUrl: "https://updates.example.test/codex/", requireSignedManifest: false });
  await assert.rejects(Promise.resolve().then(() => controller.install()), /No downloaded update/);
  const status = await controller.check();
  assert.equal(fake.checks, 1);
  assert.equal(status.state, "downloaded");
  assert.equal(status.version, "2.0.0");
  controller.install();
  assert.equal(fake.installs, 1);
});

test("auto update remains disabled without a feed and never calls the updater", async () => {
  const fake = fakeUpdater();
  const controller = createDesktopAutoUpdateController(fake.updater);
  assert.equal(controller.getStatus().state, "disabled");
  assert.equal((await controller.check()).state, "disabled");
  assert.equal(fake.checks, 0);
});

test("required signed updates fail closed when the manifest is missing", async () => {
  const fake = fakeUpdater();
  const controller = createDesktopAutoUpdateController(fake.updater, {
    feedUrl: "https://updates.example.test/codex/",
    trustedPublicKeyPem: "not-used-because-the-manifest-is-missing",
  });
  const status = await controller.check();
  assert.equal(status.state, "error");
  assert.equal(status.signatureVerified, false);
  assert.match(status.message ?? "", /manifest is required/);
  assert.equal(fake.checks, 0);
});

test("auto update verifies signed manifests and downloaded artifact bytes before install", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-update-"));
  const artifactPath = join(root, "codex-switcher.pkg");
  writeFileSync(artifactPath, "signed-payload");
  const manifest = {
    version: "2.0.0",
    channel: "stable" as const,
    platforms: ["darwin-arm64"],
    artifactUrl: "https://updates.example.test/codex.pkg",
    sha256: "8b2f7a1d7d2e2e0d40a9d0b0fdc1c2a3d69f0a6d3bbf9b1d1f1d4d0b7b6b0a2d",
    publishedAt: 1,
  };
  const signedManifest: DesktopUpdateManifest = { ...manifest, sha256: createHash("sha256").update("signed-payload").digest("hex") };
  signedManifest.signature = signUpdateManifest(signedManifest, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let installs = 0;
  const updater: AutoUpdaterLike = {
    setFeedURL() {},
    async checkForUpdates() {
      listeners.get("update-downloaded")?.({ version: "2.0.0", downloadedFile: artifactPath });
    },
    quitAndInstall() { installs += 1; },
    on(event, listener) { listeners.set(event, listener); },
  };
  const controller = createDesktopAutoUpdateController(updater, {
    feedUrl: "https://updates.example.test/codex/",
    manifest: signedManifest,
    trustedPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    requireSignedManifest: true,
  });
  const status = await controller.check();
  assert.equal(status.state, "downloaded");
  assert.equal(status.signatureVerified, true);
  controller.install();
  assert.equal(installs, 1);
});

test("auto update prepares a rollback journal and clears it after a healthy restart", async () => {
  const fake = fakeUpdater();
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-rollback-"));
  const journal = createUpdateRollbackJournal(join(root, "updates", "install-rollback.json"));
  const controller = createDesktopAutoUpdateController(fake.updater, {
    feedUrl: "https://updates.example.test/codex/",
    requireSignedManifest: false,
    rollbackJournal: journal,
    currentVersion: "1.0.0",
    backupPath: join(root, "codex-switcher-1.0.0.app"),
  });
  await controller.check();
  const status = controller.install();
  assert.equal(status.rollbackAvailable, true);
  assert.equal(journal.read()?.nextVersion, "2.0.0");
  const nextController = createDesktopAutoUpdateController(fake.updater, { currentVersion: "2.0.0", rollbackJournal: journal });
  nextController.markHealthy();
  assert.equal(journal.read(), undefined);
});

test("rollback journal arms the first boot and restores only after a repeated failed boot", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-rollback-boot-"));
  const journal = createUpdateRollbackJournal(join(root, "updates", "install-rollback.json"));
  journal.prepare({ currentVersion: "1.0.0", nextVersion: "2.0.0", backupPath: join(root, "old.app") }, 1);
  let restored = 0;
  assert.equal(journal.beginBoot("2.0.0", () => { restored += 1; }, 2), "armed");
  assert.equal(restored, 0);
  assert.equal(journal.beginBoot("2.0.0", () => { restored += 1; }, 3), "restored");
  assert.equal(restored, 1);
  assert.equal(journal.read(), undefined);
});

test("auto-update rollback restores the installed app after a failed upgraded boot", async () => {
  const fake = fakeUpdater();
  const root = mkdtempSync(join(tmpdir(), "codex-switcher-rollback-integration-"));
  const install = join(root, "install.app");
  const versionFile = join(install, "Contents", "version.txt");
  const backup = join(root, "updates", "install.app");
  const journal = createUpdateRollbackJournal(join(root, "updates", "install-rollback.json"));
  mkdirSync(join(install, "Contents"), { recursive: true });
  writeFileSync(versionFile, "1.0.0");
  const controller = createDesktopAutoUpdateController(fake.updater, {
    feedUrl: "https://updates.example.test/codex/",
    requireSignedManifest: false,
    rollbackJournal: journal,
    currentVersion: "1.0.0",
    backupPath: backup,
    prepareRollbackBackup: (path) => copyInstallForRollback(install, path),
    restoreRollbackBackup: (path) => restoreInstallFromRollback(install, path),
  });
  await controller.check();
  controller.install();
  assert.equal(readFileSync(versionFile, "utf8"), "1.0.0");
  writeFileSync(versionFile, "2.0.0");

  const firstBoot = createDesktopAutoUpdateController(fake.updater, {
    currentVersion: "2.0.0",
    rollbackJournal: journal,
    restoreRollbackBackup: (path) => restoreInstallFromRollback(install, path),
  });
  assert.equal(firstBoot.beginBoot(), "armed");
  assert.equal(readFileSync(versionFile, "utf8"), "2.0.0");
  assert.equal(firstBoot.beginBoot(), "restored");
  assert.equal(readFileSync(versionFile, "utf8"), "1.0.0");
  assert.equal(journal.read(), undefined);
});
