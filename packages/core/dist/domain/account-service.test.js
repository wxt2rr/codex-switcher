import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEMA_VERSION } from "../state/store.js";
import { createAccountService, } from "./account-service.js";
function createSampleState() {
    return {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        generatedAt: "2026-06-16T09:00:00.000Z",
        targets: {
            cli: { env: "default", account: "work" },
            app: { env: "default", account: "work" },
        },
        envs: {
            default: {
                name: "default",
                path: "/tmp/default-home",
                accounts: {
                    default: {
                        name: "default",
                        authMode: "auth",
                        runtime: {
                            preferredAuthMethod: "chatgpt",
                            openaiBaseUrlMode: "default",
                        },
                    },
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
        tasks: {
            recent: [],
        },
    };
}
test("account service lists accounts with current target markers", () => {
    const service = createAccountService();
    const result = service.listAccounts(createSampleState(), { envName: "default" });
    assert.equal(result.length, 3);
    assert.equal(result.find((item) => item.name === "work")?.isCurrentCli, true);
    assert.equal(result.find((item) => item.name === "work")?.isCurrentApp, true);
});
test("account service selects an account for the requested target", () => {
    const service = createAccountService();
    const next = service.selectAccount(createSampleState(), {
        envName: "default",
        accountName: "personal",
        target: "cli",
        now: "2026-06-16T09:05:00.000Z",
    });
    assert.equal(next.targets.cli.account, "personal");
    assert.equal(next.targets.cli.env, "default");
    assert.equal(next.targets.app.account, "personal");
    assert.equal(next.targets.app.env, "default");
});
test("account service keeps account pointers independent across different environments", () => {
    const service = createAccountService();
    const state = createSampleState();
    state.envs.project = {
        name: "project",
        path: "/tmp/project-home",
        accounts: {
            personal: state.envs.default.accounts.personal,
        },
    };
    state.targets.app = { env: "project", account: "personal" };
    const next = service.selectAccount(state, {
        envName: "default",
        accountName: "work",
        target: "cli",
        now: "2026-06-16T09:05:00.000Z",
    });
    assert.deepEqual(next.targets.cli, { env: "default", account: "work" });
    assert.deepEqual(next.targets.app, { env: "project", account: "personal" });
});
test("account service updates runtime settings for an account", () => {
    const service = createAccountService();
    const next = service.updateRuntime(createSampleState(), {
        envName: "default",
        accountName: "personal",
        runtime: {
            preferredAuthMethod: "apikey",
            openaiBaseUrlMode: "custom",
            openaiBaseUrl: "https://new.example.test/v1",
            providerId: "openai-compatible",
            model: "claude-sonnet",
        },
        now: "2026-06-16T09:07:00.000Z",
    });
    assert.equal(next.envs.default.accounts.personal.runtime.openaiBaseUrl, "https://new.example.test/v1");
    assert.equal(next.envs.default.accounts.personal.runtime.model, "claude-sonnet");
});
test("account service removes account and resets target pointers that reference it", () => {
    const service = createAccountService();
    const next = service.removeAccount(createSampleState(), {
        envName: "default",
        accountName: "work",
        now: "2026-06-16T09:10:00.000Z",
    });
    assert.equal(next.envs.default.accounts.work, undefined);
    assert.equal(next.targets.cli.account, "default");
});
test("account service rejects selecting an unknown account", () => {
    const service = createAccountService();
    assert.throws(() => service.selectAccount(createSampleState(), {
        envName: "default",
        accountName: "missing",
        target: "cli",
        now: "2026-06-16T09:12:00.000Z",
    }), (error) => {
        assert.equal(error.code, "ACCOUNT_NOT_FOUND");
        return true;
    });
});
//# sourceMappingURL=account-service.test.js.map