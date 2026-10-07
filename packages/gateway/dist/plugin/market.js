import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { validatePluginManifest } from "./host.js";
export class PluginMarket {
    cachePath;
    options;
    constructor(cachePath, options = {}) {
        this.cachePath = cachePath;
        this.options = options;
    }
    async update(url, client) {
        const payload = await client.fetchIndex(url);
        if (!Array.isArray(payload))
            throw new Error("Plugin market index must be an array");
        const entries = [];
        for (const item of payload) {
            if (!validatePluginManifest(item))
                continue;
            if (item.signature && !this.options.verifySignature)
                throw new Error(`Plugin '${item.id}' has no configured market signature verifier`);
            if (item.signature && this.options.verifySignature && !await this.options.verifySignature(item, item.checksum)) {
                throw new Error(`Plugin '${item.id}' market signature verification failed`);
            }
            const sourceValue = isRecord(item) ? item.source : undefined;
            const source = isPluginInstallSource(sourceValue) ? sourceValue : undefined;
            entries.push({ ...item, ...(source ? { source } : {}), updatedAt: Date.now() });
        }
        await mkdir(dirname(this.cachePath), { recursive: true });
        await atomicWrite(this.cachePath, `${JSON.stringify(entries, null, 2)}\n`);
        return entries;
    }
    async list() {
        try {
            const raw = await readFile(this.cachePath, "utf8");
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((item) => validatePluginMarketEntry(item)) : [];
        }
        catch {
            return [];
        }
    }
    static cachePath(root) { return join(root, "plugins", "market.json"); }
}
export function validatePluginMarketEntry(value) {
    if (!validatePluginManifest(value) || !isRecord(value))
        return false;
    if (value.description !== undefined && typeof value.description !== "string")
        return false;
    if (value.downloadUrl !== undefined && typeof value.downloadUrl !== "string")
        return false;
    if (value.updatedAt !== undefined && typeof value.updatedAt !== "number")
        return false;
    return value.source === undefined || isPluginInstallSource(value.source);
}
export class PluginInstallationStore {
    root;
    options;
    constructor(root, options = {}) {
        this.root = root;
        this.options = options;
    }
    async installFromSource(manifest, source, runCommand = runPluginCommand) {
        if (source.kind === "local")
            return this.install(manifest, source.path);
        const worktree = await mkdtemp(join(tmpdir(), "codex-switcher-plugin-"));
        try {
            const sourceDirectory = source.kind === "npm"
                ? await materializeNpmPlugin(source.spec, worktree, runCommand)
                : await materializeGitPlugin(source, worktree, runCommand);
            return await this.install(manifest, sourceDirectory);
        }
        finally {
            await rm(worktree, { recursive: true, force: true });
        }
    }
    async install(manifest, sourceDirectory) {
        if (!validatePluginManifest(manifest))
            throw new Error("Cannot install an invalid plugin manifest");
        const sourceInfo = await stat(sourceDirectory).catch(() => undefined);
        if (!sourceInfo?.isDirectory())
            throw new Error("Plugin source directory does not exist");
        const checksum = `sha256:${await hashDirectory(sourceDirectory)}`;
        if (manifest.checksum && manifest.checksum.toLowerCase() !== checksum) {
            throw new Error(`Plugin '${manifest.id}' checksum verification failed`);
        }
        if (manifest.signature && !this.options.verifySignature)
            throw new Error(`Plugin '${manifest.id}' has no configured signature verifier`);
        if (manifest.signature && this.options.verifySignature && !await this.options.verifySignature(manifest, checksum)) {
            throw new Error(`Plugin '${manifest.id}' signature verification failed`);
        }
        await stat(join(sourceDirectory, manifest.entry));
        const pluginRoot = join(this.root, manifest.id);
        const target = join(pluginRoot, manifest.version);
        const previous = await this.readActive(manifest.id);
        await mkdir(pluginRoot, { recursive: true });
        if (await stat(target).then(() => true).catch(() => false)) {
            throw new Error(`Plugin '${manifest.id}' version '${manifest.version}' is already installed`);
        }
        try {
            await cp(sourceDirectory, target, { recursive: true, force: false, errorOnExist: true });
            const manifestContent = JSON.stringify(manifest) + "\n";
            await atomicWrite(join(pluginRoot, `${manifest.version}.manifest.json`), manifestContent);
            await atomicWrite(join(pluginRoot, `${manifest.version}.manifest.sha256`), `${hashText(manifestContent)}\n`);
            await atomicWrite(join(pluginRoot, `${manifest.version}.checksum`), `${checksum}\n`);
            await atomicWrite(join(pluginRoot, "active.json"), JSON.stringify({ version: manifest.version, checksum, ...(previous ? { previousVersion: previous.version } : {}) }) + "\n");
        }
        catch (error) {
            // A failed copy or activation must not leave a directory that blocks the
            // next retry or looks installable to a later runtime scan.
            await rm(target, { recursive: true, force: true }).catch(() => undefined);
            await rm(join(pluginRoot, `${manifest.version}.manifest.json`), { force: true }).catch(() => undefined);
            await rm(join(pluginRoot, `${manifest.version}.manifest.sha256`), { force: true }).catch(() => undefined);
            await rm(join(pluginRoot, `${manifest.version}.checksum`), { force: true }).catch(() => undefined);
            throw error;
        }
        return { id: manifest.id, version: manifest.version, path: target, active: true, checksum, ...(previous ? { previousVersion: previous.version } : {}) };
    }
    async list() {
        let ids = [];
        try {
            ids = await readdir(this.root);
        }
        catch {
            return [];
        }
        const result = [];
        for (const id of ids) {
            const active = await this.readActive(id);
            if (!active)
                continue;
            const pluginRoot = join(this.root, id);
            const path = join(pluginRoot, active.version);
            const expectedChecksum = active.checksum ?? await this.readVersionChecksum(pluginRoot, active.version);
            const verifiedChecksum = expectedChecksum ? await verifyDirectoryChecksum(path, expectedChecksum) : undefined;
            const manifest = verifiedChecksum ? await this.readManifest(id, active.version) : undefined;
            result.push({ id, version: active.version, path, active: true, ...(manifest ? { manifest } : {}), ...(active.checksum ? { checksum: active.checksum } : {}), ...(active.previousVersion ? { previousVersion: active.previousVersion } : {}) });
        }
        return result;
    }
    async rollback(id) {
        const active = await this.readActive(id);
        if (!active?.previousVersion)
            throw new Error("Plugin '" + id + "' has no previous version to roll back to");
        const target = join(this.root, id, active.previousVersion);
        const targetInfo = await stat(target).catch(() => undefined);
        if (!targetInfo?.isDirectory())
            throw new Error(`Plugin '${id}' previous version '${active.previousVersion}' is unavailable`);
        const manifest = await this.readManifest(id, active.previousVersion);
        if (!manifest)
            throw new Error(`Plugin '${id}' previous version '${active.previousVersion}' manifest is invalid`);
        const pluginRoot = join(this.root, id);
        const previousPath = join(pluginRoot, active.previousVersion);
        const expectedPreviousChecksum = await this.readVersionChecksum(pluginRoot, active.previousVersion) ?? manifest.checksum;
        if (!expectedPreviousChecksum)
            throw new Error(`Plugin '${id}' previous version '${active.previousVersion}' checksum is unavailable`);
        const previousChecksum = await verifyDirectoryChecksum(previousPath, expectedPreviousChecksum);
        if (!previousChecksum)
            throw new Error(`Plugin '${id}' previous version '${active.previousVersion}' checksum verification failed`);
        await atomicWrite(join(this.root, id, "active.json"), JSON.stringify({ version: active.previousVersion, ...(previousChecksum ? { checksum: previousChecksum } : {}) }) + "\n");
        return { id, version: active.previousVersion, path: target, active: true, manifest, checksum: previousChecksum };
    }
    async remove(id) {
        await rm(join(this.root, id), { recursive: true, force: true });
    }
    async readActive(id) {
        try {
            const raw = JSON.parse(await readFile(join(this.root, id, "active.json"), "utf8"));
            if (!isRecord(raw) || typeof raw.version !== "string")
                return null;
            return { version: raw.version, ...(typeof raw.previousVersion === "string" ? { previousVersion: raw.previousVersion } : {}), ...(typeof raw.checksum === "string" ? { checksum: raw.checksum } : {}) };
        }
        catch {
            return null;
        }
    }
    async readManifest(id, version) {
        try {
            const manifestPath = join(this.root, id, `${version}.manifest.json`);
            const raw = await readFile(manifestPath, "utf8");
            const expected = (await readFile(join(this.root, id, `${version}.manifest.sha256`), "utf8")).trim();
            if (!/^sha256:[a-f0-9]{64}$/i.test(expected) || hashText(raw).toLowerCase() !== expected.toLowerCase())
                return undefined;
            const parsed = JSON.parse(raw);
            return validatePluginManifest(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    }
    async readVersionChecksum(pluginRoot, version) {
        try {
            const value = (await readFile(join(pluginRoot, `${version}.checksum`), "utf8")).trim();
            return /^sha256:[a-f0-9]{64}$/i.test(value) ? value : undefined;
        }
        catch {
            return undefined;
        }
    }
}
async function hashDirectory(root) {
    const hash = createHash("sha256");
    const walk = async (directory, relative = "") => {
        const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const entryPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                hash.update(`dir:${entryRelative}\n`);
                await walk(entryPath, entryRelative);
            }
            else if (entry.isFile()) {
                hash.update(`file:${entryRelative}\n`);
                hash.update(await readFile(entryPath));
            }
            else {
                throw new Error(`Unsupported plugin source entry '${entryRelative}'`);
            }
        }
    };
    await walk(root);
    return hash.digest("hex");
}
async function readInstalledChecksum(path) {
    try {
        const checksum = await hashDirectory(path);
        return `sha256:${checksum}`;
    }
    catch {
        return undefined;
    }
}
async function verifyDirectoryChecksum(path, expected) {
    const actual = await readInstalledChecksum(path);
    return actual && actual.toLowerCase() === expected.toLowerCase() ? actual : undefined;
}
function hashText(value) {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
async function materializeNpmPlugin(spec, worktree, runCommand) {
    if (!spec.trim())
        throw new Error("npm plugin spec is required");
    const packed = await runCommand("npm", ["pack", "--ignore-scripts", "--json", spec.trim()], worktree);
    if (packed.code !== 0)
        throw new Error(`npm plugin download failed: ${packed.stderr.trim() || packed.stdout.trim()}`);
    let payload;
    try {
        payload = JSON.parse(packed.stdout);
    }
    catch {
        throw new Error("npm plugin download returned invalid metadata");
    }
    const filename = Array.isArray(payload) && isRecord(payload[0]) && typeof payload[0].filename === "string" ? payload[0].filename : undefined;
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes(".."))
        throw new Error("npm plugin archive name is invalid");
    const archive = join(worktree, filename);
    await stat(archive);
    const extracted = join(worktree, "extract");
    await mkdir(extracted, { recursive: true });
    const unpacked = await runCommand("tar", ["-xzf", archive, "-C", extracted], worktree);
    if (unpacked.code !== 0)
        throw new Error(`npm plugin extraction failed: ${unpacked.stderr.trim() || unpacked.stdout.trim()}`);
    return join(extracted, "package");
}
async function materializeGitPlugin(source, worktree, runCommand) {
    if (!source.url.trim())
        throw new Error("git plugin URL is required");
    const repository = join(worktree, "repository");
    const args = ["clone", "--depth", "1", ...(source.ref?.trim() ? ["--branch", source.ref.trim()] : []), "--", source.url.trim(), repository];
    const cloned = await runCommand("git", args, worktree);
    if (cloned.code !== 0)
        throw new Error(`git plugin clone failed: ${cloned.stderr.trim() || cloned.stdout.trim()}`);
    return repository;
}
function runPluginCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2 * 1024 * 1024)
            child.kill(); });
        child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 2 * 1024 * 1024)
            child.kill(); });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code: code ?? 1, stdout: stdout.slice(0, 2 * 1024 * 1024), stderr: stderr.slice(0, 2 * 1024 * 1024) }));
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPluginInstallSource(value) {
    if (!isRecord(value) || typeof value.kind !== "string")
        return false;
    if (value.kind === "local")
        return typeof value.path === "string" && value.path.trim().length > 0;
    if (value.kind === "npm")
        return typeof value.spec === "string" && value.spec.trim().length > 0;
    if (value.kind === "git")
        return typeof value.url === "string" && value.url.trim().length > 0
            && (value.ref === undefined || typeof value.ref === "string");
    return false;
}
async function atomicWrite(path, content) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, "utf8");
        await rename(temporary, path);
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
//# sourceMappingURL=market.js.map