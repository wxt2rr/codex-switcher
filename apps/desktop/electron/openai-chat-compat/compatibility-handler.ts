import { authorizeRouteToken, type RouteRuntimeSecret, type RouteTarget } from "../usage-routing-model.js";
import { filterUnsupportedHostedTools, initializeGatewayCapabilityRuntime, type CapabilityProfile } from "../gateway-capability-runtime.js";
import { ConversationHistoryStore } from "./history-store.js";
import { transformResponsesRequest } from "./request-transformer.js";
import { transformChatResponse } from "./response-transformer.js";
import { transformChatStream } from "./stream-transformer.js";
import { CompatibilityError } from "./types.js";
import { ChatUpstreamClient } from "./upstream-client.js";

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
  const enriched = await options.history.enrichRequest(options.route.routeId, options.request);
  const capabilityRuntimeReady = await initializeGatewayCapabilityRuntime();
  const filtered = capabilityRuntimeReady
    ? filterUnsupportedHostedTools(
      enriched.request as import("../../../../packages/gateway/dist/protocol.js").JsonObject,
      options.capabilityProfile,
      options.capabilityProfile ? "safe" : "allow",
    )
    : { body: enriched.request as import("../../../../packages/gateway/dist/protocol.js").JsonObject, omitted: [] };
  const transformed = transformResponsesRequest({
    // Keep the Codex-facing model in `requestedModel` for the response while
    // sending the provider-specific id in the Chat request body.
    request: filtered.body as Record<string, unknown>,
    upstreamModel: resolveCompatibilityUpstreamModel(options.route, filtered.body.model),
    reasoningProfile: options.route.reasoningProfile,
    requestOverrides: options.route.requestOverrides,
    longConversationStrategy: options.route.longConversationStrategy ?? "safe",
    instructionRole: options.route.instructionRole ?? "auto",
  });
  if (filtered.omitted.length) transformed.warning = transformed.warning
    ? `${transformed.warning} 已自动移除不兼容的 Hosted Tool。`
    : "已自动移除当前服务商不支持的 Hosted Tool。";
  const upstream = await (options.client ?? new ChatUpstreamClient()).execute({
    baseUrl: options.route.upstreamBaseUrl,
    apiKey: options.secret.upstreamApiKey,
    body: transformed.body,
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
    const stream = transformChatStream({ body: upstream.body, model: transformed.requestedModel,
      warning: transformed.warning,
      registry: transformed.tools, signal: options.signal, onCompleted: async ({ responseId, calls }) => {
        await options.history.recordResponse(options.route.routeId, { responseId, createdAt: Date.now(), calls });
      } });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  }
  const payload = await upstream.json();
  const result = transformChatResponse(payload, {
    model: transformed.requestedModel, registry: transformed.tools, warning: transformed.warning,
  });
  await options.history.recordResponse(options.route.routeId, {
    responseId: result.response.id,
    createdAt: Date.now(),
    calls: result.calls,
  });
  return Response.json(result.response);
}
