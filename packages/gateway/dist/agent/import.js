import { parse as parseJsonc } from "jsonc-parser";
import { parseDocument } from "yaml";
import { AGENT_PROFILE_BY_ID, BUILT_IN_AGENT_PROFILES } from "./profiles.js";
export function resolveAgentProfile(value) {
    const normalized = value.trim().toLowerCase();
    const direct = AGENT_PROFILE_BY_ID.get(normalized);
    if (direct)
        return direct;
    const alias = BUILT_IN_AGENT_PROFILES.find((profile) => profile.aliases.some((item) => item.toLowerCase() === normalized));
    if (alias)
        return alias;
    throw new Error(`Unknown gateway agent '${value}'`);
}
export function importAgentConfiguration(profile, content) {
    const warnings = [];
    const parsed = parseAgentConfig(profile.format, content, warnings);
    const model = readStringAtPath(parsed, profile.modelPath);
    const baseUrl = normalizeUrl(readStringAtPath(parsed, profile.baseUrlPath));
    const reasoningProfile = profile.reasoningPath ? readStringAtPath(parsed, profile.reasoningPath) : "";
    const fallbackModelId = profile.fallbackModelPath ? readStringAtPath(parsed, profile.fallbackModelPath) : "";
    const subAgentModelId = profile.subAgentModelPath ? readStringAtPath(parsed, profile.subAgentModelPath) : "";
    const credentialPresent = Boolean(readStringAtPath(parsed, profile.tokenPath));
    if (!model)
        warnings.push(`Agent '${profile.id}' configuration has no explicit model.`);
    if (!baseUrl)
        warnings.push(`Agent '${profile.id}' configuration has no explicit Base URL.`);
    if (credentialPresent)
        warnings.push("Credential material was detected but was not imported; map it through protected account storage.");
    else
        warnings.push("No credential material was imported; map a protected account before enabling this Agent.");
    return {
        agentId: profile.id,
        displayName: profile.displayName,
        configPath: profile.configPath,
        format: profile.format,
        protocol: profile.defaultProtocol,
        ...(model ? { model } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(reasoningProfile ? { reasoningProfile } : {}),
        ...(fallbackModelId ? { fallbackModelId } : {}),
        ...(subAgentModelId ? { subAgentModelId } : {}),
        credentialPresent,
        warnings,
    };
}
function parseAgentConfig(format, content, warnings) {
    if (!content.trim())
        return {};
    try {
        if (format === "json" || format === "jsonc")
            return parseJsonc(content);
        if (format === "yaml")
            return parseDocument(content).toJS();
        if (format === "env")
            return parseEnv(content);
        return parseToml(content);
    }
    catch (error) {
        warnings.push(`Agent configuration could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}
function readStringAtPath(value, path) {
    const parts = path.split(".").filter(Boolean);
    let current = value;
    for (const part of parts) {
        if (!isRecord(current))
            return "";
        current = current[part];
    }
    return typeof current === "string" ? current.trim() : "";
}
function parseEnv(content) {
    const result = {};
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match)
            continue;
        result[match[1]] = unquote(match[2]);
    }
    return result;
}
function parseToml(content) {
    const result = {};
    let section = "";
    for (const line of content.split(/\r?\n/)) {
        const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            continue;
        }
        const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
        if (!match)
            continue;
        const key = section ? `${section}.${match[1]}` : match[1];
        result[key] = unquote(match[2]);
    }
    return result;
}
function unquote(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
function normalizeUrl(value) {
    return value.replace(/\/+$/, "");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=import.js.map