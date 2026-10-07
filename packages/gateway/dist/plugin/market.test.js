import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PluginInstallationStore, PluginMarket } from "./market.js";
const execFileAsync = promisify(execFile);
test("plugin market filters manifests and keeps a local cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-market-"));
    try {
        const market = new PluginMarket(PluginMarket.cachePath(root));
        const entries = await market.update("https://registry.example/plugins.json", { async fetchIndex() { return [{ id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] }, { id: "invalid id" }]; } });
        assert.equal(entries.length, 1);
        assert.equal((await market.list())[0]?.id, "provider-demo");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("plugin market refuses signed entries without an explicit trust verifier", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-market-signature-"));
    try {
        const signed = { id: "provider-signed", name: "Signed", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"], signature: "sig" };
        await assert.rejects(new PluginMarket(PluginMarket.cachePath(root)).update("https://registry.example/plugins.json", { async fetchIndex() { return [signed]; } }), /no configured market signature verifier/);
        const accepted = new PluginMarket(PluginMarket.cachePath(root), { verifySignature: async () => true });
        assert.equal((await accepted.update("https://registry.example/plugins.json", { async fetchIndex() { return [signed]; } })).length, 1);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("plugin installation store keeps an active version and rolls back a failed upgrade", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-install-"));
    const sourceOne = await mkdtemp(join(tmpdir(), "gateway-plugin-source-one-"));
    const sourceTwo = await mkdtemp(join(tmpdir(), "gateway-plugin-source-two-"));
    try {
        const store = new PluginInstallationStore(join(root, "installed"));
        const manifestOne = { id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] };
        const manifestTwo = { ...manifestOne, version: "1.1.0" };
        await writeFile(join(sourceOne, "index.js"), "one\n", "utf8");
        await writeFile(join(sourceTwo, "index.js"), "two\n", "utf8");
        await store.install(manifestOne, sourceOne);
        const upgraded = await store.install(manifestTwo, sourceTwo);
        assert.equal(upgraded.previousVersion, "1.0.0");
        assert.equal((await store.list())[0]?.version, "1.1.0");
        await assert.rejects(store.install(manifestTwo, sourceTwo), /already installed/);
        assert.equal((await store.list())[0]?.version, "1.1.0");
        assert.equal((await store.rollback("provider-demo")).version, "1.0.0");
        await store.remove("provider-demo");
        assert.equal((await store.list()).length, 0);
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(sourceOne, { recursive: true, force: true });
        await rm(sourceTwo, { recursive: true, force: true });
    }
});
test("plugin rollback keeps the current version active when the previous install is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-rollback-missing-"));
    const sourceOne = await mkdtemp(join(tmpdir(), "gateway-plugin-rollback-source-one-"));
    const sourceTwo = await mkdtemp(join(tmpdir(), "gateway-plugin-rollback-source-two-"));
    try {
        const store = new PluginInstallationStore(join(root, "installed"));
        const manifestOne = { id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] };
        const manifestTwo = { ...manifestOne, version: "1.1.0" };
        await writeFile(join(sourceOne, "index.js"), "one\n", "utf8");
        await writeFile(join(sourceTwo, "index.js"), "two\n", "utf8");
        await store.install(manifestOne, sourceOne);
        await store.install(manifestTwo, sourceTwo);
        await rm(join(root, "installed", "provider-demo", "1.0.0"), { recursive: true, force: true });
        await assert.rejects(store.rollback("provider-demo"), /previous version .* unavailable/);
        assert.equal((await store.list())[0]?.version, "1.1.0");
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(sourceOne, { recursive: true, force: true });
        await rm(sourceTwo, { recursive: true, force: true });
    }
});
test("plugin installation rejects path traversal and checksum mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-security-"));
    const source = await mkdtemp(join(tmpdir(), "gateway-plugin-security-source-"));
    try {
        const store = new PluginInstallationStore(join(root, "installed"));
        await writeFile(join(source, "index.js"), "secure\n", "utf8");
        assert.equal((await import("./host.js")).validatePluginManifest({ id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "../escape.js", permissions: ["provider"] }), false);
        assert.equal((await import("./host.js")).validatePluginManifest({ id: "provider-demo", name: "Demo", version: "1.0.0/../../escape", apiVersion: 1, entry: "index.js", permissions: ["provider"] }), false);
        await assert.rejects(store.install({ id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"], checksum: `sha256:${"0".repeat(64)}` }, source), /checksum verification failed/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(source, { recursive: true, force: true });
    }
});
test("plugin activation and rollback reject tampered installed versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-integrity-"));
    const sourceOne = await mkdtemp(join(tmpdir(), "gateway-plugin-integrity-source-one-"));
    const sourceTwo = await mkdtemp(join(tmpdir(), "gateway-plugin-integrity-source-two-"));
    try {
        const store = new PluginInstallationStore(join(root, "installed"));
        const manifestOne = { id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] };
        const manifestTwo = { ...manifestOne, version: "1.1.0" };
        await writeFile(join(sourceOne, "index.js"), "one\n", "utf8");
        await writeFile(join(sourceTwo, "index.js"), "two\n", "utf8");
        await store.install(manifestOne, sourceOne);
        await store.install(manifestTwo, sourceTwo);
        await writeFile(join(root, "installed", "provider-demo", "1.0.0", "index.js"), "tampered previous\n", "utf8");
        await assert.rejects(store.rollback("provider-demo"), /checksum verification failed/);
        await writeFile(join(root, "installed", "provider-demo", "1.1.0.manifest.json"), "{}\n", "utf8");
        await writeFile(join(root, "installed", "provider-demo", "1.1.0", "index.js"), "tampered active\n", "utf8");
        const listed = await store.list();
        assert.equal(listed[0]?.manifest, undefined);
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(sourceOne, { recursive: true, force: true });
        await rm(sourceTwo, { recursive: true, force: true });
    }
});
test("plugin installation accepts the explicit local/npm/git source contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-sources-"));
    const source = await mkdtemp(join(tmpdir(), "gateway-plugin-local-source-"));
    try {
        const store = new PluginInstallationStore(join(root, "installed"));
        const manifest = { id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] };
        await writeFile(join(source, "index.js"), "module.exports = {};\n", "utf8");
        assert.equal((await store.installFromSource(manifest, { kind: "local", path: source })).version, "1.0.0");
        const calls = [];
        const runner = async (command, args) => {
            calls.push({ command, args });
            return { code: 1, stdout: "", stderr: "offline test" };
        };
        await assert.rejects(store.installFromSource({ ...manifest, version: "1.1.0" }, { kind: "npm", spec: "provider-demo@1.1.0" }, runner), /npm plugin download failed/);
        await assert.rejects(store.installFromSource({ ...manifest, version: "1.2.0" }, { kind: "git", url: "https://example.invalid/provider-demo.git", ref: "v1" }, runner), /git plugin clone failed/);
        assert.deepEqual(calls.map((call) => [call.command, ...call.args.slice(0, 3)]), [
            ["npm", "pack", "--ignore-scripts", "--json"],
            ["git", "clone", "--depth", "1"],
        ]);
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(source, { recursive: true, force: true });
    }
});
test("plugin installation materializes npm and git sources before activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-source-success-"));
    const npmSource = await mkdtemp(join(tmpdir(), "gateway-plugin-npm-source-"));
    const gitSource = await mkdtemp(join(tmpdir(), "gateway-plugin-git-source-"));
    try {
        await writeFile(join(npmSource, "index.js"), "module.exports = { source: 'npm' };\n", "utf8");
        await writeFile(join(gitSource, "index.js"), "module.exports = { source: 'git' };\n", "utf8");
        const calls = [];
        const runner = async (command, args, cwd) => {
            calls.push({ command, args });
            if (command === "npm") {
                const archive = join(cwd, "provider-demo.tgz");
                const packageRoot = join(cwd, "package");
                await cp(npmSource, packageRoot, { recursive: true });
                await execFileAsync("tar", ["-czf", archive, "-C", cwd, "package"]);
                await rm(packageRoot, { recursive: true, force: true });
                return { code: 0, stdout: JSON.stringify([{ filename: "provider-demo.tgz" }]), stderr: "" };
            }
            if (command === "tar") {
                const result = await execFileAsync(command, [...args], { cwd });
                return { code: 0, stdout: result.stdout, stderr: result.stderr };
            }
            if (command === "git") {
                const destination = args[args.length - 1];
                assert.equal(typeof destination, "string");
                await cp(gitSource, destination, { recursive: true });
                return { code: 0, stdout: "", stderr: "" };
            }
            throw new Error(`unexpected command: ${command}`);
        };
        const store = new PluginInstallationStore(join(root, "installed"));
        const baseManifest = { id: "provider-demo", name: "Demo", apiVersion: 1, entry: "index.js", permissions: ["provider"] };
        const npmInstalled = await store.installFromSource({ ...baseManifest, version: "2.0.0" }, { kind: "npm", spec: "provider-demo@2.0.0" }, runner);
        const gitInstalled = await store.installFromSource({ ...baseManifest, version: "3.0.0" }, { kind: "git", url: "https://example.invalid/provider-demo.git", ref: "v3" }, runner);
        assert.equal(npmInstalled.version, "2.0.0");
        assert.equal(gitInstalled.version, "3.0.0");
        assert.deepEqual(calls.map((call) => call.command), ["npm", "tar", "git"]);
        assert.equal((await store.list()).length, 1);
        assert.equal((await store.list())[0]?.version, "3.0.0");
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(npmSource, { recursive: true, force: true });
        await rm(gitSource, { recursive: true, force: true });
    }
});
test("signed plugins require an explicit trust verifier", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-plugin-signature-"));
    const source = await mkdtemp(join(tmpdir(), "gateway-plugin-signature-source-"));
    try {
        const manifest = { id: "provider-signed", name: "Signed", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"], signature: "signature" };
        await writeFile(join(source, "index.js"), "module.exports = {};\n", "utf8");
        await assert.rejects(new PluginInstallationStore(join(root, "without-verifier")).install(manifest, source), /no configured signature verifier/);
        const accepted = new PluginInstallationStore(join(root, "with-verifier"), { verifySignature: async (_value, checksum) => checksum.startsWith("sha256:") });
        assert.equal((await accepted.install(manifest, source)).version, "1.0.0");
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(source, { recursive: true, force: true });
    }
});
//# sourceMappingURL=market.test.js.map