export type CswProtocol = "responses" | "chat_completions" | "anthropic" | "gemini";
export type CswAuthMethod = "api_key" | "oauth" | "subscription" | "none";
export interface CswProviderEndpoint {
    protocol: CswProtocol;
    baseUrl: string;
    modelsPath: string;
    quotaPath?: string;
}
export interface CswProviderDescriptor {
    id: string;
    displayName: string;
    authMethods: CswAuthMethod[];
    endpoints: CswProviderEndpoint[];
}
export interface CswProviderAccount {
    accountId: string;
    displayName?: string;
    authMethod?: CswAuthMethod;
    secretRef: string;
    status?: "active" | "cooldown" | "invalid" | "expired" | "disabled";
    expiresAt?: number;
}
export interface CswProviderModel {
    id: string;
    displayName?: string;
    protocols?: CswProtocol[];
    capabilities?: {
        reasoning?: boolean;
        tools?: boolean;
        vision?: boolean;
        streaming?: boolean;
    };
    contextWindow?: number;
    source?: "discovery" | "preset" | "manual";
}
export interface CswProviderCredentialResult {
    account?: Partial<CswProviderAccount> & Pick<CswProviderAccount, "secretRef">;
    accessToken?: string;
    refreshToken?: string;
}
export interface CswProviderRequestResult {
    status: number;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    events?: Array<Record<string, unknown>>;
}
export interface CswProviderPlugin {
    describe(): CswProviderDescriptor | Promise<CswProviderDescriptor>;
    models?(input: {
        account: CswProviderAccount;
        secret?: string;
        secretRef: string;
        settings?: Record<string, unknown>;
    }): CswProviderModel[] | Promise<CswProviderModel[]>;
    quota?(input: {
        account: CswProviderAccount;
        secret?: string;
        secretRef: string;
        settings?: Record<string, unknown>;
    }): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
    refresh?(input: {
        account: CswProviderAccount;
        refreshToken: string;
        settings?: Record<string, unknown>;
    }): CswProviderCredentialResult | Promise<CswProviderCredentialResult>;
    revoke?(input: {
        account: CswProviderAccount;
        secret?: string;
        settings?: Record<string, unknown>;
    }): void | Promise<void>;
    request?(input: {
        account: CswProviderAccount;
        secret: string;
        protocol: CswProtocol;
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
        settings?: Record<string, unknown>;
    }): CswProviderRequestResult | Promise<CswProviderRequestResult>;
}
export type CswMiddlewareHook = "onRequest" | "onEvent" | "onResponse";
export interface CswMiddlewareContext {
    requestId: string;
    traceId: string;
    protocol: CswProtocol;
    model: string;
    stream: boolean;
    path?: string;
    agentId?: string;
    environmentId?: string;
    state: Record<string, unknown>;
    options?: Record<string, unknown>;
}
export interface CswMiddlewareResult {
    body?: Record<string, unknown>;
    model?: string;
    reject?: {
        status?: number;
        message: string;
        code?: string;
    };
    drop?: boolean;
}
export interface CswMiddlewarePlugin {
    describe(): {
        hooks: CswMiddlewareHook[];
        priority?: number;
    } | Promise<{
        hooks: CswMiddlewareHook[];
        priority?: number;
    }>;
    onRequest?(input: {
        body: Record<string, unknown>;
        context: CswMiddlewareContext;
    }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
    onEvent?(input: {
        event: Record<string, unknown>;
        context: CswMiddlewareContext;
    }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
    onResponse?(input: {
        body: Record<string, unknown>;
        context: CswMiddlewareContext;
    }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
}
export interface CswPlugin {
    provider?: CswProviderPlugin;
    middleware?: CswMiddlewarePlugin;
}
export interface CswRpcRequest {
    jsonrpc: "2.0";
    id: string;
    method: string;
    params?: Record<string, unknown>;
}
export interface CswRpcResponse {
    jsonrpc: "2.0";
    id: string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}
export interface CswPluginServerOptions {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    onError?: (error: unknown) => void;
}
/**
 * Starts the stable newline-delimited RPC server used by Codex Switcher.
 * Plugins are ordinary Node/Bun processes and can be authored without a
 * dependency on the desktop or gateway implementation.
 */
export declare function startCswPluginServer(plugin: CswPlugin, options?: CswPluginServerOptions): {
    close(): void;
};
