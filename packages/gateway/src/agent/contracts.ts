import type { GatewayProtocol } from "../protocol.js";

export const GATEWAY_AGENT_IDS = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "agy",
  "opencode",
  "openchamber",
  "mimocode",
  "pi",
  "aside",
  "omo",
  "goose",
  "cursor",
  "cursor-local",
  "zed",
  "vscode",
  "vscode-insiders",
  "air",
  "copilot",
  "crush",
  "dsh",
  "commandcode",
  "fx",
  "omp",
  "devin",
  "hermes",
  "morph",
  "kimi",
  "muse",
  "empryo",
  "minimax-code",
  "droid",
  "cline",
  "qoder",
  "qoder-cn",
  "grok",
  "zcode",
  "workbuddy",
  "pencil",
  "t3code",
  "hanako",
  "atomcode",
  "alma",
  "cindy",
] as const;

export type GatewayAgentId = (typeof GATEWAY_AGENT_IDS)[number];
export type AgentConfigFormat = "json" | "jsonc" | "env" | "toml" | "yaml";

export interface AgentAdapterProfile {
  id: GatewayAgentId;
  displayName: string;
  configPath: string;
  format: AgentConfigFormat;
  defaultProtocol: GatewayProtocol;
  modelPath: string;
  baseUrlPath: string;
  tokenPath: string;
  /** Paths that must be removed when the managed binding is applied. */
  clearPaths?: readonly string[];
  /** Additional model fields that should follow the selected model. */
  managedModelPaths?: readonly string[];
  /** Optional array-valued model allowlist (for example Claude Code's `availableModels`). */
  availableModelsPath?: string;
  /** Optional official-model to provider-model mapping (for example Claude Code's `modelOverrides`). */
  modelOverridesPath?: string;
  /** Optional explicit paths for advanced Agent configuration fields. */
  reasoningPath?: string;
  fallbackModelPath?: string;
  subAgentModelPath?: string;
  aliases: readonly string[];
  supports: {
    tools: boolean;
    reasoning: boolean;
    vision: boolean;
    streaming: boolean;
  };
}

export type AgentFieldKind = "model" | "base_url" | "token" | "reasoning" | "fallback_model" | "sub_agent_model";

export interface AgentFieldDefinition {
  id: string;
  kind: AgentFieldKind;
  path: string;
  writable: boolean;
}

export interface AgentGatewayBinding {
  bindingId: string;
  agentId: GatewayAgentId;
  gatewayBaseUrl: string;
  gatewayTokenRef: string;
  protocol: GatewayProtocol;
  exposedModelId: string;
  /** Model IDs exposed in the Agent's model picker. */
  availableModelIds?: readonly string[];
  /** Official model ID -> actual provider model ID mapping. */
  modelOverrides?: Readonly<Record<string, string>>;
  routeGroupId?: string;
  reasoningProfile?: string;
  fallbackModelId?: string;
  subAgentModelId?: string;
  /** Additional configuration values managed for this binding only. */
  managedValues?: Readonly<Record<string, string>>;
  /** Configuration paths managed by this binding that should be removed before values are applied. */
  managedClearPaths?: readonly string[];
  enabled: boolean;
  updatedAt: number;
}

export interface AgentConfigSnapshot {
  bindingId: string;
  agentId: GatewayAgentId;
  configPath: string;
  originalContent: string | null;
  expectedContent: string;
  expectedHash: string;
  capturedAt: number;
}

export interface AgentDriftReport {
  agentId: GatewayAgentId;
  bindingId: string;
  configPath: string;
  state: "clean" | "missing" | "drifted" | "unwired";
  expectedHash?: string;
  actualHash?: string;
  changed: boolean;
}

export interface AgentFileSystem {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  list?(path: string): Promise<string[]>;
}

/**
 * Transport contract for an Agent filesystem that lives outside the current
 * process. Implementations must treat the supplied path as an absolute path
 * in their own filesystem and must replace files atomically on write.
 */
export interface RemoteAgentFileSystemTransport {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export interface AgentAdapterOptions {
  fs: AgentFileSystem;
  stateDir: string;
  now?: () => number;
}

export interface AgentAdapter {
  readonly profile: AgentAdapterProfile;
  discover(): Promise<{ installed: boolean; configPath: string; format: AgentConfigFormat }>;
  listFields(): readonly AgentFieldDefinition[];
  apply(binding: AgentGatewayBinding): Promise<AgentConfigSnapshot>;
  unwire(bindingId: string): Promise<void>;
  restore(bindingId: string): Promise<void>;
  check(bindingId: string): Promise<AgentDriftReport>;
  /** Mark the current managed file content as expected without changing the rollback baseline. */
  acknowledge(bindingId: string): Promise<AgentConfigSnapshot | null>;
  sync(binding: AgentGatewayBinding): Promise<AgentConfigSnapshot>;
  renameRefs(oldRef: string, newRef: string): Promise<void>;
}
