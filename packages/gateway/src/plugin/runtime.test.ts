import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderRegistry } from "../provider/registry.js";
import type { PluginRpcRequest, PluginRpcResponse, PluginTransport } from "./host.js";
import { PluginRuntimeManager } from "./runtime.js";

const manifest = { id: "runtime-provider", name: "Runtime Provider", version: "1.0.0", apiVersion: 1 as const, entry: "index.js", permissions: ["provider" as const] };

function transportFactory(requests: PluginRpcRequest[]): PluginTransport {
  return {
    async send(request) {
      requests.push(request);
      const result = request.method === "provider.describe"
        ? { id: "runtime-provider", displayName: "Runtime Provider", authMethods: ["api_key"], endpoints: [{ protocol: "responses", baseUrl: "https://runtime.example/v1", modelsPath: "/models" }] }
        : { models: [{ id: "runtime-model" }] };
      return { jsonrpc: "2.0", id: request.id, result } satisfies PluginRpcResponse;
    },
    async close() {},
  };
}

test("plugin runtime activates an installed provider into the shared registry", async () => {
  const requests: PluginRpcRequest[] = [];
  const registry = new ProviderRegistry(false);
  const manager = new PluginRuntimeManager({ registry, transportFactory: () => transportFactory(requests) });
  const active = await manager.activate(manifest, "/tmp/runtime-provider");
  assert.equal(active.descriptor.id, "runtime-provider");
  assert.equal(registry.has("runtime-provider"), true);
  assert.equal(requests[0]?.method, "provider.describe");
  const models = await registry.get("runtime-provider").discoverModels({} as never, { accountId: "a", displayName: "A", authMethod: "api_key", secretRef: "secure:a", status: "active" }, undefined);
  assert.equal(models[0]?.id, "runtime-model");
  await manager.deactivate("runtime-provider");
  assert.equal(registry.has("runtime-provider"), false);
});

test("plugin runtime applies a global concurrency ceiling across providers", async () => {
  let active = 0;
  let peak = 0;
  const registry = new ProviderRegistry(false);
  const manifests = [
    { id: "runtime-one", name: "Runtime One", version: "1.0.0", apiVersion: 1 as const, entry: "index.js", permissions: ["provider" as const] },
    { id: "runtime-two", name: "Runtime Two", version: "1.0.0", apiVersion: 1 as const, entry: "index.js", permissions: ["provider" as const] },
  ];
  const manager = new PluginRuntimeManager({
    registry,
    globalConcurrency: { maxConcurrent: 1, maxQueue: 4 },
    transportFactory: (pluginManifest) => ({
      async send(request) {
        if (request.method === "provider.describe") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              id: pluginManifest.id,
              displayName: pluginManifest.name,
              authMethods: ["none"],
              endpoints: [{ protocol: "responses", baseUrl: `https://${pluginManifest.id}.example/v1`, modelsPath: "/models" }],
            },
          };
        }
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { jsonrpc: "2.0", id: request.id, result: { models: [{ id: `${pluginManifest.id}-model` }] } };
      },
      async close() {},
    }),
  });
  try {
    for (const pluginManifest of manifests) await manager.activate(pluginManifest, `/tmp/${pluginManifest.id}`);
    const account = { accountId: "local", displayName: "Local", authMethod: "none", secretRef: "none", status: "active" } as const;
    await Promise.all(manifests.map((pluginManifest) => registry.get(pluginManifest.id).discoverModels({} as never, account)));
    assert.equal(peak, 1);
  } finally {
    await manager.close();
  }
});

test("a hung provider times out without blocking another provider", async () => {
  const registry = new ProviderRegistry(false);
  const manifests = [
    { id: "hung-provider", name: "Hung Provider", version: "1.0.0", apiVersion: 1 as const, entry: "index.js", permissions: ["provider" as const] },
    { id: "healthy-provider", name: "Healthy Provider", version: "1.0.0", apiVersion: 1 as const, entry: "index.js", permissions: ["provider" as const] },
  ];
  const manager = new PluginRuntimeManager({
    registry,
    host: { timeoutMs: 15 },
    transportFactory: (pluginManifest) => ({
      async send(request) {
        if (request.method === "provider.describe") {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              id: pluginManifest.id,
              displayName: pluginManifest.name,
              authMethods: ["none"],
              endpoints: [{ protocol: "responses", baseUrl: `https://${pluginManifest.id}.example/v1`, modelsPath: "/models" }],
            },
          };
        }
        if (pluginManifest.id === "hung-provider") await new Promise<never>(() => undefined);
        return { jsonrpc: "2.0", id: request.id, result: { models: [{ id: "healthy-model" }] } };
      },
      async close() {},
    }),
  });
  try {
    for (const pluginManifest of manifests) await manager.activate(pluginManifest, `/tmp/${pluginManifest.id}`);
    const account = { accountId: "local", displayName: "Local", authMethod: "none", secretRef: "none", status: "active" } as const;
    await assert.rejects(
      registry.get("hung-provider").discoverModels({} as never, account),
      /timed out/,
    );
    const models = await registry.get("healthy-provider").discoverModels({} as never, account);
    assert.equal(models[0]?.id, "healthy-model");
  } finally {
    await manager.close();
  }
});

test("plugin runtime rejects a descriptor that attempts to impersonate another provider", async () => {
  const registry = new ProviderRegistry(false);
  const manager = new PluginRuntimeManager({ registry, transportFactory: () => ({
    async send(request) { return { jsonrpc: "2.0", id: request.id, result: { id: "other-provider", displayName: "Other", authMethods: ["api_key"], endpoints: [{ protocol: "responses", baseUrl: "https://example.test", modelsPath: "/models" }] } }; },
    async close() {},
  }) });
  await assert.rejects(manager.activate(manifest, "/tmp/runtime-provider"), /must use plugin id/);
  assert.equal(manager.list().length, 0);
});

test("plugin runtime activates a real child provider through the shared registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-runtime-"));
  const realManifest = { id: "real-runtime", name: "Real Runtime", version: "1.0.0", apiVersion: 1 as const, entry: "plugin.mjs", permissions: ["provider" as const] };
  try {
    await writeFile(join(root, "plugin.mjs"), [
      "import readline from 'node:readline';",
      "const input = readline.createInterface({ input: process.stdin });",
      "input.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  const result = request.method === 'provider.describe'",
      "    ? { id: 'real-runtime', displayName: 'Real Runtime', authMethods: ['none'], endpoints: [{ protocol: 'responses', baseUrl: 'https://runtime.example/v1', modelsPath: '/models' }] }",
      "    : { models: [{ id: 'real-runtime-model', protocols: ['responses'], capabilities: { tools: true, streaming: true } }] };",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      "});",
      "",
    ].join("\n"), "utf8");
    const registry = new ProviderRegistry(false);
    const manager = new PluginRuntimeManager({ registry, sandbox: { mode: "disabled" } });
    await manager.activate(realManifest, root);
    const models = await registry.get("real-runtime").discoverModels(
      {} as never,
      { accountId: "local", displayName: "Local", authMethod: "none", secretRef: "none", status: "active" },
    );
    assert.equal(models[0]?.id, "real-runtime-model");
    await manager.close();
    assert.equal(registry.has("real-runtime"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
