import { randomUUID } from "node:crypto";
export const BUILT_IN_PROVIDER_IDS = [
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "kimi",
    "glm",
    "qwen",
    "minimax",
    "mistral",
    "groq",
    "xai",
    "openrouter",
    "ollama",
    "lmstudio",
    "custom",
    "chatgpt",
    "codex-subscription",
    "claude-subscription",
    "copilot-subscription",
    "cursor-subscription",
    "grok-subscription",
    "devin-subscription",
];
const OPENAI = { protocol: "responses", baseUrl: "https://api.openai.com/v1", modelsPath: "/models", quotaPath: "/usage" };
const CHAT = { protocol: "chat_completions", baseUrl: "https://api.openai.com/v1", modelsPath: "/models", quotaPath: "/usage" };
const ANTHROPIC = { protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelsPath: "/v1/models", quotaPath: "/v1/usage" };
const GEMINI = { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelsPath: "/models", quotaPath: "/usage" };
const DEFINITIONS = [
    { id: "openai", displayName: "OpenAI", authMethods: ["api_key"], endpoints: [OPENAI, CHAT], presets: ["gpt-5", "o3", "o4-mini"] },
    { id: "anthropic", displayName: "Anthropic", authMethods: ["api_key"], endpoints: [ANTHROPIC], presets: ["claude-sonnet-4-5", "claude-opus-4-1"] },
    { id: "gemini", displayName: "Google Gemini", authMethods: ["api_key", "oauth"], endpoints: [GEMINI], presets: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    { id: "deepseek", displayName: "DeepSeek", authMethods: ["api_key"], endpoints: [CHAT], presets: ["deepseek-chat", "deepseek-reasoner"] },
    { id: "kimi", displayName: "Kimi", authMethods: ["api_key"], endpoints: [CHAT], presets: ["kimi-k2", "moonshot-v1-128k"] },
    { id: "glm", displayName: "GLM", authMethods: ["api_key"], endpoints: [CHAT], presets: ["glm-4.5", "glm-4.5-air"] },
    { id: "qwen", displayName: "Qwen", authMethods: ["api_key"], endpoints: [CHAT], presets: ["qwen3-max", "qwen-plus"] },
    { id: "minimax", displayName: "MiniMax", authMethods: ["api_key"], endpoints: [CHAT], presets: ["MiniMax-M2"] },
    { id: "mistral", displayName: "Mistral", authMethods: ["api_key"], endpoints: [CHAT], presets: ["mistral-large-latest"] },
    { id: "groq", displayName: "Groq", authMethods: ["api_key"], endpoints: [CHAT], presets: ["llama-4-scout"] },
    { id: "xai", displayName: "xAI", authMethods: ["api_key"], endpoints: [CHAT], presets: ["grok-4"] },
    { id: "openrouter", displayName: "OpenRouter", authMethods: ["api_key"], endpoints: [{ ...CHAT, baseUrl: "https://openrouter.ai/api/v1" }], presets: ["openai/gpt-5"] },
    { id: "ollama", displayName: "Ollama", authMethods: ["none", "api_key"], endpoints: [{ ...CHAT, baseUrl: "http://127.0.0.1:11434/v1" }], presets: [] },
    { id: "lmstudio", displayName: "LM Studio", authMethods: ["none", "api_key"], endpoints: [{ ...CHAT, baseUrl: "http://127.0.0.1:1234/v1" }], presets: [] },
    { id: "custom", displayName: "Custom OpenAI Compatible", authMethods: ["api_key", "oauth", "none"], endpoints: [{ ...CHAT, baseUrl: "" }], presets: [] },
    { id: "chatgpt", displayName: "ChatGPT", authMethods: ["subscription", "oauth"], endpoints: [OPENAI], presets: ["chatgpt-auto"] },
    { id: "codex-subscription", displayName: "Codex Subscription", authMethods: ["subscription", "oauth"], endpoints: [OPENAI], presets: ["codex-mini-latest"] },
    { id: "claude-subscription", displayName: "Claude Subscription", authMethods: ["subscription", "oauth"], endpoints: [ANTHROPIC], presets: ["claude-sonnet"] },
    { id: "copilot-subscription", displayName: "GitHub Copilot", authMethods: ["subscription", "oauth"], endpoints: [CHAT], presets: ["copilot-default"] },
    { id: "cursor-subscription", displayName: "Cursor", authMethods: ["subscription", "oauth"], endpoints: [CHAT], presets: ["cursor-auto"] },
    { id: "grok-subscription", displayName: "Grok Subscription", authMethods: ["subscription", "oauth"], endpoints: [CHAT], presets: ["grok-auto"] },
    { id: "devin-subscription", displayName: "Devin", authMethods: ["subscription", "oauth"], endpoints: [CHAT], presets: ["devin-auto"] },
];
export function createProviderAdapter(definition, random = randomUUID) {
    return {
        id: definition.id,
        displayName: definition.displayName,
        authMethods: definition.authMethods,
        endpoints: definition.endpoints,
        beginLogin(redirectUri, now = Date.now()) {
            const state = random();
            const expiresAt = now + 10 * 60 * 1000;
            const params = new URLSearchParams({ response_type: "code", redirect_uri: redirectUri, state });
            return { providerId: definition.id, state, authorizationUrl: `codex-switcher://${definition.id}/authorize?${params}`, expiresAt };
        },
        completeLogin(input) {
            if (!input.state || input.state !== input.expectedState)
                throw new Error("Provider login state mismatch");
            if (!input.code.trim())
                throw new Error("Provider login code is required");
            const accountId = input.accountId?.trim() || `${definition.id}-${input.code.slice(0, 8)}`;
            const authMethod = definition.authMethods.includes("subscription") ? "subscription" : "oauth";
            return { account: { accountId, displayName: `${definition.displayName} (${accountId})`, authMethod, secretRef: `provider/${definition.id}/${accountId}`, status: "active" }, accessToken: input.code };
        },
        async refresh(client, account, refreshToken, now = Date.now()) {
            if (account.authMethod === "none" || account.authMethod === "api_key") {
                return { account: { ...account, status: "active" } };
            }
            if (!refreshToken.trim())
                throw new Error(`Provider '${definition.id}' refresh token is required`);
            const endpoint = definition.endpoints[0];
            const refreshPath = definition.refreshPath ?? "/oauth/token";
            if (!endpoint?.baseUrl)
                return { account: { ...account, status: "active", expiresAt: now + 60 * 60 * 1000 }, refreshToken };
            const response = await client.request(`${endpoint.baseUrl}${refreshPath}`, {
                method: "POST",
                headers: new Headers({ "content-type": "application/x-www-form-urlencoded", accept: "application/json" }),
                body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
            }, requestContext(account));
            if (response.status < 200 || response.status >= 300)
                throw new Error(`Provider refresh failed with HTTP ${response.status}`);
            const payload = await response.json();
            const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
            const nextRefreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken;
            if (!accessToken)
                throw new Error("Provider refresh response did not contain access_token");
            const expiresIn = number(payload.expires_in) ?? 3600;
            return { account: { ...account, status: "active", expiresAt: now + Math.max(60, expiresIn) * 1000 }, accessToken, refreshToken: nextRefreshToken };
        },
        async revoke(client, account, secret = "") {
            const endpoint = definition.endpoints[0];
            const revokePath = definition.revokePath ?? (definition.authMethods.includes("oauth") || definition.authMethods.includes("subscription")
                ? "/oauth/revoke"
                : undefined);
            if (!revokePath || !endpoint?.baseUrl || !secret.trim())
                return;
            const response = await client.request(`${endpoint.baseUrl}${revokePath}`, {
                method: "POST",
                headers: new Headers({ "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...Object.fromEntries(this.authorizationHeaders(account, secret, endpoint.protocol).entries()) }),
                body: new URLSearchParams({ token: secret }).toString(),
            }, requestContext(account));
            if (response.status < 200 || response.status >= 300)
                throw new Error(`Provider revoke failed with HTTP ${response.status}`);
        },
        async discoverModels(client, account, secret = account.secretRef) {
            const endpoint = definition.endpoints.find((item) => item.modelsPath) ?? definition.endpoints[0];
            if (!endpoint.baseUrl)
                return presetsToModels(definition);
            const response = await client.request(`${endpoint.baseUrl}${endpoint.modelsPath}`, { method: "GET", headers: this.authorizationHeaders(account, secret, endpoint.protocol) }, requestContext(account));
            if (response.status < 200 || response.status >= 300)
                throw new Error(`Provider model discovery failed with HTTP ${response.status}`);
            const payload = await response.json();
            const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
            const discovered = data.flatMap((item) => typeof item === "string" ? [item] : isRecord(item) && typeof item.id === "string" ? [item.id] : []);
            const allModels = [...new Set([...discovered, ...definition.presets])].map((id) => modelFor(definition, id, "discovery"));
            if (!account.allowedModelIds)
                return allModels;
            const allowed = new Set(account.allowedModelIds);
            return allModels.filter((model) => allowed.has(model.id));
        },
        async listModels(client, account, secret) {
            return this.discoverModels(client, account, secret);
        },
        async readQuota(client, account, secret = account.secretRef) {
            const endpoint = definition.endpoints.find((item) => item.quotaPath);
            if (!endpoint?.quotaPath || !endpoint.baseUrl)
                return null;
            const response = await client.request(`${endpoint.baseUrl}${endpoint.quotaPath}`, { method: "GET", headers: this.authorizationHeaders(account, secret, endpoint.protocol) }, requestContext(account));
            if (response.status === 404)
                return null;
            if (response.status < 200 || response.status >= 300)
                throw new Error(`Provider quota read failed with HTTP ${response.status}`);
            const payload = await response.json();
            return { providerId: definition.id, accountId: account.accountId, requestsRemaining: number(payload.requests_remaining ?? payload.remaining_requests), tokensRemaining: number(payload.tokens_remaining ?? payload.remaining_tokens), resetAt: number(payload.reset_at), plan: typeof payload.plan === "string" ? payload.plan : undefined, observedAt: Date.now() };
        },
        async fetchQuota(client, account, secret) {
            return this.readQuota(client, account, secret);
        },
        authorizationHeaders(account, secret, protocol) {
            const headers = new Headers(account.requestHeaders);
            if (!headers.has("accept"))
                headers.set("accept", "application/json");
            if (definition.id === "anthropic" || protocol === "anthropic") {
                headers.set("x-api-key", secret);
                headers.set("anthropic-version", "2023-06-01");
            }
            else if (definition.id === "gemini" || protocol === "gemini") {
                headers.set("x-goog-api-key", secret);
            }
            else if (account.authMethod !== "none") {
                headers.set("authorization", `Bearer ${secret}`);
            }
            return headers;
        },
        signRequest(input) {
            const headers = new Headers(input.headers);
            for (const [key, value] of this.authorizationHeaders(input.account, input.secret, input.protocol).entries())
                headers.set(key, value);
            if (input.body !== undefined && !headers.has("content-type"))
                headers.set("content-type", "application/json");
            return { url: input.url, init: { method: input.method, headers, ...(input.body !== undefined ? { body: input.body } : {}) } };
        },
        classifyError(input) {
            const message = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
            if (/timeout|timed out|aborted/.test(message))
                return "timeout";
            if (input.status === 401 || input.status === 403 || /unauthori[sz]ed|invalid.*key|expired/.test(message))
                return "unauthorized";
            if (input.status === 408)
                return "timeout";
            if (input.status === 402 || /quota|balance|insufficient/.test(message))
                return "quota";
            if (input.status === 429 || /rate.?limit|too many requests/.test(message))
                return "rate_limit";
            if (input.status !== undefined && input.status >= 500)
                return "upstream_5xx";
            if (input.status !== undefined && input.status >= 400)
                return "upstream_4xx";
            if (/invalid|malformed|missing|required|context.?too.?long|unsupported.*(?:model|parameter)|cannot.*(?:parse|decode)/.test(message))
                return "validation";
            return "transport";
        },
    };
}
export function createBuiltInProviderAdapters(random = randomUUID) {
    return new Map(DEFINITIONS.map((definition) => [definition.id, createProviderAdapter(definition, random)]));
}
export function providerDefinitions() { return DEFINITIONS; }
function presetsToModels(definition) { return definition.presets.map((id) => modelFor(definition, id, "preset")); }
function modelFor(definition, id, source) {
    const protocols = [...new Set(definition.endpoints.map((endpoint) => endpoint.protocol))];
    return { id, displayName: id, providerId: definition.id, protocols, capabilities: { reasoning: /reason|o[1-9]|opus|sonnet|think/i.test(id), tools: true, vision: /vision|gemini|claude|gpt-4/i.test(id), streaming: true }, source };
}
function requestContext(account) {
    return { accountId: account.accountId, ...(account.proxyUrl ? { proxyUrl: account.proxyUrl } : {}) };
}
function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
//# sourceMappingURL=adapters.js.map