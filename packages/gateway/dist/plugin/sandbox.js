import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, win32 } from "node:path";
export class PluginSandboxUnavailableError extends Error {
    constructor(platform, detail) {
        super(`Plugin OS sandbox is unavailable on ${platform}: ${detail}`);
        this.name = "PluginSandboxUnavailableError";
    }
}
/**
 * Build the actual child-process command for a plugin. The host-level
 * permission checks remain authoritative; this layer adds an OS boundary so
 * a compromised plugin cannot silently become a normal child process.
 */
export function buildPluginLaunchSpec(manifest, cwd, options = {}) {
    const mode = options.mode ?? "required";
    const platform = options.platform ?? process.platform;
    const nodeExecutable = options.nodeExecutable ?? process.execPath;
    const entryIsAbsolute = platform === "win32" ? win32.isAbsolute(manifest.entry) : isAbsolute(manifest.entry);
    const entry = entryIsAbsolute ? manifest.entry : platform === "win32" ? win32.join(cwd, manifest.entry) : join(cwd, manifest.entry);
    if (mode === "disabled") {
        return { command: nodeExecutable, args: [entry], cwd, sandbox: { mode, kind: "none", reason: "explicitly disabled" } };
    }
    if (platform === "darwin") {
        const executable = options.sandboxExecutable ?? "/usr/bin/sandbox-exec";
        if (!isAvailable(executable) && !options.sandboxExecutable) {
            if (mode === "required")
                throw new PluginSandboxUnavailableError(platform, `missing ${executable}`);
            return unsandboxed(nodeExecutable, entry, cwd, mode, "sandbox-exec is not installed");
        }
        return {
            command: executable,
            args: ["-p", buildMacSandboxProfile(manifest, cwd), nodeExecutable, entry],
            cwd,
            sandbox: { mode, kind: "macos-sandbox-exec", executable },
        };
    }
    if (platform === "linux") {
        const executable = options.sandboxExecutable ?? findLinuxSandboxExecutable();
        if (!executable) {
            if (mode === "required")
                throw new PluginSandboxUnavailableError(platform, "bubblewrap (bwrap) is not installed");
            return unsandboxed(nodeExecutable, entry, cwd, mode, "bubblewrap is not installed");
        }
        return {
            command: executable,
            args: buildBubblewrapArgs(manifest, cwd, nodeExecutable, entry),
            cwd,
            sandbox: { mode, kind: "linux-bubblewrap", executable },
        };
    }
    if (platform === "win32") {
        const executable = options.windowsSandboxExecutable ?? findWindowsSandboxExecutable();
        if (!executable || !isAvailable(executable)) {
            if (mode === "required")
                throw new PluginSandboxUnavailableError(platform, "the Windows AppContainer launcher is not installed");
            return unsandboxed(nodeExecutable, entry, cwd, mode, "the Windows AppContainer launcher is not installed");
        }
        const args = ["--profile", manifest.id, "--cwd", cwd, "--node", nodeExecutable, "--entry", entry];
        if (manifest.permissions.includes("network"))
            args.push("--network");
        if (manifest.permissions.includes("filesystem"))
            args.push("--filesystem");
        return {
            command: executable,
            args,
            cwd,
            sandbox: { mode, kind: "windows-app-container", executable },
        };
    }
    if (mode === "required") {
        throw new PluginSandboxUnavailableError(platform, "native process sandbox integration is not available");
    }
    return unsandboxed(nodeExecutable, entry, cwd, mode, "native process sandbox is unavailable on this platform");
}
function unsandboxed(nodeExecutable, entry, cwd, mode, reason) {
    return { command: nodeExecutable, args: [entry], cwd, sandbox: { mode, kind: "none", reason } };
}
function isAvailable(path) {
    return Boolean(path) && existsSync(path);
}
function findLinuxSandboxExecutable() {
    const configured = process.env.CODEX_SWITCHER_BWRAP?.trim();
    if (configured && isAvailable(configured))
        return configured;
    for (const candidate of ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]) {
        if (isAvailable(candidate))
            return candidate;
    }
    return undefined;
}
function findWindowsSandboxExecutable() {
    const configured = process.env.CODEX_SWITCHER_WINDOWS_SANDBOX?.trim();
    if (configured && isAvailable(configured))
        return configured;
    const resourcesPath = process.resourcesPath;
    const candidates = [
        resourcesPath ? join(resourcesPath, "native", "windows", "codex-switcher-plugin-sandbox.exe") : "",
        join(process.cwd(), "resources", "native", "windows", "codex-switcher-plugin-sandbox.exe"),
        join(process.cwd(), "apps", "desktop", "resources", "native", "windows", "codex-switcher-plugin-sandbox.exe"),
    ];
    return candidates.find(isAvailable);
}
function buildMacSandboxProfile(manifest, cwd) {
    const home = homedir();
    const lines = [
        "(version 1)",
        "(allow default)",
        // A deny-after-default policy keeps dyld/V8 and Node's private macOS
        // dependencies runnable, while the home-directory boundary prevents a
        // plugin from reading Codex Switcher state and credentials.
        `(deny file-read* (subpath \"${escapeProfilePath(home)}\"))`,
        `(allow file-read-metadata (subpath \"${escapeProfilePath(home)}\"))`,
        `(allow file-read* (subpath \"${escapeProfilePath(cwd)}\"))`,
        "(deny file-write*)",
    ];
    if (manifest.permissions.includes("filesystem"))
        lines.push(`(allow file-write* (subpath \"${escapeProfilePath(cwd)}\"))`);
    if (!manifest.permissions.includes("network"))
        lines.push("(deny network-outbound)");
    return lines.join(" ");
}
function buildBubblewrapArgs(manifest, cwd, nodeExecutable, entry) {
    const args = [
        "--die-with-parent",
        "--new-session",
        "--unshare-pid",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
    ];
    // Node providers need the host's resolver and CA bundle when the manifest
    // explicitly grants network access. Keep the system configuration read-only
    // and outside the plugin's writable working directory; it contains no
    // Codex Switcher credential store.
    const systemRoots = new Set(["/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", dirname(nodeExecutable)]);
    for (const root of systemRoots) {
        if (existsSync(root))
            args.push("--ro-bind", root, root);
    }
    args.push("--ro-bind", cwd, cwd, "--chdir", cwd);
    if (!manifest.permissions.includes("filesystem")) {
        // The plugin can read its package but cannot mutate it without the
        // explicit filesystem capability. Its working directory remains a
        // read-only mount in the default policy.
        args.splice(args.lastIndexOf("--ro-bind"), 3, "--ro-bind", cwd, cwd);
    }
    else {
        args.splice(args.lastIndexOf("--ro-bind"), 3, "--bind", cwd, cwd);
    }
    if (!manifest.permissions.includes("network"))
        args.push("--unshare-net");
    args.push("--", nodeExecutable, entry);
    return args;
}
function escapeProfilePath(path) {
    return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
//# sourceMappingURL=sandbox.js.map