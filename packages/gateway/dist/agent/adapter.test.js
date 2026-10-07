import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentAdapter, createBuiltInAgentAdapters, createNodeAgentFileSystem, resolveAgentPath } from "./adapter.js";
import { BUILT_IN_AGENT_PROFILES } from "./profiles.js";
test("every built-in agent has a real adapter profile", () => {
    assert.equal(BUILT_IN_AGENT_PROFILES.length, 44);
    assert.equal(new Set(BUILT_IN_AGENT_PROFILES.map((item) => item.id)).size, 44);
    const adapters = createBuiltInAgentAdapters({
        fs: { read: async () => null, write: async () => undefined, remove: async () => undefined },
        stateDir: ".state",
    });
    assert.equal(adapters.size, 44);
});
test("agent adapter applies, detects drift, and restores an original config", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-adapter-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        const adapter = createAgentAdapter(BUILT_IN_AGENT_PROFILES.find((item) => item.id === "codex"), {
            fs,
            stateDir: ".switcher",
            now: () => 123,
        });
        await fs.write(".codex/config.toml", "model = \"old\"\nkeep = true\n");
        const snapshot = await adapter.apply({
            bindingId: "binding-codex",
            agentId: "codex",
            gatewayBaseUrl: "http://127.0.0.1:4317/routes/codex",
            gatewayTokenRef: "codex-switcher-route-token",
            protocol: "responses",
            exposedModelId: "provider/model",
            reasoningProfile: "high",
            enabled: true,
            updatedAt: 123,
        });
        assert.match(snapshot.expectedContent, /provider\/model/);
        assert.match(snapshot.expectedContent, /model_reasoning_effort = "high"/);
        assert.deepEqual(adapter.listFields().map((field) => field.kind), ["model", "base_url", "token", "reasoning"]);
        assert.equal((await adapter.check("binding-codex")).state, "clean");
        await fs.write(".codex/config.toml", "model = \"user-changed\"\nkeep = true\n\n");
        assert.equal((await adapter.check("binding-codex")).state, "drifted");
        await adapter.restore("binding-codex");
        assert.equal(await readFile(join(root, ".codex/config.toml"), "utf8"), "model = \"old\"\nkeep = true\n");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("agent adapter keeps the pre-wire snapshot across repeated applies", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-reapply-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        const profile = BUILT_IN_AGENT_PROFILES.find((item) => item.id === "codex");
        const adapter = createAgentAdapter(profile, { fs, stateDir: ".switcher", now: () => 123 });
        const binding = {
            bindingId: "reapply-codex",
            agentId: "codex",
            gatewayBaseUrl: "http://127.0.0.1:4317/routes/codex",
            gatewayTokenRef: "route-token",
            protocol: "responses",
            exposedModelId: "first-model",
            enabled: true,
            updatedAt: 123,
        };
        await fs.write(profile.configPath, "model = \"original\"\n");
        await adapter.apply(binding);
        await adapter.apply({ ...binding, exposedModelId: "second-model" });
        assert.match((await fs.read(profile.configPath)) ?? "", /second-model/);
        await adapter.restore(binding.bindingId);
        assert.equal(await fs.read(profile.configPath), "model = \"original\"\n");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("agent filesystem keeps local, WSL and Windows roots isolated", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-paths-"));
    const stateRoot = join(root, "state");
    try {
        const fs = createNodeAgentFileSystem(root, { additionalRoots: [stateRoot] });
        await fs.write(".codex/config.toml", "model = \"local\"\n");
        await fs.write(join(stateRoot, "binding.json"), "{}\n");
        assert.equal(await fs.read(".codex/config.toml"), "model = \"local\"\n");
        assert.equal(await fs.read(join(stateRoot, "binding.json")), "{}\n");
        await assert.rejects(fs.write("../outside.txt", "nope"), /escapes its configured root/);
        await assert.rejects(fs.write("/tmp/outside.txt", "nope"), /outside the configured roots/);
        assert.equal(resolveAgentPath("/mnt/c/Users/demo", ".codex\\config.toml", { pathStyle: "posix" }), "/mnt/c/Users/demo/.codex/config.toml");
        assert.equal(resolveAgentPath("C:\\Users\\demo", ".codex/config.toml", { pathStyle: "windows" }), "C:\\Users\\demo\\.codex\\config.toml");
        assert.throws(() => resolveAgentPath("C:\\Users\\demo", "C:\\tmp\\outside.txt", { pathStyle: "windows" }), /outside the configured roots/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("node agent filesystem replaces config files atomically and leaves no temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-atomic-write-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        await fs.write(".codex/config.toml", "model = \"first\"\n");
        await fs.write(".codex/config.toml", "model = \"second\"\n");
        assert.equal(await readFile(join(root, ".codex/config.toml"), "utf8"), "model = \"second\"\n");
        assert.deepEqual(await readdir(join(root, ".codex")), ["config.toml"]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("agent snapshots encode environment-scoped binding ids for Windows-safe filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-snapshot-path-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        const adapter = createAgentAdapter(BUILT_IN_AGENT_PROFILES.find((item) => item.id === "codex"), {
            fs,
            stateDir: ".switcher",
            now: () => 1,
        });
        await fs.write(".codex/config.toml", "model = \"old\"\n");
        await adapter.apply({
            bindingId: "work:codex",
            agentId: "codex",
            gatewayBaseUrl: "http://127.0.0.1:4317/routes/codex",
            gatewayTokenRef: "route-token",
            protocol: "responses",
            exposedModelId: "logical-codex",
            enabled: true,
            updatedAt: 1,
        });
        assert.deepEqual(await readdir(join(root, ".switcher", "agents")), ["work%3Acodex.json"]);
        assert.equal((await adapter.check("work:codex")).state, "clean");
        await adapter.restore("work:codex");
        assert.deepEqual(await readdir(join(root, ".switcher", "agents")), []);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("all built-in agent adapters apply, detect external edits, and restore their exact fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-fixtures-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        for (const profile of BUILT_IN_AGENT_PROFILES) {
            const initial = fixtureFor(profile);
            await fs.write(profile.configPath, initial);
            const adapter = createAgentAdapter(profile, { fs, stateDir: ".switcher", now: () => 456 });
            const binding = {
                bindingId: "fixture-" + profile.id,
                agentId: profile.id,
                gatewayBaseUrl: "http://127.0.0.1:4317/routes/" + profile.id,
                gatewayTokenRef: "route-token-" + profile.id,
                protocol: profile.defaultProtocol,
                exposedModelId: "logical-" + profile.id,
                enabled: true,
                updatedAt: 456,
            };
            const snapshot = await adapter.apply(binding);
            assert.match(snapshot.expectedContent, new RegExp("logical-" + profile.id));
            assert.equal((await adapter.check(binding.bindingId)).state, "clean", profile.id);
            await fs.write(profile.configPath, snapshot.expectedContent + "\n# external edit\n");
            assert.equal((await adapter.check(binding.bindingId)).state, "drifted", profile.id);
            await adapter.restore(binding.bindingId);
            assert.equal(await fs.read(profile.configPath), initial, profile.id);
        }
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("structured config writers preserve comments, unknown fields, and valid TOML/YAML syntax", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-agent-structured-"));
    try {
        const fs = createNodeAgentFileSystem(root);
        const jsonProfile = BUILT_IN_AGENT_PROFILES.find((item) => item.id === "claude");
        const jsonc = "{\n  // user comment must remain\n  \"env\": {\n    \"KEEP_ME\": \"untouched\"\n  },\n  \"unknown\": true\n}\n";
        await fs.write(jsonProfile.configPath, jsonc);
        const jsonAdapter = createAgentAdapter(jsonProfile, { fs, stateDir: ".switcher", now: () => 1 });
        await jsonAdapter.apply({
            bindingId: "jsonc",
            agentId: "claude",
            gatewayBaseUrl: "http://gateway.test",
            gatewayTokenRef: "secret-ref",
            protocol: "anthropic",
            exposedModelId: "claude-logical",
            enabled: true,
            updatedAt: 1,
        });
        const jsonUpdated = await fs.read(jsonProfile.configPath);
        assert.match(jsonUpdated ?? "", /user comment must remain/);
        assert.match(jsonUpdated ?? "", /KEEP_ME/);
        assert.match(jsonUpdated ?? "", /\"unknown\": true/);
        const tomlProfile = BUILT_IN_AGENT_PROFILES.find((item) => item.id === "codex");
        await fs.write(tomlProfile.configPath, "# keep this comment\nmodel = \"old\"\nopenai_base_url = \"https://old.test\"\n");
        const tomlAdapter = createAgentAdapter(tomlProfile, { fs, stateDir: ".switcher", now: () => 1 });
        await tomlAdapter.apply({
            bindingId: "toml",
            agentId: "codex",
            gatewayBaseUrl: "http://gateway.test",
            gatewayTokenRef: "secret-ref",
            protocol: "responses",
            exposedModelId: "codex-logical",
            enabled: true,
            updatedAt: 1,
        });
        const tomlUpdated = await fs.read(tomlProfile.configPath);
        assert.match(tomlUpdated ?? "", /# keep this comment/);
        assert.match(tomlUpdated ?? "", /openai_base_url = \"http:\/\/gateway\.test\"/);
        assert.doesNotMatch(tomlUpdated ?? "", /openai_base_url:/);
        const yamlProfile = BUILT_IN_AGENT_PROFILES.find((item) => item.id === "dsh");
        await fs.write(yamlProfile.configPath, "config:\n  providers:\n    codex-switcher:\n      baseURL: https://old.test\n      apiKey: old\nkeep: me\n");
        const yamlAdapter = createAgentAdapter(yamlProfile, { fs, stateDir: ".switcher", now: () => 1 });
        await yamlAdapter.apply({
            bindingId: "yaml",
            agentId: "dsh",
            gatewayBaseUrl: "http://gateway.test",
            gatewayTokenRef: "secret-ref",
            protocol: "responses",
            exposedModelId: "dsh-logical",
            enabled: true,
            updatedAt: 1,
        });
        const yamlUpdated = await fs.read(yamlProfile.configPath);
        assert.match(yamlUpdated ?? "", /baseURL: http:\/\/gateway\.test/);
        assert.match(yamlUpdated ?? "", /keep: me/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
function fixtureFor(profile) {
    if (profile.format === "toml")
        return "# fixture for " + profile.id + "\nmodel = \"old-" + profile.id + "\"\nkeep = true\n";
    if (profile.format === "yaml")
        return "config:\n  providers:\n    codex-switcher:\n      baseURL: https://old.test\n      apiKey: old\nkeep: true\n";
    if (profile.format === "env")
        return "# fixture for " + profile.id + "\nKEEP_ME=true\n";
    return "{\n  \"model\": \"old-" + profile.id + "\",\n  \"unknown\": true,\n  \"env\": { \"KEEP_ME\": \"yes\" }\n}\n";
}
//# sourceMappingURL=adapter.test.js.map