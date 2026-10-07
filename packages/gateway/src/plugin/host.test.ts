import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { buildPluginProcessEnvironment, encodePluginFrame, decodePluginFrame, PluginConcurrencyLimiter, PluginHost, PluginPermissionError, ProcessPluginTransport, RestartingPluginTransport, validatePluginManifest, type PluginRpcRequest, type PluginRpcResponse, type PluginTransport } from "./host.js";

test("plugin child environment runs Node entries from Electron without inheriting secrets", () => {
  const environment = buildPluginProcessEnvironment({ PLUGIN_TEST_FLAG: "enabled" });
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.PLUGIN_TEST_FLAG, "enabled");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  if (process.versions.electron) assert.equal(environment.ELECTRON_RUN_AS_NODE, "1");
  else assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
});

test("plugin manifest and frame validation reject unsafe or oversized data", () => {
  assert.equal(validatePluginManifest({ id: "provider-openai", name: "Provider", version: "1.0.0", apiVersion: 1, entry: "plugin.js", permissions: ["provider"] }), true);
  assert.equal(validatePluginManifest({ id: "Bad ID", name: "Provider", version: "1.0.0", apiVersion: 1, entry: "plugin.js", permissions: [] }), false);
  const request: PluginRpcRequest = { jsonrpc: "2.0", id: "1", method: "ping" };
  assert.deepEqual(decodePluginFrame(encodePluginFrame(request).trim()), request);
  assert.throws(() => encodePluginFrame({ ...request, params: { huge: "x".repeat(2 * 1024 * 1024) } }));
});

test("plugin host enforces concurrency, timeout and error propagation", async () => {
  let active = 0;
  let peak = 0;
  const transport: PluginTransport = {
    async send(request) {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, request.method === "slow" ? 30 : 1));
      active -= 1;
      const response: PluginRpcResponse = request.method === "error" ? { jsonrpc: "2.0", id: request.id, error: { code: 1, message: "bad" } } : { jsonrpc: "2.0", id: request.id, result: "ok" };
      return response;
    },
    async close() {},
  };
  const host = new PluginHost(transport, { maxConcurrent: 2, maxQueue: 2, timeoutMs: 10 });
  const results = await Promise.all([host.call("a"), host.call("b")]);
  assert.equal(results.length, 2);
  assert.ok(peak <= 2);
  await assert.rejects(host.call("slow"), /timed out/);
  await assert.rejects(host.call("error"), /bad/);
});

test("shared plugin concurrency limiter caps in-flight calls across plugin hosts", async () => {
  let active = 0;
  let peak = 0;
  const limiter = new PluginConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 2 });
  const transport: PluginTransport = {
    async send(request) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { jsonrpc: "2.0", id: request.id, result: "ok" };
    },
    async close() {},
  };
  const first = new PluginHost(transport, { maxConcurrent: 2, concurrencyLimiter: limiter });
  const second = new PluginHost(transport, { maxConcurrent: 2, concurrencyLimiter: limiter });
  await Promise.all([first.call("first"), second.call("second")]);
  assert.equal(peak, 1);
  await first.close();
  await second.close();
  limiter.close();
});

test("plugin host closes queued calls and rejects calls after shutdown", async () => {
  let release: (() => void) | undefined;
  const transport: PluginTransport = {
    send: async (request) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { jsonrpc: "2.0", id: request.id, result: "ok" };
    },
    async close() {},
  };
  const host = new PluginHost(transport, { maxConcurrent: 1, maxQueue: 1 });
  const first = host.call("first");
  const queued = host.call("queued");
  await host.close();
  await assert.rejects(queued, /Plugin host is closed/);
  await assert.rejects(host.call("after-close"), /Plugin host is closed/);
  release?.();
  await first;
});

test("plugin host cancels a timed-out transport request when supported", async () => {
  let cancelled = "";
  const transport: PluginTransport = {
    send: async () => await new Promise<PluginRpcResponse>(() => undefined),
    cancel(requestId) { cancelled = requestId; },
    async close() {},
  };
  const host = new PluginHost(transport, { timeoutMs: 10 });
  await assert.rejects(host.call("slow"), /timed out/);
  assert.ok(cancelled);
  await host.close();
});

test("plugin host enforces declared permissions before invoking a plugin", async () => {
  let calls = 0;
  const transport: PluginTransport = {
    async send(request) { calls += 1; return { jsonrpc: "2.0", id: request.id, result: "ok" }; },
    async close() {},
  };
  const host = new PluginHost(transport, {
    manifest: { id: "provider-test", name: "Provider", version: "1.0.0", apiVersion: 1, entry: "plugin.js", permissions: ["provider"] },
  });
  await host.call("provider.models");
  await assert.rejects(host.call("agent.readConfig"), (error) => error instanceof PluginPermissionError && error.permission === "agent");
  assert.equal(calls, 1);
});

test("restarting plugin transport recreates a crashed process and retries once", async () => {
  let starts = 0;
  const transport = new RestartingPluginTransport(() => {
    starts += 1;
    if (starts === 1) {
      return {
        async send() { throw new Error("plugin crashed"); },
        async close() {},
      };
    }
    return {
      async send(request) { return { jsonrpc: "2.0", id: request.id, result: "recovered" }; },
      async close() {},
    };
  });
  const response = await transport.send({ jsonrpc: "2.0", id: "1", method: "provider.models" });
  assert.equal(response.result, "recovered");
  assert.equal(starts, 2);
  await transport.close();
});

test("process plugin transport enforces an in-flight byte budget", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      callback();
    },
    highWaterMark: 1024,
  });
  const child = {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill() { return true; },
    on: stdout.on.bind(stdout),
  } as unknown as import("node:child_process").ChildProcessWithoutNullStreams;
  const logs: string[] = [];
  const transport = new ProcessPluginTransport(child, 8, 1024, (line) => logs.push(line));
  stdout.write("");
  stderr.write("authorization: Bearer sk-live-plugin-secret\n");
  assert.doesNotMatch(logs.join(""), /sk-live-plugin-secret/);
  assert.match(logs.join(""), /REDACTED/);
  await assert.rejects(transport.send({ jsonrpc: "2.0", id: "large", method: "provider.models", params: { payload: "x".repeat(2000) } }), /pending request bytes limit/);
  const response = transport.send({ jsonrpc: "2.0", id: "small", method: "provider.models" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const request = JSON.parse(writes[0]!.trim()) as PluginRpcRequest;
  stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "ok" })}\n`);
  assert.equal((await response).result, "ok");
  await transport.close();
});

test("process plugin transport completes a real JSONL child-process round trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-host-"));
  try {
    await writeFile(join(root, "plugin.mjs"), [
      "import readline from 'node:readline';",
      "const input = readline.createInterface({ input: process.stdin });",
      "input.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { method: request.method } }) + '\\n');",
      "});",
      "",
    ].join("\n"), "utf8");
    const manifest = { id: "real-child", name: "Real Child", version: "1.0.0", apiVersion: 1 as const, entry: "plugin.mjs", permissions: ["provider" as const] };
    const transport = ProcessPluginTransport.start(manifest, root, {}, { mode: "disabled" });
    const response = await transport.send({ jsonrpc: "2.0", id: "round-trip", method: "provider.describe" });
    assert.deepEqual(response.result, { method: "provider.describe" });
    await transport.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
