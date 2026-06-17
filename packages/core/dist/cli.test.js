import test from "node:test";
import assert from "node:assert/strict";
import { formatWhoami } from "./cli.js";
import { DEFAULT_SCHEMA_VERSION } from "./state/store.js";
const state = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T12:00:00.000Z",
    targets: {
        cli: { env: "default", account: "work" },
        app: { env: "default", account: "personal" },
    },
    envs: {
        default: {
            name: "default",
            path: "/tmp/default-home",
            accounts: {
                work: {
                    name: "work",
                    authMode: "auth",
                    runtime: {
                        preferredAuthMethod: "chatgpt",
                        openaiBaseUrlMode: "default",
                    },
                },
                personal: {
                    name: "personal",
                    authMode: "apikey",
                    runtime: {
                        preferredAuthMethod: "apikey",
                        openaiBaseUrlMode: "custom",
                        openaiBaseUrl: "https://proxy.example.test/v1",
                    },
                },
            },
        },
    },
    tasks: { recent: [] },
};
test("formatWhoami renders cli target", () => {
    assert.equal(formatWhoami(state, "cli"), "default/work");
});
test("formatWhoami renders both targets", () => {
    assert.equal(formatWhoami(state, "all"), "cli: default/work\napp: default/personal");
});
//# sourceMappingURL=cli.test.js.map