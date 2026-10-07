import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd, execPath, platform } from "node:process";

if (platform !== "darwin" && platform !== "linux") throw new Error(`POSIX sandbox smoke test is unsupported on ${platform}`);
const { buildPluginLaunchSpec } = await import("../packages/gateway/dist/plugin/sandbox.js");
const evidencePath = argumentValue("--evidence-out") ?? process.env.CODEX_SWITCHER_EVIDENCE_OUT;
const root = mkdtempSync(join(cwd(), ".plugin-sandbox-smoke-"));
const homeRoot = mkdtempSync(join(homedir(), ".plugin-sandbox-home-"));
const entry = join(root, "plugin.cjs");
const marker = join(root, "should-not-exist.txt");
const homeSecret = join(homeRoot, "secret.txt");
writeFileSync(homeSecret, "must stay unreadable", "utf8");

try {
  writeFileSync(entry, `
    const fs = require("node:fs");
    const net = require("node:net");
    let writeDenied = false;
    let readDenied = false;
    try { fs.writeFileSync(${JSON.stringify(marker)}, "unexpected"); } catch { writeDenied = true; }
    try { fs.readFileSync(${JSON.stringify(homeSecret)}, "utf8"); } catch { readDenied = true; }
    const finish = (networkDenied) => process.stdout.write(JSON.stringify({ writeDenied, readDenied, networkDenied }), () => process.exit(writeDenied && readDenied && networkDenied ? 0 : 1));
    const socket = net.createConnection({ host: "1.1.1.1", port: 80 });
    socket.setTimeout(1500);
    socket.once("connect", () => { socket.destroy(); finish(false); });
    socket.once("timeout", () => { socket.destroy(); finish(true); });
    socket.once("error", () => { finish(true); });
  `, "utf8");
  const manifest = { id: "posix-smoke", name: "POSIX smoke", version: "1.0.0", apiVersion: 1, entry: "plugin.cjs", permissions: ["provider"] };
  const launch = buildPluginLaunchSpec(manifest, root, { mode: "required", nodeExecutable: execPath });
  if (launch.sandbox.kind === "none") throw new Error("required POSIX sandbox resolved to an unsandboxed launch");
  const result = spawnSync(launch.command, launch.args, { cwd: launch.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  const observation = JSON.parse((result.stdout || "").trim());
  const passed = result.status === 0 && observation.writeDenied === true && observation.readDenied === true && observation.networkDenied === true && !existsSync(marker);
  writeEvidence(evidencePath, {
    schemaVersion: 1,
    platform,
    sandbox: launch.sandbox.kind,
    nodeVersion: process.version,
    passed,
    checks: {
      writeDenied: observation.writeDenied === true,
      homeReadDenied: observation.readDenied === true,
      networkDenied: observation.networkDenied === true,
      markerAbsent: !existsSync(marker),
    },
  });
  if (!passed) process.exit(result.status || 1);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(homeRoot, { recursive: true, force: true });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeEvidence(path, value) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
