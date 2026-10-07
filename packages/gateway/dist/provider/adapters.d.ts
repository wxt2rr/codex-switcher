import type { GatewayProtocol, JsonObject } from "../protocol.js";
export declare const BUILT_IN_PROVIDER_IDS: readonly ["openai", "anthropic", "gemini", "deepseek", "kimi", "glm", "qwen", "minimax", "mistral", "groq", "xai", "openrouter", "ollama", "lmstudio", "custom", "chatgpt", "codex-subscription", "claude-subscription", "copilot-subscription", "cursor-subscription", "grok-subscription", "devin-subscription"];
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];
export type ProviderAuthMethod = "api_key" | "oauth" | "subscription" | "none";
export type ProviderHealth = "active" | "cooldown" | "invalid" | "expired" | "disabled";
export interface ProviderEndpoint {
    protocol: GatewayProtocol;
    baseUrl: string;
    modelsPath: string;
    quotaPath?: string;
}
export type ProviderFailureClass = "transport" | "timeout" | "rate_limit" | "quota" | "unauthorized" | "upstream_5xx" | "upstream_4xx" | "validation";
export interface ProviderErrorInput {
    status?: number;
    code?: string;
    message?: string;
    headers?: Headers;
}
export interface ProviderSignRequestInput {
    account: ProviderAccountRef;
    secret: string;
    protocol: GatewayProtocol;
    url: string;
    method: string;
    body?: string;
    headers?: HeadersInit;
}
export interface ProviderSignedRequest {
    url: string;
    init: {
        method: string;
        headers: Headers;
        body?: string;
    };
}
export interface ProviderAccountRef {
    accountId: string;
    displayName: string;
    authMethod: ProviderAuthMethod;
    secretRef: string;
    status: ProviderHealth;
    /** Explicit per-credential model allowlist; omitted means all discovered models. */
    allowedModelIds?: readonly string[];
    /** Non-secret headers supplied by provider/credential configuration. */
    requestHeaders?: Readonly<Record<string, string>>;
    /** Explicit HTTP(S) proxy endpoint for this account; credentials are not embedded. */
    proxyUrl?: string;
    expiresAt?: number;
}
export interface ProviderModel {
    id: string;
    displayName: string;
    providerId: string;
    protocols: GatewayProtocol[];
    capabilities: {
        reasoning: boolean;
        tools: boolean;
        vision: boolean;
        streaming: boolean;
    };
    contextWindow?: number;
    source: "preset" | "discovery" | "manual";
}
export interface ProviderQuotaSnapshot {
    providerId: string;
    accountId: string;
    requestsRemaining?: number;
    tokensRemaining?: number;
    resetAt?: number;
    plan?: string;
    observedAt: number;
}
export interface ProviderHttpResponse {
    status: number;
    headers: Headers;
    json(): Promise<JsonObject>;
}
export interface ProviderHttpRequestContext {
    accountId: string;
    /** Explicit account proxy selected by Provider/Credential policy. */
    proxyUrl?: string;
}
export interface ProviderHttpClient {
    request(url: string, init: {
        method: string;
        headers: Headers;
        body?: string;
    }, context?: ProviderHttpRequestContext): Promise<ProviderHttpResponse>;
}
export interface ProviderLoginStart {
    providerId: string;
    state: string;
    authorizationUrl: string;
    expiresAt: number;
}
export interface ProviderCredentialResult {
    account: ProviderAccountRef;
    accessToken?: string;
    refreshToken?: string;
}
export interface ProviderAdapter {
    readonly id: string;
    readonly displayName: string;
    readonly authMethods: readonly ProviderAuthMethod[];
    readonly endpoints: readonly ProviderEndpoint[];
    beginLogin(redirectUri: string, now?: number): ProviderLoginStart;
    completeLogin(input: {
        state: string;
        expectedState: string;
        code: string;
        accountId?: string;
    }): ProviderCredentialResult;
    refresh(client: ProviderHttpClient, account: ProviderAccountRef, refreshToken: string, now?: number): Promise<ProviderCredentialResult>;
    revoke(client: ProviderHttpClient, account: ProviderAccountRef, secret?: string): Promise<void>;
    discoverModels(client: ProviderHttpClient, account: ProviderAccountRef, secret?: string): Promise<ProviderModel[]>;
    listModels(client: ProviderHttpClient, account: ProviderAccountRef, secret?: string): Promise<ProviderModel[]>;
    readQuota(client: ProviderHttpClient, account: ProviderAccountRef, secret?: string): Promise<ProviderQuotaSnapshot | null>;
    fetchQuota(client: ProviderHttpClient, account: ProviderAccountRef, secret?: string): Promise<ProviderQuotaSnapshot | null>;
    authorizationHeaders(account: ProviderAccountRef, secret: string, protocol: GatewayProtocol): Headers;
    signRequest(input: ProviderSignRequestInput): ProviderSignedRequest;
    classifyError(input: ProviderErrorInput): ProviderFailureClass;
}
export interface ProviderDefinition {
    id: BuiltInProviderId;
    displayName: string;
    authMethods: readonly ProviderAuthMethod[];
    endpoints: readonly ProviderEndpoint[];
    presets: readonly string[];
    refreshPath?: string;
    revokePath?: string;
}
export declare function createProviderAdapter(definition: ProviderDefinition, random?: () => string): ProviderAdapter;
export declare function createBuiltInProviderAdapters(random?: () => string): ReadonlyMap<BuiltInProviderId, ProviderAdapter>;
export declare function providerDefinitions(): readonly ProviderDefinition[];
