import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderPluginManager } from "./manager.js";

const manifest = {
  id: "managed-provider",
  name: "Managed Provider",
  version: "1.0.0",
  apiVersion: 1 as const,
  entry: "plugin.mjs",
  permissions: ["provider" as const],
};

async function writePlugin(root: string, version = manifest.version): Promise<string> {
  const source = join(root, `source-${version}`);
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "plugin.mjs"), [
    "import readline from 'node:readline';",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  const request = JSON.parse(line);",
    "  if (request.method === 'provider.describe') {",
    "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { id: 'managed-provider', displayName: 'Managed Provider', authMethods: ['api_key'], endpoints: [{ protocol: 'responses', baseUrl: 'https://provider.example/v1', modelsPath: '/models' }] } }) + '\\n');",
    "  } else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n'); }",
    "});",
  ].join("\n"));
  return source;
}

test("provider plugin manager persists manifests, activates installed providers, and deactivates safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-manager-"));
  const manager = new ProviderPluginManager({ rootDir: root, sandbox: { mode: "disabled" } });
  try {
    const active = await manager.install(manifest, { kind: "local", path: await writePlugin(root) });
    assert.equal(active.descriptor.id, manifest.id);
    assert.equal(manager.registry.has(manifest.id), true);
    assert.equal((await manager.listInstalled())[0]?.manifest?.id, manifest.id);
    assert.equal(await manager.deactivate(manifest.id), true);
    assert.equal(manager.registry.has(manifest.id), false);
    const report = await manager.activateInstalled();
    assert.equal(report.activated.length, 1);
    assert.equal(report.failed.length, 0);
  } finally {
    await manager.close();
  }
});

test("provider plugin manager revalidates signed plugins before restart activation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-manager-signature-"));
  const signedManifest = { ...manifest, signature: "trusted-signature" };
  try {
    const trusted = new ProviderPluginManager({
      rootDir: root,
      sandbox: { mode: "disabled" },
      verifySignature: async (_value, checksum) => checksum.startsWith("sha256:"),
    });
    await trusted.install(signedManifest, { kind: "local", path: await writePlugin(root) });
    await trusted.close();

    const untrusted = new ProviderPluginManager({ rootDir: root, sandbox: { mode: "disabled" } });
    try {
      const report = await untrusted.activateInstalled();
      assert.equal(report.activated.length, 0);
      assert.equal(report.failed.length, 1);
      assert.match(report.failed[0]?.message ?? "", /no configured signature verifier/);
      assert.equal(untrusted.registry.has(manifest.id), false);
    } finally {
      await untrusted.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
