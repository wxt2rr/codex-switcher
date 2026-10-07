export declare const GATEWAY_SCHEMA_VERSION: 1;
export type GatewayMode = "direct" | "gateway";
export type GatewayProtocol = "responses" | "chat_completions" | "anthropic" | "gemini";
export type GatewayProviderKind = "openai" | "chatgpt" | "anthropic" | "gemini" | "custom" | "local";
export type GatewayCredentialKind = "auth" | "api_key" | "oauth" | "plugin" | "local";
export type GatewayCredentialStatus = "active" | "cooldown" | "invalid" | "expired" | "disabled";
export type GatewayRoutingStrategy = "smart" | "order" | "rotate" | "usage" | "pace" | "weight" | "weighted_round_robin";
export type GatewaySessionPolicy = "auto" | "session" | "turn" | "off";
export interface GatewayProviderEndpoints {
    responses?: string;
    chatCompletions?: string;
    anthropicMessages?: string;
    gemini?: string;
}
export interface GatewayProviderDefinition {
    id: string;
    displayName: string;
    kind: GatewayProviderKind;
    endpoints: GatewayProviderEndpoints;
    /** Non-secret headers applied to discovery and upstream requests for this provider. */
    requestHeaders?: Record<string, string>;
    /** Explicit HTTP(S) proxy endpoint for this provider; credentials are never accepted in the URL. */
    proxyUrl?: string;
    modelDiscovery: "manual" | "models_endpoint" | "preset" | "plugin";
    enabled: boolean;
}
export interface GatewayCredentialDefinition {
    id: string;
    providerId: string;
    displayName: string;
    kind: GatewayCredentialKind;
    secretRef: string;
    accountId?: string;
    supportedProtocols: GatewayProtocol[];
    status: GatewayCredentialStatus;
    /** When present, only these upstream model ids may be selected for this credential. */
    modelIds?: string[];
    /** Non-secret headers applied after provider defaults and before credential auth headers. */
    requestHeaders?: Record<string, string>;
    /** Explicit HTTP(S) proxy endpoint for this credential; overrides the provider proxy. */
    proxyUrl?: string;
    weight?: number;
    priority?: number;
}
export interface GatewayModelDefinition {
    id: string;
    providerId: string;
    upstreamModelId: string;
    displayName: string;
    protocols: GatewayProtocol[];
    capabilities: {
        reasoning?: boolean;
        tools?: boolean;
        vision?: boolean;
        streaming?: boolean;
    };
    enabled: boolean;
}
export interface GatewayRouteGroupMember {
    providerId: string;
    modelId: string;
    credentialSelector: {
        credentialIds?: string[];
        providerId?: string;
    };
    priority: number;
    weight: number;
}
export interface GatewayRouteGroupDefinition {
    id: string;
    displayName: string;
    exposedModelId: string;
    members: GatewayRouteGroupMember[];
    /** Nested RouteGroup references imported as group ids without the `group/` prefix. */
    nestedGroupIds?: string[];
    strategy: GatewayRoutingStrategy;
    sessionPolicy: GatewaySessionPolicy;
    fallbackEnabled: boolean;
    capabilities?: {
        reasoning?: boolean;
        tools?: boolean;
        vision?: boolean;
        streaming?: boolean;
    };
}
/** Explicit request-metadata routing only. This schema deliberately has no
 * prompt, classifier, intent, or free-form expression field. */
export interface GatewayRouteRuleMatch {
    tokenCount?: {
        min?: number;
        max?: number;
    };
    hasImages?: boolean;
    reasoning?: boolean;
    reasoningProfiles?: string[];
    agentIds?: string[];
    contextCompacted?: boolean;
    time?: {
        startHour: number;
        endHour: number;
        daysOfWeek?: number[];
        timezone?: "local" | "utc";
    };
    modelIds?: string[];
    providerIds?: string[];
}
export interface GatewayRouteRule {
    id: string;
    targetModelId: string;
    priority: number;
    enabled: boolean;
    match: GatewayRouteRuleMatch;
}
/**
 * Environment-scoped gateway configuration.
 *
 * Secrets are intentionally represented by secretRef only. The actual token
 * or API key remains in the existing account/secure-storage path.
 */
export interface GatewayEnvironmentState {
    schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
    mode: GatewayMode;
    gatewayId: string;
    defaultRouteGroupId?: string;
    providers: Record<string, GatewayProviderDefinition>;
    credentials: Record<string, GatewayCredentialDefinition>;
    models: Record<string, GatewayModelDefinition>;
    routeGroups: Record<string, GatewayRouteGroupDefinition>;
    routeRules?: GatewayRouteRule[];
    quota?: {
        windowMinutes: number;
        maxRequests?: number;
        maxTokens?: number;
    };
    catalogVersion: number;
}
/** Returns true when a Gateway document contains the permanently unsupported prompt/intent surface. */
export declare function containsExcludedGatewayRoutingFields(value: unknown): boolean;
export declare function isGatewayEnvironmentState(value: unknown): value is GatewayEnvironmentState;
export declare function isGatewayProxyUrl(value: unknown): value is string;
