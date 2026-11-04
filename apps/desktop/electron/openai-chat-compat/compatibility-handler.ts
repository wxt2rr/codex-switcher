import { authorizeRouteToken, type RouteRuntimeSecret, type RouteTarget } from "../usage-routing-model.js";
import { filterUnsupportedRouteCapabilities, initializeGatewayCapabilityRuntime, type CapabilityProfile } from "../gateway-capability-runtime.js";
import {
  convertGatewayRequestAtRuntime,
  convertGatewayResponseAtRuntime,
  convertGatewayResponseStreamAtRuntime,
  encodeGatewayResponseEventsAtRuntime,
} from "../gateway-conversion-runtime.js";
import { ConversationHistoryStore, resolveHistoryScope } from "./history-store.js";
import { CompatibilityError } from "./types.js";
import { ChatUpstreamClient } from "./upstream-client.js";
import type { ConversionMetadata, ConversionOptions } from "../../../../packages/gateway/dist/conversion/index.js";
import type { JsonObject } from "../../../../packages/gateway/dist/protocol.js";

/**
 * Codex exposes account-scoped models as `<provider>:<model>`, while a
 * provider-compatible endpoint expects only the upstream model id. Keep an
 * explicit route model as the fallback for legacy single-model routes, but
 * prefer the provider-qualified request when it is available so multiple
 * models can share one compatibility route.
 */
export function resolveCompatibilityUpstreamModel(
  route: Pick<RouteTarget, "providerId" | "upstreamModel">,
  requestedModel: unknown,
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  const provider = route.providerId?.trim();
  if (requested && provider && requested.startsWith(`${provider}:`)) {
    const upstream = requested.slice(provider.length + 1).trim();
    if (upstream) return upstream;
  }
  // Older persisted compatibility routes did not store providerId. Their
  // catalog-facing model still follows the provider:model convention, so
  // strip one prefix only when no explicit route model exists.
  if (requested && !route.upstreamModel?.trim()) {
    const separator = requested.indexOf(":");
    if (separator > 0) {
      const upstream = requested.slice(separator + 1).trim();
      if (upstream) return upstream;
    }
  }
  return route.upstreamModel?.trim() || requested || undefined;
}

export interface CompatibilityHandlerOptions {
  route: RouteTarget;
  secret: RouteRuntimeSecret;
  authorization: string | undefined;
  request: Record<string, unknown>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  history: ConversationHistoryStore;
  client?: ChatUpstreamClient;
  capabilityProfile?: CapabilityProfile;
}

export async function handleChatCompatibilityRequest(options: CompatibilityHandlerOptions): Promise<Response> {
  if (!authorizeRouteToken(options.authorization, options.secret.localRouteToken)) {
    throw new CompatibilityError("INVALID_REQUEST", "Unauthorized route token", 401);
  }
  const historyScope = resolveHistoryScope(options.route.routeId, options.request);
  const enriched = await options.history.enrichRequest(historyScope, options.request);
  const capabilityRuntimeReady = await initializeGatewayCapabilityRuntime();
  const filtered = capabilityRuntimeReady
    ? filterUnsupportedRouteCapabilities(
      enriched.request as import("../../../../packages/gateway/dist/protocol.js").JsonObject,
      options.capabilityProfile,
      options.capabilityProfile ? "safe" : "allow",
      "chat_completions",
    )
    : { body: enriched.request as import("../../../../packages/gateway/dist/protocol.js").JsonObject, omitted: [] };
  const request = filtered.body as JsonObject;
  const requestedModel = typeof request.model === "string" ? request.model : "";
  const upstreamModel = resolveCompatibilityUpstreamModel(options.route, request.model);
  if (!requestedModel.trim()) throw new CompatibilityError("INVALID_REQUEST", "model must be a string");
  const opaqueCompaction = Array.isArray(request.input) && request.input.some((item) => {
    const value = isObject(item) ? item : undefined;
    return value?.type === "compaction" || value?.type === "compaction_summary";
  });
  if (opaqueCompaction && options.route.longConversationStrategy !== "continuity") {
    throw new CompatibilityError("INCOMPATIBLE_COMPACTION", "当前会话包含无法转换的压缩历史，请新建窗口继续。", 409);
  }
  let warning: string | undefined;
  if (opaqueCompaction) warning = "已使用可读取的历史继续，部分早期上下文可能丢失。";
  if (filtered.omitted.length) warning = warning
    ? `${warning} 已自动移除当前服务商不支持的请求参数或工具。`
    : "已自动移除当前服务商不支持的请求参数或工具。";
  const metadata: ConversionMetadata = {
    originModelName: requestedModel,
    upstreamModelName: upstreamModel,
    upstreamEndpoint: options.route.upstreamBaseUrl,
  };
  const conversionOptions: ConversionOptions = {
    toolLossPolicy: "allow",
    instructionRole: options.route.instructionRole ?? "auto",
    ...(options.capabilityProfile && Object.keys(options.capabilityProfile).length
      ? { capabilityProfile: options.capabilityProfile, capabilityPolicy: "safe" as const }
      : {}),
    ...(warning ? { warning } : {}),
  };
  const converted = await convertGatewayRequestAtRuntime("responses", "chat_completions", request, metadata, conversionOptions);
  if (!converted) throw new CompatibilityError("UPSTREAM_PROTOCOL", "共享 Gateway 转换运行时不可用，请重启或重新安装应用。", 502);
  // A response is addressed to the ingress client.  Swap the model labels for
  // the reverse leg just like GatewayRuntime.complete does, while retaining
  // the request-scoped tool/namespace maps produced above.
  const responseMetadata: ConversionMetadata = {
    ...(converted.metadata ?? metadata),
    originModelName: upstreamModel,
    upstreamModelName: requestedModel,
  };
  const upstreamBody = applyCompatibilityOverrides(
    applyReasoningProfile(converted.value as JsonObject, options.route.reasoningProfile),
    options.route.requestOverrides,
  );
  const upstream = await (options.client ?? new ChatUpstreamClient()).execute({
    baseUrl: options.route.upstreamBaseUrl,
    apiKey: options.secret.upstreamApiKey,
    body: upstreamBody as Record<string, unknown>,
    headers: options.headers,
    configuredHeaders: options.route.requestHeaders,
    signal: options.signal,
    proxyUrl: options.route.proxyUrl,
  });
  if (!upstream.ok) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
  }
  if (options.request.stream === true) {
    if (!upstream.body) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Streaming Chat response has no body", 502);
    const convertedStream = await convertGatewayResponseStreamAtRuntime(
      upstream,
      "chat_completions",
      "responses",
      responseMetadata,
      { ...(warning ? { warning } : {}) },
      {
        onFinalized: async (state) => {
          const response = await encodeGatewayResponseEventsAtRuntime("responses", state.events, state.metadata);
          if (response) await recordCompatibilityResponse(options.history, historyScope, response);
        },
      },
    );
    if (!convertedStream) throw new CompatibilityError("UPSTREAM_PROTOCOL", "共享 Gateway 流式转换运行时不可用，请重启或重新安装应用。", 502);
    return convertedStream;
  }
  if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
  const payload = await upstream.json() as unknown;
  if (!isObject(payload)) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Chat response must be an object", 502);
  const result = await convertGatewayResponseAtRuntime("chat_completions", "responses", payload, responseMetadata, { ...(warning ? { warning } : {}) });
  if (!result) throw new CompatibilityError("UPSTREAM_PROTOCOL", "共享 Gateway 响应转换运行时不可用，请重启或重新安装应用。", 502);
  await recordCompatibilityResponse(options.history, historyScope, result.value as JsonObject);
  return Response.json(result.value);
}

async function recordCompatibilityResponse(history: ConversationHistoryStore, scope: string, response: JsonObject): Promise<void> {
  const responseId = typeof response.id === "string" ? response.id : undefined;
  if (!responseId) return;
  const items = Array.isArray(response.output) ? response.output.flatMap((item) => isObject(item) ? [item] : []) : [];
  const calls = items.flatMap((item) => {
    const type = typeof item.type === "string" ? item.type : "";
    if (!type.endsWith("_call") || !["function_call", "custom_tool_call", "tool_search_call"].includes(type)) return [];
    const id = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name : "";
    if (!id || !name) return [];
    const custom = type === "custom_tool_call";
    const argumentValue = custom ? item.input ?? "" : item.arguments ?? item.input ?? {};
    const argumentsText = typeof argumentValue === "string" ? argumentValue : JSON.stringify(argumentValue);
    return [{ id, type: "function" as const, ...(custom ? { kind: "custom" as const } : type === "tool_search_call" ? { kind: "tool_search" as const } : {}), ...(typeof item.id === "string" ? { itemId: item.id } : {}), ...(typeof item.output_index === "number" ? { outputIndex: item.output_index } : {}), ...(typeof item.thought_signature === "string" ? { signature: item.thought_signature } : {}), function: { name, arguments: argumentsText } }];
  });
  const incomplete = isObject(response.incomplete_details) ? response.incomplete_details : undefined;
  await history.recordResponse(scope, {
    responseId,
    createdAt: typeof response.created_at === "number" ? response.created_at * 1000 : Date.now(),
    calls,
    ...(items.length ? { items } : {}),
    ...(isObject(response.metadata) ? { metadata: response.metadata } : {}),
    ...(isObject(response.usage) ? { usage: response.usage } : {}),
    ...(typeof response.status === "string" ? { status: response.status } : {}),
    ...(typeof incomplete?.reason === "string" ? { incompleteReason: incomplete.reason } : {}),
    ...(incomplete ? { incompleteDetails: incomplete } : {}),
  });
}

function applyReasoningProfile(body: JsonObject, profile: RouteTarget["reasoningProfile"]): JsonObject {
  if (profile === "reasoning_content") return { ...body, reasoning_format: "reasoning_content" };
  if (profile === "think_tags") return { ...body, reasoning_format: "think_tags" };
  return body;
}

function applyCompatibilityOverrides(body: JsonObject, overrides: Record<string, unknown> | undefined): JsonObject {
  if (!overrides) return body;
  const result: JsonObject = { ...body };
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toLowerCase();
    if (["model", "messages", "tools", "stream", "authorization", "base_url"].includes(normalized)
      || normalized.includes("url") || normalized.includes("endpoint")) {
      throw new CompatibilityError("INVALID_REQUEST", `Request override '${key}' is protected`);
    }
    result[key] = value as import("../../../../packages/gateway/dist/protocol.js").JsonValue;
  }
  return result;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
