import { randomUUID } from "node:crypto";
export const BUILT_IN_PROVIDER_IDS = [
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "kimi",
    "moonshot",
    "glm",
    "zai",
    "zhipu",
    "qwen",
    "minimax",
    "stepfun",
    "qianfan",
    "tencent-cloud",
    "huawei-maas",
    "volcengine-ark",
    "mistral",
    "groq",
    "xai",
    "openrouter",
    "together",
    "fireworks",
    "siliconflow",
    "nvidia-nim",
    "modelscope",
    "ollama",
    "lmstudio",
    "custom",
    "custom-openai",
    "custom-anthropic",
    "mimo",
    "chatgpt",
    "codex-subscription",
    "chatgpt-subscription",
    "claude-subscription",
    "copilot-subscription",
    "gemini-subscription",
    "cursor-subscription",
    "grok-subscription",
    "devin-subscription",
];
const OPENAI = { protocol: "responses", baseUrl: "https://api.openai.com/v1", modelsPath: "/models", quotaPath: "/usage" };
const CHAT = { protocol: "chat_completions", baseUrl: "https://api.openai.com/v1", modelsPath: "/models", quotaPath: "/usage" };
const ANTHROPIC = { protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelsPath: "/v1/models", quotaPath: "/v1/usage" };
const GEMINI = { protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelsPath: "/models", quotaPath: "/usage" };
const OPENAI_CHAT = (baseUrl) => ({ ...CHAT, baseUrl });
const API_KEY = ["api_key"];
const LOCAL = ["none", "api_key"];
const SUBSCRIPTION = ["subscription", "oauth", "plugin"];
const DEFINITIONS = [
    { id: "openai", displayName: "OpenAI", category: "api", iconKey: "openai", authMethods: API_KEY, endpoints: [OPENAI, CHAT], presets: ["gpt-5", "o3", "o4-mini"] },
    { id: "anthropic", displayName: "Anthropic", category: "api", iconKey: "anthropic", authMethods: API_KEY, endpoints: [ANTHROPIC], presets: ["claude-sonnet-4-5", "claude-opus-4-1"] },
    { id: "gemini", displayName: "Google Gemini", category: "api", iconKey: "google", authMethods: ["api_key", "oauth"], endpoints: [GEMINI], presets: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    { id: "deepseek", displayName: "DeepSeek", category: "api", iconKey: "deepseek", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.deepseek.com/v1")], presets: ["deepseek-chat", "deepseek-reasoner"] },
    { id: "moonshot", displayName: "Kimi / Moonshot", category: "api", iconKey: "moonshot", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.moonshot.ai/v1")], presets: ["kimi-k2", "moonshot-v1-128k"] },
    { id: "kimi", displayName: "Kimi", category: "api", iconKey: "moonshot", aliasOf: "moonshot", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.moonshot.ai/v1")], presets: ["kimi-k2", "moonshot-v1-128k"] },
    { id: "zhipu", displayName: "Zhipu GLM", category: "api", iconKey: "zhipu", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://open.bigmodel.cn/api/paas/v4")], presets: ["glm-4.5", "glm-4.5-air"] },
    { id: "glm", displayName: "GLM", category: "api", iconKey: "zhipu", aliasOf: "zhipu", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://open.bigmodel.cn/api/paas/v4")], presets: ["glm-4.5", "glm-4.5-air"] },
    { id: "zai", displayName: "Z.AI / GLM", category: "api", iconKey: "zhipu", aliasOf: "zhipu", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://open.bigmodel.cn/api/paas/v4")], presets: ["glm-4.5", "glm-4.5-air"] },
    { id: "minimax", displayName: "MiniMax", category: "api", iconKey: "minimax", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.minimax.io/v1")], presets: ["MiniMax-M2"] },
    { id: "stepfun", displayName: "StepFun", category: "api", iconKey: "stepfun", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.stepfun.com/v1")], presets: ["step-1-32k"] },
    { id: "qwen", displayName: "Qwen", category: "api", iconKey: "qwen", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://dashscope.aliyuncs.com/compatible-mode/v1")], presets: ["qwen3-max", "qwen-plus"] },
    { id: "qianfan", displayName: "百度千帆", category: "api", iconKey: "qianfan", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://qianfan.baidubce.com/v2")], presets: [] },
    { id: "tencent-cloud", displayName: "腾讯云", category: "api", iconKey: "tencent-cloud", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.hunyuan.cloud.tencent.com/v1")], presets: [] },
    { id: "huawei-maas", displayName: "华为云 MaaS", category: "api", iconKey: "huawei", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.modelarts-maas.com/v1")], presets: [] },
    { id: "volcengine-ark", displayName: "火山引擎 Ark", category: "api", iconKey: "volcengine", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://ark.cn-beijing.volces.com/api/v3")], presets: [] },
    { id: "mistral", displayName: "Mistral", category: "api", iconKey: "mistral", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.mistral.ai/v1")], presets: ["mistral-large-latest"] },
    { id: "groq", displayName: "Groq", category: "api", iconKey: "groq", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.groq.com/openai/v1")], presets: ["llama-4-scout"] },
    { id: "xai", displayName: "xAI", category: "api", iconKey: "xai", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.x.ai/v1")], presets: ["grok-4"] },
    { id: "openrouter", displayName: "OpenRouter", category: "api", iconKey: "openrouter", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://openrouter.ai/api/v1")], presets: ["openai/gpt-5"] },
    { id: "together", displayName: "Together", category: "api", iconKey: "together", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.together.xyz/v1")], presets: [] },
    { id: "fireworks", displayName: "Fireworks", category: "api", iconKey: "fireworks", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.fireworks.ai/inference/v1")], presets: [] },
    { id: "siliconflow", displayName: "SiliconFlow", category: "api", iconKey: "siliconflow", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.siliconflow.cn/v1")], presets: [] },
    { id: "nvidia-nim", displayName: "NVIDIA NIM", category: "api", iconKey: "nvidia", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://integrate.api.nvidia.com/v1")], presets: [] },
    { id: "modelscope", displayName: "ModelScope", category: "api", iconKey: "modelscope", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api-inference.modelscope.cn/v1")], presets: [] },
    { id: "ollama", displayName: "Ollama", category: "local", iconKey: "ollama", authMethods: LOCAL, endpoints: [OPENAI_CHAT("http://127.0.0.1:11434/v1")], presets: [] },
    { id: "lmstudio", displayName: "LM Studio", category: "local", iconKey: "lmstudio", authMethods: LOCAL, endpoints: [OPENAI_CHAT("http://127.0.0.1:1234/v1")], presets: [] },
    { id: "custom", displayName: "Custom OpenAI Compatible", category: "custom", iconKey: "custom", aliasOf: "custom-openai", authMethods: ["api_key", "oauth", "none"], endpoints: [{ ...CHAT, baseUrl: "" }], presets: [] },
    { id: "custom-openai", displayName: "Custom OpenAI Compatible", category: "custom", iconKey: "custom", authMethods: ["api_key", "oauth", "none"], endpoints: [{ ...CHAT, baseUrl: "" }], presets: [] },
    { id: "custom-anthropic", displayName: "Custom Anthropic Compatible", category: "custom", iconKey: "custom", authMethods: ["api_key", "oauth", "none"], endpoints: [{ ...ANTHROPIC, baseUrl: "" }], presets: [] },
    { id: "mimo", displayName: "MiMo", category: "api", iconKey: "mimo", authMethods: API_KEY, endpoints: [OPENAI_CHAT("https://api.xiaomimimo.com/v1")], presets: ["mimo-v2.5-pro", "mimo-v2.5"] },
    { id: "chatgpt-subscription", displayName: "ChatGPT / Codex Subscription", category: "subscription", iconKey: "openai", authMethods: SUBSCRIPTION, endpoints: [OPENAI], presets: ["chatgpt-auto", "codex-mini-latest"] },
    { id: "chatgpt", displayName: "ChatGPT", category: "subscription", iconKey: "openai", aliasOf: "chatgpt-subscription", authMethods: SUBSCRIPTION, endpoints: [OPENAI], presets: ["chatgpt-auto"] },
    { id: "codex-subscription", displayName: "Codex Subscription", category: "subscription", iconKey: "openai", aliasOf: "chatgpt-subscription", authMethods: SUBSCRIPTION, endpoints: [OPENAI], presets: ["codex-mini-latest"] },
    { id: "claude-subscription", displayName: "Claude Subscription", category: "subscription", iconKey: "anthropic", authMethods: SUBSCRIPTION, endpoints: [ANTHROPIC], presets: ["claude-sonnet"] },
    { id: "copilot-subscription", displayName: "GitHub Copilot", category: "subscription", iconKey: "github-copilot", authMethods: SUBSCRIPTION, endpoints: [CHAT], presets: ["copilot-default"] },
    { id: "gemini-subscription", displayName: "Gemini Subscription", category: "subscription", iconKey: "google", authMethods: SUBSCRIPTION, endpoints: [GEMINI], presets: ["gemini-auto"] },
    { id: "cursor-subscription", displayName: "Cursor", category: "subscription", iconKey: "cursor", authMethods: SUBSCRIPTION, endpoints: [CHAT], presets: ["cursor-auto"] },
    { id: "grok-subscription", displayName: "Grok Subscription", category: "subscription", iconKey: "xai", authMethods: SUBSCRIPTION, endpoints: [CHAT], presets: ["grok-auto"] },
    { id: "devin-subscription", displayName: "Devin", category: "subscription", iconKey: "devin", authMethods: SUBSCRIPTION, endpoints: [CHAT], presets: ["devin-auto"] },
];
export function createProviderAdapter(definition, random = randomUUID, configuredEndpoints = definition.endpoints) {
    const endpoints = configuredEndpoints;
    return {
        id: definition.id,
        displayName: definition.displayName,
        category: definition.category,
        iconKey: definition.iconKey,
        authMethods: definition.authMethods,
        endpoints,
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
            const endpoint = endpoints[0];
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
            const endpoint = endpoints[0];
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
            const endpoint = endpoints.find((item) => item.modelsPath) ?? endpoints[0];
            if (!endpoint?.baseUrl)
                return presetsToModels(definition, endpoints);
            const response = await client.request(`${endpoint.baseUrl}${endpoint.modelsPath}`, { method: "GET", headers: this.authorizationHeaders(account, secret, endpoint.protocol) }, requestContext(account));
            if (response.status < 200 || response.status >= 300)
                throw new Error(`Provider model discovery failed with HTTP ${response.status}`);
            const payload = await response.json();
            const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
            const discovered = data.flatMap((item) => typeof item === "string" ? [item] : isRecord(item) && typeof item.id === "string" ? [item.id] : []);
            const allModels = [...new Set([...discovered, ...definition.presets])].map((id) => modelFor(definition, id, "discovery", endpoints));
            if (!account.allowedModelIds)
                return allModels;
            const allowed = new Set(account.allowedModelIds);
            return allModels.filter((model) => allowed.has(model.id));
        },
        async listModels(client, account, secret) {
            return this.discoverModels(client, account, secret);
        },
        async readQuota(client, account, secret = account.secretRef) {
            const endpoint = endpoints.find((item) => item.quotaPath);
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
/** Creates the same adapter contract with environment-specific endpoint URLs. */
export function createConfiguredProviderAdapter(definition, endpoints, random = randomUUID) {
    return createProviderAdapter(definition, random, endpoints);
}
/** Returns the complete built-in catalog, including legacy aliases for migration. */
export function providerDefinitions() { return DEFINITIONS; }
/** Returns only canonical entries suitable for a user-facing Provider picker. */
export function canonicalProviderDefinitions() {
    return DEFINITIONS.filter((definition) => !definition.aliasOf);
}
/** Normalizes an old or alternate Provider ID without changing persisted data. */
export function normalizeBuiltInProviderId(id) {
    const definition = DEFINITIONS.find((item) => item.id === id);
    return definition?.aliasOf ?? definition?.id ?? id;
}
function presetsToModels(definition, endpoints = definition.endpoints) { return definition.presets.map((id) => modelFor(definition, id, "preset", endpoints)); }
function modelFor(definition, id, source, endpoints = definition.endpoints) {
    const protocols = [...new Set(endpoints.map((endpoint) => endpoint.protocol))];
    return { id, displayName: id, providerId: definition.id, iconKey: definition.iconKey, protocols, capabilities: { reasoning: /reason|o[1-9]|opus|sonnet|think/i.test(id), tools: true, vision: /vision|gemini|claude|gpt-4/i.test(id), streaming: true }, source };
}
function requestContext(account) {
    return { accountId: account.accountId, ...(account.proxyUrl ? { proxyUrl: account.proxyUrl } : {}) };
}
function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
//# sourceMappingURL=adapters.js.map