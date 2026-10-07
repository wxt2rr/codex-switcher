#!/usr/bin/env node

import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { arch, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

const releaseDir = resolve(process.argv[2] ?? join(process.cwd(), "apps", "desktop", "release"));
const evidencePath = process.env.CODEX_SWITCHER_INSTALL_EVIDENCE_OUT
  ? resolve(process.env.CODEX_SWITCHER_INSTALL_EVIDENCE_OUT)
  : join(process.cwd(), ".wxt", "evidence", `package-install-${process.platform}.json`);
const installRoot = mkdtempSync(join(tmpdir(), "codex-switcher-package-install-"));
const platform = process.platform;
const artifact = selectArtifact(releaseDir, platform, arch());
const evidence = {
  schemaVersion: 1,
  platform,
  architecture: arch(),
  artifact: basename(artifact),
  installationMode: platform === "win32" ? "nsis-silent" : platform === "darwin" ? "zip-extract" : "deb-extract",
  status: "failed",
};

try {
  const installedExecutable = platform === "win32"
    ? installWindows(artifact, installRoot)
    : platform === "darwin"
      ? extractMacOS(artifact, installRoot)
      : extractLinux(artifact, installRoot);
  evidence.installedExecutable = basename(installedExecutable);
  runRollbackSmoke(installedExecutable, installRoot);
  evidence.rollbackSmoke = "passed";
  evidence.status = "passed";
  writeEvidence(evidencePath, evidence);
  console.log(JSON.stringify(evidence));
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  writeEvidence(evidencePath, evidence);
  throw error;
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}

function selectArtifact(root, currentPlatform, currentArch) {
  if (!existsSync(root)) throw new Error(`release directory not found: ${root}`);
  const files = readdirSync(root).filter((item) => !item.startsWith("."));
  const candidates = currentPlatform === "win32"
    ? files.filter((item) => item.endsWith(".exe") && !/uninstall/i.test(item))
    : currentPlatform === "darwin"
      ? files.filter((item) => item.endsWith(".zip"))
      : files.filter((item) => item.endsWith(".deb"));
  if (!candidates.length) throw new Error(`no installable ${currentPlatform} artifact in ${root}`);
  if (currentPlatform === "darwin") {
    const preferred = currentArch === "arm64"
      ? candidates.find((item) => item.includes("arm64-mac"))
      : candidates.find((item) => !item.includes("arm64-mac"));
    return join(root, preferred ?? candidates[0]);
  }
  return join(root, candidates[0]);
}

function installWindows(installer, destination) {
  const result = spawnSync(installer, ["/S", `/D=${destination}`], { stdio: "inherit", timeout: 120_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows installer exited with status ${result.status}`);
  const executable = findByBasename(destination, "codex-switcher.exe");
  if (!executable) throw new Error("Windows installer did not materialize codex-switcher.exe");
  return executable;
}

function extractMacOS(zipPath, destination) {
  execFileSync("ditto", ["-x", "-k", zipPath, destination], { stdio: "inherit" });
  const executable = findByBasename(destination, "codex-switcher");
  if (!executable) throw new Error("macOS archive did not materialize the application executable");
  accessSync(executable, constants.X_OK);
  return executable;
}

function extractLinux(debPath, destination) {
  execFileSync("dpkg-deb", ["--extract", debPath, destination], { stdio: "inherit" });
  const executable = findByBasename(destination, "codex-switcher");
  if (!executable) throw new Error("Linux package did not materialize the application executable");
  accessSync(executable, constants.X_OK);
  return executable;
}

function runRollbackSmoke(installedExecutable, destination) {
  const rollbackRoot = join(destination, "..", `${basename(destination)}-rollback`);
  const rollbackBackup = join(rollbackRoot, basename(installedExecutable));
  const recoveryScript = join(process.cwd(), "scripts", "package-install-recovery.ts");
  const tsxCli = resolveTsxCli();
  execFileSync(process.execPath, [tsxCli, recoveryScript, installedExecutable, rollbackBackup], { stdio: "inherit" });
}

function resolveTsxCli() {
  try {
    return require.resolve("tsx/cli");
  } catch {
    return require.resolve("tsx/dist/cli.mjs");
  }
}

function findByBasename(root, expectedName) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name === expectedName) return path;
    }
  }
  return undefined;
}

function writeEvidence(path, value) {
  const directory = resolve(path, "..");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
