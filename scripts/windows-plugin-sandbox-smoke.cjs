const { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");

const args = parseArgs(process.argv.slice(2));
const launcher = required(args.launcher, "--launcher");
const node = required(args.node, "--node");
const evidencePath = args["evidence-out"] || process.env.CODEX_SWITCHER_EVIDENCE_OUT;
const root = mkdtempSync(join(tmpdir(), "codex-switcher-plugin-sandbox-"));
const homeRoot = mkdtempSync(join(process.env.USERPROFILE || tmpdir(), "codex-switcher-plugin-home-"));
const entry = join(root, "plugin.cjs");
const marker = join(root, "should-not-exist.txt");
const homeSecret = join(homeRoot, "secret.txt");
writeFileSync(homeSecret, "must stay unreadable", "utf8");

try {
  writeFileSync(entry, buildSmokePlugin({
    marker,
    expectWriteDenied: true,
  }), "utf8");
  const denied = runLauncher({
    profile: "codex-switcher-smoke-denied",
    entry,
    extraArgs: [],
  });
  const deniedPassed = denied.result.status === 0
    && denied.observation.writeDenied === true
    && denied.observation.readDenied === true
    && denied.observation.networkDenied === true
    && !existsSync(marker);

  const writableMarker = join(root, "filesystem-write.txt");
  const writableEntry = join(root, "filesystem-plugin.cjs");
  writeFileSync(writableEntry, buildSmokePlugin({
    marker: writableMarker,
    expectWriteDenied: false,
  }), "utf8");
  const writable = runLauncher({
    profile: "codex-switcher-smoke-filesystem",
    entry: writableEntry,
    extraArgs: ["--filesystem"],
  });
  const filesystemWriteGranted = writable.result.status === 0
    && writable.observation.writeDenied === false
    && writable.observation.readDenied === true
    && writable.observation.networkDenied === true
    && existsSync(writableMarker);

  const passed = deniedPassed && filesystemWriteGranted;
  writeEvidence(evidencePath, {
    schemaVersion: 1,
    platform: "win32",
    sandbox: "windows-app-container",
    nodeVersion: process.version,
    passed,
    checks: {
      writeDenied: denied.observation.writeDenied === true,
      homeReadDenied: denied.observation.readDenied === true,
      networkDenied: denied.observation.networkDenied === true,
      markerAbsent: !existsSync(marker),
      filesystemWriteGranted,
    },
  });
  if (!passed) process.exit(1);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(homeRoot, { recursive: true, force: true });
}

function buildSmokePlugin({ marker, expectWriteDenied }) {
  return `
    const fs = require("node:fs");
    const net = require("node:net");
    let writeDenied = false;
    let readDenied = false;
    let finished = false;
    let networkTimer;
    try { fs.writeFileSync(${JSON.stringify(marker)}, "unexpected"); } catch { writeDenied = true; }
    try { fs.readFileSync(${JSON.stringify(homeSecret)}, "utf8"); } catch { readDenied = true; }
    const finish = (networkDenied) => {
      if (finished) return;
      finished = true;
      clearTimeout(networkTimer);
      process.stdout.write(JSON.stringify({ writeDenied, readDenied, networkDenied }), () => process.exit(writeDenied === ${JSON.stringify(expectWriteDenied)} && readDenied && networkDenied ? 0 : 1));
    };
    const socket = net.createConnection({ host: "1.1.1.1", port: 80 });
    socket.setTimeout(1500);
    socket.once("connect", () => { socket.destroy(); finish(false); });
    socket.once("timeout", () => { socket.destroy(); finish(true); });
    socket.once("error", () => { finish(true); });
    networkTimer = setTimeout(() => { socket.destroy(); finish(true); }, 3000);
  `;
}

function runLauncher({ profile, entry, extraArgs }) {
  const result = spawnSync(launcher, ["--profile", profile, "--cwd", root, "--node", node, "--entry", entry, ...extraArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout || "");
  if (result.stderr) process.stderr.write(result.stderr);
  const output = (result.stdout || "").trim();
  if (!output) {
    throw new Error(`sandbox child emitted no JSON (status=${result.status ?? "null"}, stderr=${(result.stderr || "").trim() || "<empty>"})`);
  }
  return { result, observation: JSON.parse(output) };
}

function writeEvidence(path, value) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--") || !values[index + 1]) throw new Error("expected --launcher and --node arguments");
    output[key.slice(2)] = values[++index];
  }
  return output;
}

function required(value, flag) {
  if (!value) throw new Error(`missing ${flag}`);
  return value;
}
