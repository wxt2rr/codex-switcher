import { createManagedRuntime } from "./managed-runtime.mjs";

export function createOurFreeModelProvider(options = {}) {
  const runtime = options.runtime ?? createManagedRuntime(options);
  const cache = new Map();

  return {
    async describe() {
      const connection = await runtime.ensure();
      return {
        id: "our-free-model",
        displayName: "Our Free Model",
        authMethods: ["none"],
        managed: true,
        managementUrl: connection.managementUrl,
        endpoints: [
          { protocol: "responses", baseUrl: connection.baseUrl, modelsPath: "/models" },
          { protocol: "chat_completions", baseUrl: connection.baseUrl, modelsPath: "/models" },
          { protocol: "anthropic", baseUrl: connection.baseUrl, modelsPath: "/models" },
        ],
      };
    },

    async models({ account, signal } = {}) {
      const cacheKey = account?.accountId || "anonymous";
      try {
        const payload = await runtime.models(signal);
        const models = normalizeModels(payload);
        if (!models.length) throw new Error("Our Free Model returned no usable models");
        cache.set(cacheKey, models);
        return models;
      } catch (error) {
        signal?.throwIfAborted();
        const previous = cache.get(cacheKey);
        if (previous?.length) return previous.map((model) => ({ ...model, source: "discovery" }));
        throw error;
      }
    },

    async request(input) {
      return runtime.request(input);
    },

    async quota() {
      return null;
    },

    async refresh() {
      return null;
    },

    async revoke() {
      return null;
    },

    async management() {
      const connection = await runtime.ensure();
      return { url: connection.managementUrl, baseUrl: connection.baseUrl, port: connection.port };
    },

    async close() {
      await runtime.close();
    },
  };
}

export function normalizeModels(payload) {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
  const seen = new Set();
  return values.flatMap((item) => {
    const id = typeof item === "string" ? item.trim() : typeof item?.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const input = Array.isArray(item?.input) ? item.input : Array.isArray(item?.modalities?.input) ? item.modalities.input : [];
    const rawCapabilities = item?.capabilities && typeof item.capabilities === "object" ? item.capabilities : {};
    const reasoningEfforts = item?.reasoning_efforts ?? item?.reasoning?.efforts;
    const reasoning = rawCapabilities.reasoning === true
      || item?.reasoning === true
      || (item?.reasoning !== null && typeof item?.reasoning === "object")
      || (Array.isArray(reasoningEfforts) && reasoningEfforts.length > 0);
    const protocols = Array.isArray(item?.protocols)
      ? item.protocols.filter((value) => ["responses", "chat_completions", "anthropic", "gemini"].includes(value))
      : ["responses", "chat_completions", "anthropic"];
    const vision = rawCapabilities.vision === true || item?.vision === true || item?.supportsImages === true || input.includes("image");
    return [{
      id,
      displayName: typeof item?.displayName === "string" && item.displayName.trim()
        ? item.displayName
        : typeof item?.name === "string" && item.name.trim() ? item.name : id,
      protocols: protocols.length ? protocols : ["responses", "chat_completions", "anthropic"],
      capabilities: {
        reasoning,
        tools: rawCapabilities.tools !== false && item?.tool_call !== false,
        vision,
        streaming: rawCapabilities.streaming !== false,
      },
      ...(typeof item?.contextWindow === "number" ? { contextWindow: item.contextWindow } : typeof item?.context_window === "number" ? { contextWindow: item.context_window } : {}),
      source: "discovery",
    }];
  });
}
