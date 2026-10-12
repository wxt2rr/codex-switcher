import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginSettingsStore } from "./settings.js";
test("plugin settings are schema validated and encrypted at rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-settings-"));
    const store = new PluginSettingsStore(join(root, "settings.enc.json"));
    const schema = {
        type: "object",
        properties: {
            baseUrl: { type: "string", title: "Base URL" },
            enabled: { type: "boolean", title: "Enabled", default: true },
            apiKey: { type: "string", title: "API key", secret: true },
        },
        required: ["baseUrl", "apiKey"],
    };
    const saved = await store.set("demo", { baseUrl: "https://example.com", apiKey: "secret-value" }, schema);
    assert.deepEqual(saved, { baseUrl: "https://example.com", enabled: true, apiKey: "secret-value" });
    assert.deepEqual(await store.get("demo"), saved);
    const raw = await readFile(join(root, "settings.enc.json"), "utf8");
    assert.equal(raw.includes("secret-value"), false);
    await assert.rejects(store.set("demo", { baseUrl: "not-a-url" }, schema), /required/);
});
//# sourceMappingURL=settings.test.js.map