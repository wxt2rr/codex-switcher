"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function detectPlatform() {
  return process.env.CODEX_SWITCHER_BIN_PLATFORM || process.platform;
}

function resolveInvokedAs(fallback) {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return fallback;
  }

  const base = path.basename(scriptPath);
  const normalized = base.replace(/\.(c|m)?js$/i, "").replace(/\.ts$/i, "");
  return normalized || fallback;
}

function resolveNodeCliScript() {
  return process.env.CODEX_SWITCHER_BIN_NODE_CLI || path.join(repoRoot(), "scripts", "node-cli.ts");
}

function resolveTscCli() {
  if (process.env.CODEX_SWITCHER_BIN_TSX_CLI) {
    return process.env.CODEX_SWITCHER_BIN_TSX_CLI;
  }
  try {
    return require.resolve("tsx/cli");
  } catch {
    return require.resolve("tsx/dist/cli.mjs");
  }
}

function resolveLegacyScript() {
  return (
    process.env.CODEX_SWITCHER_BIN_LEGACY_SCRIPT ||
    path.join(repoRoot(), "plugins", "codex-switcher", "scripts", "codex-switcher")
  );
}

function spawnAndMirror(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`launcher terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function launchNodeCli(invokedAs) {
  const env = {
    ...process.env,
    CODEX_SWITCHER_INVOKED_AS: invokedAs,
  };
  const code = await spawnAndMirror(
    process.execPath,
    [resolveTscCli(), resolveNodeCliScript(), ...process.argv.slice(2)],
    { env },
  );
  process.exit(code);
}

async function launchLegacyBash(invokedAs) {
  const env = {
    ...process.env,
    CODEX_SWITCHER_INVOKED_AS: invokedAs,
  };
  const code = await spawnAndMirror(resolveLegacyScript(), process.argv.slice(2), { env });
  process.exit(code);
}

async function runCodexSw() {
  const invokedAs = resolveInvokedAs("codex-sw");
  if (detectPlatform() === "win32") {
    await launchNodeCli(invokedAs);
    return;
  }
  await launchLegacyBash(invokedAs);
}

async function runCodexSwNode() {
  await launchNodeCli(resolveInvokedAs("codex-sw-node"));
}

module.exports = {
  runCodexSw,
  runCodexSwNode,
};
