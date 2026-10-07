import assert from "node:assert/strict";
import test from "node:test";

import { createAgentAdapter, createRemoteAgentFileSystem } from "./adapter.js";
import { createSshAgentFileSystem } from "./remote.js";
import { BUILT_IN_AGENT_PROFILES } from "./profiles.js";
import type { RemoteAgentFileSystemTransport } from "./contracts.js";

test("remote Agent filesystem confines paths and preserves adapter recovery", async () => {
  const files = new Map<string, string>();
  const transport: RemoteAgentFileSystemTransport = {
    async read(path) { return files.get(path) ?? null; },
    async write(path, content) { files.set(path, content); },
    async remove(path) { files.delete(path); },
    async list(path) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      return [...files.keys()]
        .filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes("/"))
        .map((item) => item.slice(prefix.length));
    },
  };
  const fs = createRemoteAgentFileSystem("/home/demo", transport, {
    additionalRoots: ["/var/lib/codex-switcher"],
  });
  const profile = BUILT_IN_AGENT_PROFILES.find((item) => item.id === "codex")!;
  const adapter = createAgentAdapter(profile, { fs, stateDir: "/var/lib/codex-switcher", now: () => 123 });

  await fs.write(".codex/config.toml", "model = \"old\"\n");
  await adapter.apply({
    bindingId: "remote:codex",
    agentId: "codex",
    gatewayBaseUrl: "http://127.0.0.1:4317/routes/remote-codex",
    gatewayTokenRef: "remote-route-token",
    protocol: "responses",
    exposedModelId: "remote/model",
    enabled: true,
    updatedAt: 123,
  });
  assert.equal((await adapter.check("remote:codex")).state, "clean");
  await fs.write(".codex/config.toml", "model = \"user-edit\"\n");
  assert.equal((await adapter.check("remote:codex")).state, "drifted");
  await adapter.restore("remote:codex");
  assert.equal(await fs.read(".codex/config.toml"), "model = \"old\"\n");
  assert.deepEqual(await fs.list!("/var/lib/codex-switcher/agents"), []);

  await assert.rejects(fs.read("../outside.txt"), /escapes its configured root/);
  await assert.rejects(fs.write("/etc/passwd", "nope"), /outside the configured roots/);
});

test("SSH Agent filesystem encodes remote paths and payloads before running a script", async () => {
  const scripts: string[] = [];
  const fs = createSshAgentFileSystem("/home/demo", {
    host: "agent.example",
    runScript: async (script) => {
      scripts.push(script);
      if (script.includes('base64 "$path"')) {
        return { stdout: Buffer.from("remote config\n", "utf8").toString("base64"), stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });

  assert.equal(await fs.read(".codex/config 'quoted'.toml"), "remote config\n");
  await fs.write(".codex/config 'quoted'.toml", "token=do-not-log\n");
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    assert.doesNotMatch(script, /config 'quoted'/);
    assert.doesNotMatch(script, /do-not-log/);
  }
  await assert.rejects(fs.read("../../escape"), /escapes its configured root/);
});
