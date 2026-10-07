import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("sandbox evidence verifier accepts complete redacted evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-sandbox-evidence-"));
  const path = join(root, "evidence.json");
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    platform: "darwin",
    sandbox: "macos-sandbox-exec",
    nodeVersion: "v25.0.0",
    passed: true,
    checks: { writeDenied: true, homeReadDenied: true, networkDenied: true, markerAbsent: true } as Record<string, boolean>,
  }), "utf8");
  const result = await execFileAsync(process.execPath, ["scripts/verify-sandbox-evidence.mjs", path]);
  assert.match(result.stdout, /sandbox evidence verified/);
});

test("sandbox evidence verifier requires the Windows filesystem capability check", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-windows-sandbox-evidence-"));
  const path = join(root, "evidence.json");
  const evidence = {
    schemaVersion: 1,
    platform: "win32",
    sandbox: "windows-app-container",
    nodeVersion: "v25.0.0",
    passed: true,
    checks: { writeDenied: true, homeReadDenied: true, networkDenied: true, markerAbsent: true } as Record<string, boolean>,
  };
  await writeFile(path, JSON.stringify(evidence), "utf8");
  await assert.rejects(execFileAsync(process.execPath, ["scripts/verify-sandbox-evidence.mjs", path]));
  evidence.checks.filesystemWriteGranted = true;
  await writeFile(path, JSON.stringify(evidence), "utf8");
  const result = await execFileAsync(process.execPath, ["scripts/verify-sandbox-evidence.mjs", path]);
  assert.match(result.stdout, /win32\/windows-app-container/);
});

test("sandbox evidence verifier rejects a failed check and secret-shaped data", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-sandbox-evidence-invalid-"));
  const path = join(root, "evidence.json");
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    platform: "linux",
    sandbox: "linux-bubblewrap",
    nodeVersion: "v25.0.0",
    passed: true,
    token: "sk-never-write",
    checks: { writeDenied: true, homeReadDenied: true, networkDenied: false, markerAbsent: true },
  }), "utf8");
  await assert.rejects(execFileAsync(process.execPath, ["scripts/verify-sandbox-evidence.mjs", path]));
});
