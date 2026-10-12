const DEFAULT_BASE_URL = "https://our-free-model.invalid/v1";
const DEFAULT_FALLBACK_MODELS = ["free-model"];

export function createOurFreeModelProvider(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cache = new Map();
  const baseUrl = normalizeBaseUrl(env.CSW_OUR_FREE_MODEL_BASE_URL || DEFAULT_BASE_URL);
  const modelsUrl = env.CSW_OUR_FREE_MODEL_MODELS_URL?.trim() || `${baseUrl}/models`;
  const fallbackModels = parseFallbackModels(env.CSW_OUR_FREE_MODEL_FALLBACK_MODELS);
  const quotaUrl = env.CSW_OUR_FREE_MODEL_QUOTA_URL?.trim();

  return {
    describe() {
      return {
        id: "our-free-model",
        displayName: "Our Free Model",
        authMethods: ["none"],
        endpoints: [
          { protocol: "responses", baseUrl, modelsPath: "/models" },
          { protocol: "chat_completions", baseUrl, modelsPath: "/models" },
        ],
      };
    },

    async models({ account, secret, settings = {} }) {
      const cacheKey = account?.accountId || "anonymous";
      const configuredBaseUrl = normalizeBaseUrl(settings.baseUrl || baseUrl);
      const configuredModelsUrl = typeof settings.modelsUrl === "string" && settings.modelsUrl.trim() ? settings.modelsUrl.trim() : (configuredBaseUrl === baseUrl ? modelsUrl : `${configuredBaseUrl}/models`);
      const configuredFallbackModels = typeof settings.fallbackModels === "string" && settings.fallbackModels.trim()
        ? parseFallbackModels(settings.fallbackModels)
        : fallbackModels;
      try {
        const response = await fetchWithTimeout(fetchImpl, configuredModelsUrl, {
          headers: {
            accept: "application/json",
            ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          },
        }, env.CSW_OUR_FREE_MODEL_TIMEOUT_MS);
        if (!response.ok) throw new Error(`model discovery returned HTTP ${response.status}`);
        const payload = await response.json();
        const models = normalizeModels(payload);
        if (!models.length) throw new Error("model discovery returned no usable models");
        cache.set(cacheKey, { models, observedAt: now() });
        return models;
      } catch (error) {
        const previous = cache.get(cacheKey);
        if (previous?.models?.length) return previous.models.map((model) => ({ ...model, source: "discovery" }));
        return configuredFallbackModels.map((model) => ({ ...model, source: "preset" }));
      }
    },

    async quota({ secret, settings = {} }) {
      const configuredQuotaUrl = typeof settings.quotaUrl === "string" && settings.quotaUrl.trim() ? settings.quotaUrl.trim() : quotaUrl;
      if (!configuredQuotaUrl) return null;
      try {
        const response = await fetchWithTimeout(fetchImpl, configuredQuotaUrl, {
          headers: { accept: "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
        }, env.CSW_OUR_FREE_MODEL_TIMEOUT_MS);
        if (!response.ok) return null;
        return { ...(await response.json()), observedAt: now() };
      } catch {
        return null;
      }
    },

    async request({ url, method, headers = {}, body }) {
      const response = await fetchWithTimeout(fetchImpl, url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual",
      }, env.CSW_OUR_FREE_MODEL_TIMEOUT_MS);
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      if (contentType.toLowerCase().includes("text/event-stream")) {
        const events = parseSseEvents(text);
        return {
          status: response.status,
          headers: responseHeaders,
          ...(events.length ? { events } : {}),
        };
      }
      if (!text.trim()) return { status: response.status, headers: responseHeaders };
      try {
        const payload = JSON.parse(text);
        return {
          status: response.status,
          headers: responseHeaders,
          body: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { data: payload },
        };
      } catch {
        return {
          status: response.status,
          headers: responseHeaders,
          body: { error: { message: text.slice(0, 16_384) } },
        };
      }
    },

    refresh() { return null; },
    revoke() { return null; },
  };
}

export function normalizeModels(payload) {
  const values = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  return values.flatMap((item) => {
    const id = typeof item === "string" ? item.trim() : typeof item?.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const protocols = Array.isArray(item?.protocols) ? item.protocols.filter((value) => ["responses", "chat_completions", "anthropic", "gemini"].includes(value)) : ["responses", "chat_completions"];
    const capabilities = item?.capabilities && typeof item.capabilities === "object" ? item.capabilities : {};
    return [{
      id,
      displayName: typeof item?.displayName === "string" && item.displayName.trim() ? item.displayName : id,
      protocols: protocols.length ? protocols : ["responses", "chat_completions"],
      capabilities: {
        reasoning: capabilities.reasoning === true,
        tools: capabilities.tools !== false,
        vision: capabilities.vision === true,
        streaming: capabilities.streaming !== false,
      },
      ...(typeof item?.contextWindow === "number" ? { contextWindow: item.contextWindow } : {}),
      source: "discovery",
    }];
  });
}

function parseFallbackModels(value) {
  if (!value?.trim()) return DEFAULT_FALLBACK_MODELS.map((id) => ({ id, protocols: ["responses", "chat_completions"], capabilities: { tools: true, streaming: true } }));
  try {
    const parsed = JSON.parse(value);
    const models = normalizeModels(parsed);
    if (models.length) return models;
  } catch { /* comma-separated ids are accepted below */ }
  return value.split(",").map((id) => id.trim()).filter(Boolean).map((id) => ({ id, protocols: ["responses", "chat_completions"], capabilities: { tools: true, streaming: true } }));
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutValue) {
  const timeout = Math.max(500, Number(timeoutValue) || 10_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function normalizeBaseUrl(value) { return String(value).trim().replace(/\/+$/, ""); }

function parseSseEvents(text) {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return [];
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}
