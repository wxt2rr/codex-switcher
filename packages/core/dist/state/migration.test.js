import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEMA_VERSION, createStateStore, } from "./store.js";
import { migrateLegacyState } from "./migration.js";
test("migration writes canonical core state and creates a backup snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-migration-"));
    const stateDir = join(root, ".codex-switcher");
    const envsDir = join(root, ".codex-envs");
    const defaultHome = join(root, ".codex");
    const coreRootDir = join(root, ".codex-switcher-core");
    try {
        await mkdir(join(stateDir, "env-accounts", "default", "work"), { recursive: true });
        await mkdir(defaultHome, { recursive: true });
        await mkdir(join(envsDir, "project-a", "home"), { recursive: true });
        await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
        await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
        await writeFile(join(stateDir, "env-accounts", "default", "work", "runtime.json"), JSON.stringify({
            preferred_auth_method: "chatgpt",
            openai_base_url_mode: "default",
        }), "utf8");
        const result = await migrateLegacyState({
            stateDir,
            envsDir,
            defaultHome,
            coreRootDir,
            now: "2026-06-16T05:00:00.000Z",
        });
        assert.equal(result.migrated.targets.cli.account, "work");
        assert.match(result.backupFile, /legacy-state-2026-06-16T05-00-00.000Z\.json$/);
        const backup = JSON.parse(await readFile(result.backupFile, "utf8"));
        assert.equal(backup.schemaVersion, DEFAULT_SCHEMA_VERSION);
        const stored = await createStateStore({ rootDir: coreRootDir }).load();
        assert.deepEqual(stored, result.migrated);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("migration restores previous core state when persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-migration-rollback-"));
    const stateDir = join(root, ".codex-switcher");
    const envsDir = join(root, ".codex-envs");
    const defaultHome = join(root, ".codex");
    const coreRootDir = join(root, ".codex-switcher-core");
    const previousState = {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        generatedAt: "2026-06-15T00:00:00.000Z",
        targets: {
            cli: { env: "default", account: "before" },
            app: { env: "default", account: "before" },
        },
        envs: {
            default: {
                name: "default",
                path: defaultHome,
                accounts: {
                    before: {
                        name: "before",
                        authMode: "auth",
                        runtime: {
                            preferredAuthMethod: "chatgpt",
                            openaiBaseUrlMode: "default",
                        },
                    },
                },
            },
        },
        tasks: {
            recent: [],
        },
    };
    try {
        await mkdir(join(stateDir, "env-accounts", "default", "work"), { recursive: true });
        await mkdir(defaultHome, { recursive: true });
        await mkdir(coreRootDir, { recursive: true });
        await createStateStore({ rootDir: coreRootDir }).save(previousState);
        await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
        await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
        await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
        await writeFile(join(stateDir, "env-accounts", "default", "work", "runtime.json"), JSON.stringify({
            preferred_auth_method: "chatgpt",
            openai_base_url_mode: "default",
        }), "utf8");
        await mkdir(join(coreRootDir, "core-state.json.tmp"), { recursive: true });
        await assert.rejects(() => migrateLegacyState({
            stateDir,
            envsDir,
            defaultHome,
            coreRootDir,
            now: "2026-06-16T06:00:00.000Z",
        }));
        const reloaded = await createStateStore({ rootDir: coreRootDir }).load();
        assert.deepEqual(reloaded, previousState);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=migration.test.js.map