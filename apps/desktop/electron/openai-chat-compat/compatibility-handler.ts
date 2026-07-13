import { authorizeRouteToken, type RouteRuntimeSecret, type RouteTarget } from "../usage-routing-model.js";
import { ConversationHistoryStore } from "./history-store.js";
import { transformResponsesRequest } from "./request-transformer.js";
import { transformChatResponse } from "./response-transformer.js";
import { transformChatStream } from "./stream-transformer.js";
import { CompatibilityError } from "./types.js";
import { ChatUpstreamClient } from "./upstream-client.js";

export interface CompatibilityHandlerOptions {
  route: RouteTarget;
  secret: RouteRuntimeSecret;
  authorization: string | undefined;
  request: Record<string, unknown>;
  headers?: HeadersInit;
  signal?: AbortSignal;
  history: ConversationHistoryStore;
  client?: ChatUpstreamClient;
}

export async function handleChatCompatibilityRequest(options: CompatibilityHandlerOptions): Promise<Response> {
  if (!authorizeRouteToken(options.authorization, options.secret.localRouteToken)) {
    throw new CompatibilityError("INVALID_REQUEST", "Unauthorized route token", 401);
  }
  const enriched = await options.history.enrichRequest(options.route.routeId, options.request);
  const transformed = transformResponsesRequest({
    request: enriched.request,
    upstreamModel: options.route.upstreamModel,
    reasoningProfile: options.route.reasoningProfile,
    requestOverrides: options.route.requestOverrides,
    longConversationStrategy: options.route.longConversationStrategy ?? "safe",
    instructionRole: options.route.instructionRole ?? "auto",
  });
  const upstream = await (options.client ?? new ChatUpstreamClient()).execute({
    baseUrl: options.route.upstreamBaseUrl,
    apiKey: options.secret.upstreamApiKey,
    body: transformed.body,
    headers: options.headers,
    signal: options.signal,
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
