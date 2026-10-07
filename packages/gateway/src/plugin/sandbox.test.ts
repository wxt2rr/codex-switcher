import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { buildPluginLaunchSpec, PluginSandboxUnavailableError } from "./sandbox.js";
import type { GatewayPluginManifest } from "./host.js";

const manifest: GatewayPluginManifest = {
  id: "provider-demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1 as const,
  entry: "index.js",
  permissions: ["provider"],
};

test("macOS plugin launch uses sandbox-exec and denies network by default", () => {
  const launch = buildPluginLaunchSpec(manifest, "/tmp/plugin", { platform: "darwin", sandboxExecutable: "/test/sandbox-exec", nodeExecutable: "/usr/local/bin/node" });
  assert.equal(launch.command, "/test/sandbox-exec");
  assert.equal(launch.sandbox.kind, "macos-sandbox-exec");
  assert.equal(launch.args[0], "-p");
  assert.match(launch.args[1] ?? "", /allow default/);
  assert.match(launch.args[1] ?? "", /deny file-read\*/);
  assert.doesNotMatch(launch.args[1] ?? "", /\(allow network-outbound\)/);
  assert.doesNotMatch(launch.args[1] ?? "", /\(allow file-write\*/);
});

test("Linux plugin launch uses bubblewrap and isolates the network without the permission", () => {
  const launch = buildPluginLaunchSpec(manifest, "/tmp/plugin", { platform: "linux", sandboxExecutable: "/usr/bin/bwrap", nodeExecutable: "/usr/bin/node" });
  assert.equal(launch.command, "/usr/bin/bwrap");
  assert.equal(launch.sandbox.kind, "linux-bubblewrap");
  assert.ok(launch.args.includes("--unshare-net"));
  assert.ok(launch.args.includes("--die-with-parent"));
  if (existsSync("/etc")) {
    const etcIndex = launch.args.indexOf("/etc");
    assert.ok(etcIndex > 0);
    assert.equal(launch.args[etcIndex - 1], "--ro-bind");
    assert.equal(launch.args[etcIndex + 1], "/etc");
  }
  const portable = buildPluginLaunchSpec(manifest, "/tmp/plugin", { platform: "linux", sandboxExecutable: "/usr/bin/bwrap", nodeExecutable: "/missing/node/bin/node" });
  assert.equal(portable.args.includes("/missing/node/bin"), false);
});

test("required sandbox mode refuses unsupported platforms instead of silently downgrading", () => {
  assert.throws(
    () => buildPluginLaunchSpec(manifest, "/tmp/plugin", { platform: "win32", mode: "required" }),
    (error) => error instanceof PluginSandboxUnavailableError,
  );
  const fallback = buildPluginLaunchSpec(manifest, "/tmp/plugin", { platform: "win32", mode: "best-effort" });
  assert.equal(fallback.sandbox.kind, "none");
  assert.match(fallback.sandbox.reason ?? "", /unavailable|not installed/);
});

test("Windows uses the explicit AppContainer launcher and forwards only declared capabilities", () => {
  const launch = buildPluginLaunchSpec({ ...manifest, id: "windows-plugin", permissions: ["provider", "network"] }, "C:\\plugin", {
    platform: "win32",
    windowsSandboxExecutable: process.execPath,
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
  });
  assert.equal(launch.command, process.execPath);
  assert.equal(launch.sandbox.kind, "windows-app-container");
  assert.deepEqual(launch.args, [
    "--profile", "windows-plugin",
    "--cwd", "C:\\plugin",
    "--node", "C:\\Program Files\\nodejs\\node.exe",
    "--entry", "C:\\plugin\\index.js",
    "--network",
  ]);
});

test("filesystem and network capabilities change only their corresponding OS policy", () => {
  const launch = buildPluginLaunchSpec({ ...manifest, permissions: ["provider", "filesystem", "network"] }, "/tmp/plugin", { platform: "linux", sandboxExecutable: "/usr/bin/bwrap", nodeExecutable: "/usr/bin/node" });
  assert.ok(launch.args.includes("--bind"));
  assert.ok(!launch.args.includes("--unshare-net"));
  const mac = buildPluginLaunchSpec({ ...manifest, permissions: ["provider", "filesystem"] }, "/tmp/plugin", { platform: "darwin", sandboxExecutable: "/test/sandbox-exec", nodeExecutable: "/usr/local/bin/node" });
  assert.match(mac.args[1] ?? "", /file-write\*/);
  assert.doesNotMatch(mac.args[1] ?? "", /\(allow network-outbound\)/);
});
