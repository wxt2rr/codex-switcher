import { type GatewayEnvironmentState } from "../gateway/model.js";
export declare const DEFAULT_SCHEMA_VERSION = 1;
export type TargetName = "cli" | "app";
export type AuthMode = "auth" | "apikey" | "provider-profile";
export type PreferredAuthMethod = "chatgpt" | "apikey";
export type OpenAIBaseUrlMode = "default" | "custom";
/**
 * Wire protocol used by an API-key account. Anthropic Messages is kept in the
 * same account runtime so Claude Code can consume the account directly while
 * the existing Codex Responses/Chat Completions paths remain unchanged.
 */
export type AccountApiProtocol = "responses" | "chat_completions" | "anthropic";
export type EnvironmentModelIdentityMode = "account" | "unified";
export type ProviderCredentialAuthMethod = "api_key" | "oauth" | "subscription" | "plugin" | "none";
export type ReasoningProfile = "auto" | "standard" | "reasoning_content" | "think_tags";
export type LongConversationStrategy = "safe" | "continuity";
export type CompatibilityInstructionRole = "auto" | "system" | "developer";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed";
export type AuthDataValue = string | number | boolean | null | Record<string, unknown> | unknown[];
export type AuthDataRecord = Record<string, AuthDataValue>;
export interface TargetPointer {
    env: string;
    account: string;
}
export interface AccountRuntimeSettings {
    preferredAuthMethod: PreferredAuthMethod;
    openaiBaseUrlMode: OpenAIBaseUrlMode;
    openaiBaseUrl?: string;
    providerId?: string;
    providerAuthMethod?: ProviderCredentialAuthMethod;
    providerRequestHeaders?: Record<string, string>;
    model?: string;
    independentModelEnabled?: boolean;
    independentModelProviderId?: string;
    independentModelApiKey?: string;
    independentModelBaseUrl?: string;
    apiProtocol?: AccountApiProtocol;
    compatibilityRouteEnabled?: boolean;
    compatibilityRouteBaseUrl?: string;
    compatibilityRouteToken?: string;
    compatibilityRouteProviderId?: string;
    compatibilityUpstreamModel?: string;
    compatibilityReasoningProfile?: ReasoningProfile;
    compatibilityLongConversationStrategy?: LongConversationStrategy;
    compatibilityInstructionRole?: CompatibilityInstructionRole;
    compatibilityRequestOverrides?: Record<string, unknown>;
}
export interface AccountState {
    name: string;
    authMode: AuthMode;
    runtime: AccountRuntimeSettings;
    authData?: AuthDataRecord;
}
/** Official ChatGPT identity used by Codex App remote control. This is
 * intentionally separate from the account currently used for model calls. */
export interface EnvironmentRemoteControlSettings {
    accountName?: string;
}
export interface EnvState {
    name: string;
    path: string;
    accounts: Record<string, AccountState>;
    /** Controls the Codex-facing model identity while retaining internal routes. */
    modelIdentityMode?: EnvironmentModelIdentityMode;
    remoteControl?: EnvironmentRemoteControlSettings;
    gateway?: GatewayEnvironmentState;
}
export declare function normalizeEnvironmentModelIdentityMode(value: unknown): EnvironmentModelIdentityMode;
export interface TaskSummary {
    id: string;
    kind: string;
    status: TaskStatus;
    startedAt: string;
    finishedAt?: string;
    summary?: string;
}
export interface SwitcherState {
    schemaVersion: typeof DEFAULT_SCHEMA_VERSION;
    generatedAt: string;
    targets: Record<TargetName, TargetPointer>;
    envs: Record<string, EnvState>;
    tasks: {
        recent: TaskSummary[];
    };
}
export interface SwitcherError extends Error {
    code: "INVALID_STATE" | "STATE_NOT_FOUND" | "STATE_IO_ERROR";
    cause?: unknown;
}
export interface StateStore {
    load(): Promise<SwitcherState>;
    save(state: SwitcherState): Promise<void>;
    writeRaw(content: string): Promise<void>;
    readonly paths: {
        rootDir: string;
        stateFile: string;
    };
}
export interface CreateStateStoreOptions {
    rootDir: string;
}
export declare function createStateStore(options: CreateStateStoreOptions): StateStore;
