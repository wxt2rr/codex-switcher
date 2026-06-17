import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readLegacyState } from "./legacy.js";
test("legacy reader hydrates envs, accounts, runtime settings, and target pointers", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-"));
    const stateDir = join(root, ".codex-switcher");
    const envsDir = join(root, ".codex-envs");
    const defaultHome = join(root, ".codex");
    try {
        await mkdir(join(stateDir, "env-accounts", "default", "work"), { recursive: true });
        await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
        await mkdir(join(envsDir, "project-a", "home"), { recursive: true });
        await mkdir(defaultHome, { recursive: true });
        await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
        await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");
        await writeFile(join(stateDir, "env-accounts", "default", "work", "runtime.json"), JSON.stringify({
            preferred_auth_method: "chatgpt",
            openai_base_url_mode: "default",
            openai_base_url: "",
        }), "utf8");
        await writeFile(join(stateDir, "env-accounts", "default", "personal", "runtime.json"), JSON.stringify({
            preferred_auth_method: "apikey",
            openai_base_url_mode: "custom",
            openai_base_url: "https://proxy.example.test/v1",
        }), "utf8");
        const state = await readLegacyState({
            stateDir,
            envsDir,
            defaultHome,
            now: "2026-06-16T01:02:03.000Z",
        });
        assert.equal(state.targets.cli.account, "work");
        assert.equal(state.targets.app.account, "personal");
        assert.equal(state.envs.default.path, defaultHome);
        assert.equal(state.envs.default.accounts.personal.runtime.openaiBaseUrl, "https://proxy.example.test/v1");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("legacy reader hydrates auth metadata from account auth.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-auth-"));
    const stateDir = join(root, ".codex-switcher");
    const envsDir = join(root, ".codex-envs");
    const defaultHome = join(root, ".codex");
    try {
        await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
        await mkdir(defaultHome, { recursive: true });
        await writeFile(join(stateDir, "env-accounts", "default", "personal", "auth.json"), JSON.stringify({
            auth_mode: "apikey",
            OPENAI_API_KEY: "sk-test-1234567890",
        }), "utf8");
        const state = await readLegacyState({
            stateDir,
            envsDir,
            defaultHome,
            now: "2026-06-16T01:02:03.000Z",
        });
        assert.deepEqual(state.envs.default.accounts.personal.authData, {
            auth_mode: "apikey",
            OPENAI_API_KEY: "sk-test-1234567890",
        });
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=legacy.test.js.map