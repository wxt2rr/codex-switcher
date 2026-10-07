import { parse as parseJsonc } from "jsonc-parser";
import { parseDocument } from "yaml";

import type { GatewayProtocol } from "../protocol.js";
import type { AgentAdapterProfile, AgentConfigFormat, GatewayAgentId } from "./contracts.js";
import { AGENT_PROFILE_BY_ID, BUILT_IN_AGENT_PROFILES } from "./profiles.js";

/**
 * A metadata-only view of an existing Agent configuration.
 *
 * The credential value is deliberately never returned.  Import callers can
 * use `credentialPresent` to ask the user to map the existing secret into a
 * protected account, while the Gateway state only stores a secret reference.
 */
export interface AgentConfigurationImport {
  agentId: GatewayAgentId;
  displayName: string;
  configPath: string;
  format: AgentConfigFormat;
  protocol: GatewayProtocol;
  model?: string;
  baseUrl?: string;
  reasoningProfile?: string;
  fallbackModelId?: string;
  subAgentModelId?: string;
  credentialPresent: boolean;
  warnings: string[];
}

export function resolveAgentProfile(value: string): AgentAdapterProfile {
  const normalized = value.trim().toLowerCase();
  const direct = AGENT_PROFILE_BY_ID.get(normalized as GatewayAgentId);
  if (direct) return direct;
  const alias = BUILT_IN_AGENT_PROFILES.find((profile) => profile.aliases.some((item) => item.toLowerCase() === normalized));
  if (alias) return alias;
  throw new Error(`Unknown gateway agent '${value}'`);
}

export function importAgentConfiguration(profile: AgentAdapterProfile, content: string): AgentConfigurationImport {
  const warnings: string[] = [];
  const parsed = parseAgentConfig(profile.format, content, warnings);
  const model = readStringAtPath(parsed, profile.modelPath);
  const baseUrl = normalizeUrl(readStringAtPath(parsed, profile.baseUrlPath));
  const reasoningProfile = profile.reasoningPath ? readStringAtPath(parsed, profile.reasoningPath) : "";
  const fallbackModelId = profile.fallbackModelPath ? readStringAtPath(parsed, profile.fallbackModelPath) : "";
  const subAgentModelId = profile.subAgentModelPath ? readStringAtPath(parsed, profile.subAgentModelPath) : "";
  const credentialPresent = Boolean(readStringAtPath(parsed, profile.tokenPath));
  if (!model) warnings.push(`Agent '${profile.id}' configuration has no explicit model.`);
  if (!baseUrl) warnings.push(`Agent '${profile.id}' configuration has no explicit Base URL.`);
  if (credentialPresent) warnings.push("Credential material was detected but was not imported; map it through protected account storage.");
  else warnings.push("No credential material was imported; map a protected account before enabling this Agent.");
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

function parseAgentConfig(format: AgentConfigFormat, content: string, warnings: string[]): unknown {
  if (!content.trim()) return {};
  try {
    if (format === "json" || format === "jsonc") return parseJsonc(content) as unknown;
    if (format === "yaml") return parseDocument(content).toJS() as unknown;
    if (format === "env") return parseEnv(content);
    return parseToml(content);
  } catch (error) {
    warnings.push(`Agent configuration could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function readStringAtPath(value: unknown, path: string): string {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!isRecord(current)) return "";
    current = current[part];
  }
  return typeof current === "string" ? current.trim() : "";
}

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    result[match[1]!] = unquote(match[2]!);
  }
  return result;
}

function parseToml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = "";
  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!match) continue;
    const key = section ? `${section}.${match[1]}` : match[1]!;
    result[key] = unquote(match[2]!);
  }
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
