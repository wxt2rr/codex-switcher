import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { detectPlatform } from "./os.js";
const execFileAsync = promisify(execFile);
export function usageProxyFilePath(stateDir) {
    return join(stateDir, "usage_proxy");
}
export function normalizeUsageProxyValue(raw) {
    const value = raw.trim();
    if (!value || /\s/.test(value)) {
        throw new Error("invalid proxy value");
    }
    if (value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.startsWith("socks5://")) {
        return value;
    }
    return `http://${value}`;
}
export async function readUsageProxyState(stateDir, env = process.env, platform = process.platform) {
    const manual = await readManualUsageProxy(stateDir);
    if (manual) {
        return {
            source: "manual",
            value: manual,
        };
    }
    for (const key of [
        "CODEX_SWITCHER_USAGE_PROXY",
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ]) {
        const raw = env[key];
        if (!raw) {
            continue;
        }
        try {
            return {
                source: "auto-env",
                value: normalizeUsageProxyValue(raw),
            };
        }
        catch {
            continue;
        }
    }
    const system = await detectSystemUsageProxy(env, platform);
    if (system) {
        return {
            source: "auto-system",
            value: system,
        };
    }
    return {
        source: "off",
        value: "",
    };
}
export async function setManualUsageProxy(stateDir, value) {
    const normalized = normalizeUsageProxyValue(value);
    const file = usageProxyFilePath(stateDir);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${normalized}\n`, "utf8");
    return normalized;
}
export async function clearManualUsageProxy(stateDir) {
    await rm(usageProxyFilePath(stateDir), { force: true });
}
async function readManualUsageProxy(stateDir) {
    try {
        const raw = await readFile(usageProxyFilePath(stateDir), "utf8");
        return normalizeUsageProxyValue(raw);
    }
    catch {
        return null;
    }
}
async function detectSystemUsageProxy(env, platform) {
    if (env.DISABLE_SYSTEM_PROXY_DETECT === "true") {
        return null;
    }
    if (detectPlatform(platform) !== "macos") {
        return null;
    }
    try {
        const { stdout } = await execFileAsync("scutil", ["--proxy"]);
        return parseMacOsProxyDump(stdout);
    }
    catch {
        return null;
    }
}
function parseMacOsProxyDump(raw) {
    const httpsProxy = extractMacOsProxy(raw, "HTTPS");
    if (httpsProxy) {
        return httpsProxy;
    }
    const httpProxy = extractMacOsProxy(raw, "HTTP");
    if (httpProxy) {
        return httpProxy;
    }
    return extractMacOsProxy(raw, "SOCKS");
}
function extractMacOsProxy(raw, kind) {
    const enabled = matchProxyField(raw, `${kind}Enable`);
    const host = matchProxyField(raw, `${kind}Proxy`);
    const port = matchProxyField(raw, `${kind}Port`);
    if (enabled !== "1" || !host || !port) {
        return null;
    }
    try {
        return normalizeUsageProxyValue(`${kind === "SOCKS" ? "socks5" : "http"}://${host}:${port}`);
    }
    catch {
        return null;
    }
}
function matchProxyField(raw, field) {
    const match = raw.match(new RegExp(`^\\s*${field}\\s*:\\s*(.+)$`, "m"));
    return match?.[1]?.trim() || null;
}
//# sourceMappingURL=proxy.js.map