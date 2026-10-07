import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, win32 } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { parseDocument } from "yaml";
function pathModule(style) {
    return style === "windows" ? win32 : style === "posix" ? posix : undefined;
}
function isAbsoluteAgentPath(value) {
    return posix.isAbsolute(value) || win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}
function normalizeAgentRelativePath(path) {
    const portable = path.replaceAll("\\", "/");
    if (!portable || portable.startsWith("/") || /^[A-Za-z]:\//.test(portable)) {
        throw new Error(`Agent path must be relative: '${path}'`);
    }
    const segments = portable.split("/").filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.some((segment) => segment === "..")) {
        throw new Error(`Agent path escapes its configured root: '${path}'`);
    }
    return segments.join("/");
}
/** Resolve a local/WSL/Windows Agent path without allowing root escape. */
export function resolveAgentPath(root, requestedPath, options = {}) {
    const style = options.pathStyle ?? "native";
    const paths = pathModule(style);
    const rootResolve = paths?.resolve ?? resolve;
    const pathRelative = paths?.relative ?? relative;
    const roots = [root, ...(options.additionalRoots ?? [])].map((item) => rootResolve(item));
    const requestedIsAbsolute = isAbsoluteAgentPath(requestedPath);
    if (!requestedIsAbsolute) {
        const normalized = normalizeAgentRelativePath(requestedPath);
        const candidate = rootResolve(roots[0], normalized);
        const escaped = pathRelative(roots[0], candidate);
        if (escaped === ".." || escaped.startsWith(`..${paths?.sep ?? "/"}`) || (paths?.isAbsolute?.(escaped) ?? false)) {
            throw new Error(`Agent path escapes its configured root: '${requestedPath}'`);
        }
        return candidate;
    }
    const candidate = rootResolve(requestedPath);
    const allowed = roots.some((allowedRoot) => {
        const escaped = pathRelative(allowedRoot, candidate);
        return escaped === "" || (escaped !== ".." && !escaped.startsWith(`..${paths?.sep ?? "/"}`) && !(paths?.isAbsolute?.(escaped) ?? false));
    });
    if (!allowed)
        throw new Error(`Absolute Agent path is outside the configured roots: '${requestedPath}'`);
    return candidate;
}
export function createNodeAgentFileSystem(root, options = {}) {
    const resolveAgent = (path) => resolveAgentPath(root, path, options);
    return {
        async read(path) {
            try {
                return await readFile(resolveAgent(path), "utf8");
            }
            catch (error) {
                if (error.code === "ENOENT")
                    return null;
                throw error;
            }
        },
        async write(path, content) {
            const absolute = resolveAgent(path);
            await mkdir(dirname(absolute), { recursive: true });
            const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, content, "utf8");
                await rename(temporary, absolute);
            }
            finally {
                await rm(temporary, { force: true }).catch(() => undefined);
            }
        },
        async remove(path) { await rm(resolveAgent(path), { force: true }); },
        async list(path) {
            try {
                return await readdir(resolveAgent(path));
            }
            catch (error) {
                if (error.code === "ENOENT")
                    return [];
                throw error;
            }
        },
    };
}
/**
 * Adapt a remote transport to the same path-confined filesystem contract used
 * by every Agent adapter. The transport never receives caller-provided paths
 * before they have been resolved beneath the Agent root or an explicit
 * additional root.
 */
export function createRemoteAgentFileSystem(root, transport, options = { pathStyle: "posix" }) {
    const resolvedOptions = { ...options, pathStyle: options.pathStyle ?? "posix" };
    const resolveRemote = (path) => resolveAgentPath(root, path, resolvedOptions);
    return {
        async read(path) { return transport.read(resolveRemote(path)); },
        async write(path, content) { return transport.write(resolveRemote(path), content); },
        async remove(path) { return transport.remove(resolveRemote(path)); },
        async list(path) { return transport.list(resolveRemote(path)); },
    };
}
function digest(content) {
    return createHash("sha256").update(content).digest("hex");
}
function snapshotPath(stateDir, bindingId) {
    // Environment-scoped bindings use IDs such as "work:codex". Encode the
    // filename so the same snapshot layout is valid on Windows, while the
    // legacy path remains available for migration reads/removal.
    return join(stateDir, "agents", `${encodeURIComponent(bindingId)}.json`);
}
function legacySnapshotPath(stateDir, bindingId) {
    return join(stateDir, "agents", `${bindingId}.json`);
}
function snapshotPaths(stateDir, bindingId) {
    const current = snapshotPath(stateDir, bindingId);
    const legacy = legacySnapshotPath(stateDir, bindingId);
    return current === legacy ? [current] : [current, legacy];
}
function parseJson(content) {
    if (!content?.trim())
        return {};
    const withoutComments = content
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
    try {
        const parsed = JSON.parse(withoutComments);
        return isRecord(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function setPath(target, path, value) {
    const parts = path.split(".").filter(Boolean);
    if (!parts.length)
        return;
    let current = target;
    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isRecord(next))
            current[part] = {};
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}
function setTextValue(content, path, value, format) {
    if (format === "json" || format === "jsonc")
        return setJsonValue(content, path, value);
    if (format === "yaml")
        return setYamlValue(content, path, value);
    if (format === "toml")
        return setTomlValue(content, path, value);
    return setEnvValue(content, path, value);
}
function setJsonValue(content, path, value) {
    const original = content?.trim() ? content : "{}";
    try {
        const edits = modify(original, path.split(".").filter(Boolean), value, {
            formattingOptions: { insertSpaces: true, tabSize: 2, eol: original.includes("\r\n") ? "\r\n" : "\n" },
        });
        const updated = applyEdits(original, edits);
        return `${updated.replace(/[ \t]+$/gm, "").replace(/\s*$/, "")}\n`;
    }
    catch {
        const json = parseJson(content);
        setPath(json, path, value);
        return `${JSON.stringify(json, null, 2)}\n`;
    }
}
function setYamlValue(content, path, value) {
    try {
        const document = parseDocument(content?.trim() ? content : "{}", { keepSourceTokens: true });
        document.setIn(path.split(".").filter(Boolean), value);
        return document.toString().replace(/\s*$/, "") + "\n";
    }
    catch {
        const json = parseJson(content);
        setPath(json, path, value);
        return Object.entries(json).map(([key, item]) => `${key}: ${String(item)}`).join("\n") + "\n";
    }
}
function setTomlValue(content, path, value) {
    const original = content ?? "";
    const lines = original.split(/\r?\n/);
    const newline = original.includes("\r\n") ? "\r\n" : "\n";
    const parts = path.split(".").filter(Boolean);
    const key = parts.at(-1) ?? path;
    const sectionPath = parts.slice(0, -1).join(".");
    let currentSection = "";
    let targetIndex = -1;
    let sectionStart = lines.length;
    let sectionEnd = lines.length;
    const keyPattern = new RegExp(`^(\\s*)(["']?${escapeRegExp(key)}["']?)(\\s*=\\s*)(.*?)(\\s+#.*)?$`);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
        if (section) {
            if (currentSection === sectionPath && targetIndex < 0)
                sectionEnd = index;
            currentSection = section[1].trim();
            if (currentSection === sectionPath)
                sectionStart = index + 1;
            continue;
        }
        if (currentSection !== sectionPath || index < sectionStart)
            continue;
        const match = line.match(keyPattern);
        if (match && targetIndex < 0)
            targetIndex = index;
    }
    if (currentSection === sectionPath && targetIndex < 0)
        sectionEnd = lines.length;
    if (targetIndex >= 0) {
        const line = lines[targetIndex];
        const match = line.match(keyPattern);
        const comment = match[5] ?? "";
        lines[targetIndex] = `${match[1]}${match[2]}${match[3]}${quoteTomlString(value)}${comment}`;
    }
    else {
        const rendered = `${key} = ${quoteTomlString(value)}`;
        if (sectionPath) {
            const headerIndex = lines.findIndex((line) => new RegExp(`^\\s*\\[${escapeRegExp(sectionPath)}\\]\\s*$`).test(line));
            if (headerIndex >= 0)
                lines.splice(sectionEnd || lines.length, 0, rendered);
            else
                lines.push(`[${sectionPath}]`, rendered);
        }
        else {
            lines.push(rendered);
        }
    }
    return `${lines.join(newline).replace(/(?:\r?\n)+$/, "")}${newline}`;
}
function setEnvValue(content, path, value) {
    const key = path.split(".").at(-1) ?? path;
    const lines = (content ?? "").split(/\r?\n/);
    const escaped = escapeRegExp(key);
    const matcher = new RegExp(`^(\\s*(?:export\\s+)?)${escaped}(\\s*=\\s*)(.*?)(\\s+#.*)?$`);
    const rendered = `${key}=${value}`;
    const index = lines.findIndex((line) => matcher.test(line));
    if (index >= 0) {
        const match = lines[index].match(matcher);
        lines[index] = `${match[1]}${key}${match[2]}${value}${match[4] ?? ""}`;
    }
    else {
        lines.push(rendered);
    }
    return `${lines.filter((line, lineIndex) => line.length > 0 || lineIndex < lines.length - 1).join("\n").replace(/\s*$/, "")}\n`;
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function quoteTomlString(value) { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`; }
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function writeSnapshot(options, snapshot) {
    await options.fs.write(snapshotPath(options.stateDir, snapshot.bindingId), `${JSON.stringify(snapshot, null, 2)}\n`);
}
async function readSnapshot(options, bindingId) {
    for (const path of snapshotPaths(options.stateDir, bindingId)) {
        const raw = await options.fs.read(path);
        if (!raw)
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.expectedHash === "string" && typeof parsed.configPath === "string")
                return parsed;
        }
        catch {
            // Try the legacy path when a partially written/invalid current snapshot
            // is present rather than discarding a recoverable pre-migration copy.
        }
    }
    return null;
}
export function createAgentAdapter(profile, options) {
    const now = options.now ?? Date.now;
    const fields = [
        { id: "model", kind: "model", path: profile.modelPath, writable: true },
        { id: "base_url", kind: "base_url", path: profile.baseUrlPath, writable: true },
        { id: "token", kind: "token", path: profile.tokenPath, writable: true },
        ...(profile.reasoningPath ? [{ id: "reasoning", kind: "reasoning", path: profile.reasoningPath, writable: true }] : []),
        ...(profile.fallbackModelPath ? [{ id: "fallback_model", kind: "fallback_model", path: profile.fallbackModelPath, writable: true }] : []),
        ...(profile.subAgentModelPath ? [{ id: "sub_agent_model", kind: "sub_agent_model", path: profile.subAgentModelPath, writable: true }] : []),
    ];
    return {
        profile,
        async discover() {
            const raw = await options.fs.read(profile.configPath);
            return { installed: raw !== null, configPath: profile.configPath, format: profile.format };
        },
        listFields() { return fields; },
        async apply(binding) {
            if (binding.agentId !== profile.id)
                throw new Error(`Binding agent '${binding.agentId}' does not match '${profile.id}'`);
            const currentContent = await options.fs.read(profile.configPath);
            const previousSnapshot = await readSnapshot(options, binding.bindingId);
            const originalContent = previousSnapshot?.agentId === profile.id && currentContent === previousSnapshot.expectedContent
                ? previousSnapshot.originalContent
                : currentContent;
            let expectedContent = setTextValue(currentContent, profile.baseUrlPath, binding.gatewayBaseUrl, profile.format);
            expectedContent = setTextValue(expectedContent, profile.modelPath, binding.exposedModelId, profile.format);
            expectedContent = setTextValue(expectedContent, profile.tokenPath, binding.gatewayTokenRef, profile.format);
            if (profile.reasoningPath && binding.reasoningProfile)
                expectedContent = setTextValue(expectedContent, profile.reasoningPath, binding.reasoningProfile, profile.format);
            if (profile.fallbackModelPath && binding.fallbackModelId)
                expectedContent = setTextValue(expectedContent, profile.fallbackModelPath, binding.fallbackModelId, profile.format);
            if (profile.subAgentModelPath && binding.subAgentModelId)
                expectedContent = setTextValue(expectedContent, profile.subAgentModelPath, binding.subAgentModelId, profile.format);
            await options.fs.write(profile.configPath, expectedContent);
            const snapshot = {
                bindingId: binding.bindingId,
                agentId: binding.agentId,
                configPath: profile.configPath,
                originalContent,
                expectedContent,
                expectedHash: digest(expectedContent),
                capturedAt: now(),
            };
            await writeSnapshot(options, snapshot);
            return snapshot;
        },
        async unwire(bindingId) {
            await this.restore(bindingId);
        },
        async restore(bindingId) {
            const snapshot = await readSnapshot(options, bindingId);
            if (!snapshot || snapshot.agentId !== profile.id)
                return;
            if (snapshot.originalContent === null)
                await options.fs.remove(snapshot.configPath);
            else
                await options.fs.write(snapshot.configPath, snapshot.originalContent);
            for (const path of snapshotPaths(options.stateDir, bindingId))
                await options.fs.remove(path);
        },
        async check(bindingId) {
            const snapshot = await readSnapshot(options, bindingId);
            if (!snapshot || snapshot.agentId !== profile.id) {
                return { agentId: profile.id, bindingId, configPath: profile.configPath, state: "unwired", changed: false };
            }
            const actual = await options.fs.read(snapshot.configPath);
            if (actual === null) {
                return { agentId: profile.id, bindingId, configPath: snapshot.configPath, state: "missing", expectedHash: snapshot.expectedHash, changed: true };
            }
            const actualHash = digest(actual);
            return {
                agentId: profile.id,
                bindingId,
                configPath: snapshot.configPath,
                state: actualHash === snapshot.expectedHash ? "clean" : "drifted",
                expectedHash: snapshot.expectedHash,
                actualHash,
                changed: actualHash !== snapshot.expectedHash,
            };
        },
        async sync(binding) {
            return this.apply(binding);
        },
        async renameRefs(oldRef, newRef) {
            const current = await options.fs.read(profile.configPath);
            if (current === null || oldRef === newRef)
                return;
            const updated = current.split(oldRef).join(newRef);
            if (updated === current)
                return;
            await options.fs.write(profile.configPath, updated);
            const snapshots = await readSnapshotFiles(options);
            for (const snapshot of snapshots.filter((item) => item.agentId === profile.id && item.configPath === profile.configPath)) {
                snapshot.expectedContent = snapshot.expectedContent.split(oldRef).join(newRef);
                snapshot.expectedHash = digest(snapshot.expectedContent);
                await writeSnapshot(options, snapshot);
            }
        },
    };
}
async function readSnapshotFiles(options) {
    const names = await options.fs.list?.(join(options.stateDir, "agents")) ?? [];
    const snapshots = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
        const raw = await options.fs.read(join(options.stateDir, "agents", name));
        if (!raw)
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (isSnapshot(parsed))
                snapshots.push(parsed);
        }
        catch {
            // A corrupt sidecar is reported by check() for its binding and does not
            // prevent other agents from being renamed.
        }
    }
    return snapshots;
}
function isSnapshot(value) {
    return isRecord(value) && typeof value.bindingId === "string" && typeof value.agentId === "string"
        && typeof value.configPath === "string" && typeof value.expectedContent === "string" && typeof value.expectedHash === "string";
}
export function createBuiltInAgentAdapters(options) {
    return new Map([...getBuiltInProfiles()].map((profile) => [profile.id, createAgentAdapter(profile, options)]));
}
function getBuiltInProfiles() {
    // Late import avoids making registry consumers load every profile while
    // still keeping one canonical set of adapters.
    return [...AGENTS];
}
import { BUILT_IN_AGENT_PROFILES as AGENTS } from "./profiles.js";
//# sourceMappingURL=adapter.js.map