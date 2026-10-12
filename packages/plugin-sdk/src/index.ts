import { createInterface } from "node:readline";

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
  revoke?(input: { account: CswProviderAccount; secret?: string; settings?: Record<string, unknown> }): void | Promise<void>;
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
  reject?: { status?: number; message: string; code?: string };
  drop?: boolean;
}

export interface CswMiddlewarePlugin {
  describe(): { hooks: CswMiddlewareHook[]; priority?: number } | Promise<{ hooks: CswMiddlewareHook[]; priority?: number }>;
  onRequest?(input: { body: Record<string, unknown>; context: CswMiddlewareContext }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
  onEvent?(input: { event: Record<string, unknown>; context: CswMiddlewareContext }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
  onResponse?(input: { body: Record<string, unknown>; context: CswMiddlewareContext }): CswMiddlewareResult | void | Promise<CswMiddlewareResult | void>;
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
  error?: { code: number; message: string };
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
export function startCswPluginServer(plugin: CswPlugin, options: CswPluginServerOptions = {}): { close(): void } {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const readline = createInterface({ input });
  let closed = false;

  const send = (response: CswRpcResponse): void => {
    if (closed) return;
    output.write(`${JSON.stringify(response)}\n`);
  };
  const fail = (request: CswRpcRequest, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } });
    options.onError?.(error);
  };
  const handle = async (request: CswRpcRequest): Promise<void> => {
    try {
      const params = request.params ?? {};
      switch (request.method) {
        case "plugin.describe":
          send({ jsonrpc: "2.0", id: request.id, result: {
            kinds: [
              ...(plugin.provider ? ["provider"] : []),
              ...(plugin.middleware ? ["middleware"] : []),
            ],
          } });
          return;
        case "provider.describe":
          if (!plugin.provider) throw new Error("Provider capability is not installed");
          send({ jsonrpc: "2.0", id: request.id, result: { provider: await plugin.provider.describe() } });
          return;
        case "provider.models":
          if (!plugin.provider?.models) throw new Error("Provider model discovery is not implemented");
          send({ jsonrpc: "2.0", id: request.id, result: { models: await plugin.provider.models({
            account: requireAccount(params.account),
            ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
            secretRef: requireString(params.secretRef, "secretRef"),
            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
          }) } });
          return;
        case "provider.quota":
          if (!plugin.provider?.quota) { send({ jsonrpc: "2.0", id: request.id, result: null }); return; }
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.quota({
            account: requireAccount(params.account),
            ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
            secretRef: requireString(params.secretRef, "secretRef"),
            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
          }) });
          return;
        case "provider.refresh":
          if (!plugin.provider?.refresh) throw new Error("Provider token refresh is not implemented");
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.refresh({
            account: requireAccount(params.account),
            refreshToken: requireString(params.refreshToken, "refreshToken"),
            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
          }) });
          return;
        case "provider.revoke":
          if (plugin.provider?.revoke) await plugin.provider.revoke({
            account: requireAccount(params.account),
            ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
          });
          send({ jsonrpc: "2.0", id: request.id, result: null });
          return;
        case "provider.request":
          if (!plugin.provider?.request) throw new Error("Provider custom request handling is not implemented");
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.request({
            account: requireAccount(params.account),
            secret: requireString(params.secret, "secret"),
            protocol: requireProtocol(params.protocol),
            url: requireString(params.url, "url"),
            method: requireString(params.method, "method"),
            headers: requireHeaders(params.headers),
            ...(typeof params.body === "string" ? { body: params.body } : {}),
            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
          }) });
          return;
        case "middleware.describe":
          if (!plugin.middleware) throw new Error("Middleware capability is not installed");
          send({ jsonrpc: "2.0", id: request.id, result: { middleware: await plugin.middleware.describe() } });
          return;
        case "middleware.onRequest":
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onRequest?.({ body: requireObject(params.body, "body"), context: requireContext(params.context) }) });
          return;
        case "middleware.onEvent":
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onEvent?.({ event: requireObject(params.event, "event"), context: requireContext(params.context) }) });
          return;
        case "middleware.onResponse":
          send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onResponse?.({ body: requireObject(params.body, "body"), context: requireContext(params.context) }) });
          return;
        default:
          throw new Error(`Unknown plugin method '${request.method}'`);
      }
    } catch (error) {
      fail(request, error);
    }
  };

  readline.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const request = JSON.parse(line) as CswRpcRequest;
      if (!request || request.jsonrpc !== "2.0" || typeof request.id !== "string" || typeof request.method !== "string") throw new Error("Invalid plugin request");
      void handle(request);
    } catch (error) {
      options.onError?.(error);
    }
  });
  return {
    close() {
      if (closed) return;
      closed = true;
      readline.close();
    },
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function requireHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("headers must be an object");
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string")) as Record<string, string>;
}

function requireAccount(value: unknown): CswProviderAccount {
  const account = requireObject(value, "account");
  return {
    accountId: requireString(account.accountId, "account.accountId"),
    secretRef: requireString(account.secretRef, "account.secretRef"),
    ...(typeof account.displayName === "string" ? { displayName: account.displayName } : {}),
    ...(account.authMethod === "api_key" || account.authMethod === "oauth" || account.authMethod === "subscription" || account.authMethod === "none" ? { authMethod: account.authMethod } : {}),
    ...(typeof account.status === "string" ? { status: account.status as CswProviderAccount["status"] } : {}),
    ...(typeof account.expiresAt === "number" ? { expiresAt: account.expiresAt } : {}),
  };
}

function requireContext(value: unknown): CswMiddlewareContext {
  const context = requireObject(value, "context");
  return {
    requestId: requireString(context.requestId, "context.requestId"),
    traceId: requireString(context.traceId, "context.traceId"),
    protocol: requireProtocol(context.protocol),
    model: requireString(context.model, "context.model"),
    stream: context.stream === true,
    ...(typeof context.path === "string" ? { path: context.path } : {}),
    ...(typeof context.agentId === "string" ? { agentId: context.agentId } : {}),
    ...(typeof context.environmentId === "string" ? { environmentId: context.environmentId } : {}),
    state: isRecord(context.state) ? context.state : {},
    ...(isRecord(context.options) ? { options: context.options } : {}),
  };
}

function requireProtocol(value: unknown): CswProtocol {
  if (value === "responses" || value === "chat_completions" || value === "anthropic" || value === "gemini") return value;
  throw new Error("context.protocol is invalid");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
