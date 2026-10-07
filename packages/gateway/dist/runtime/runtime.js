import { randomUUID } from "node:crypto";
import { decodeGatewayRequest, decodeGatewayResponse, encodeGatewayRequest, encodeGatewayResponse } from "../protocol/codecs.js";
import { createGatewayRequestContext } from "../request/request-ir.js";
import { classifyRouteFailure, isRetryableRouteFailure, resolveRoute } from "../routing/engine.js";
import { ProviderRegistry } from "../provider/registry.js";
import { UsageLedger, UsageTrace, calculateUsageCost, hashSessionId } from "../usage/ledger.js";
export class GatewayFallbackError extends Error {
    attempts;
    lastError;
    constructor(message, attempts, lastError) {
        super(message);
        this.attempts = attempts;
        this.lastError = lastError;
        this.name = "GatewayFallbackError";
    }
}
/**
 * The framework-agnostic Gateway orchestration layer.
 *
 * Electron/HTTP code supplies transport and persistence; this class owns the
 * request lifecycle: decode, route resolution, protocol
 * conversion, quota admission, usage accounting, and response conversion.
 */
export class GatewayRuntime {
    providerRegistry;
    ledger;
    now;
    options;
    trace;
    constructor(options) {
        this.options = { ...options, candidates: [...options.candidates] };
        this.providerRegistry = options.providerRegistry ?? new ProviderRegistry();
        this.ledger = options.ledger ?? new UsageLedger();
        this.now = options.now ?? Date.now;
        this.trace = new UsageTrace(this.ledger, this.now);
    }
    dispatch(input) {
        const startedAt = input.now ?? this.now();
        const requestId = input.requestId ?? randomUUID();
        const traceId = input.traceId ?? randomUUID();
        const context = createGatewayRequestContext({
            requestId,
            environmentId: input.environmentId,
            agentId: input.agentId,
            protocol: input.protocol,
            logicalModelId: input.model,
            sessionId: input.sessionId,
            capabilities: input.capabilities,
            receivedAt: startedAt,
            metadata: input.metadata,
        });
        const request = decodeGatewayRequest(input.protocol, input.body, context);
        this.trace.start(traceId, `${traceId}:ingress`, "ingress", { agentId: input.agentId, protocol: input.protocol });
        this.trace.finish(`${traceId}:ingress`, { model: input.model });
        const requestedModel = input.model;
        const route = resolveRoute(this.options.candidates, this.options.groups, {
            requestedModel,
            protocol: input.protocol,
            allowProtocolConversion: true,
            requiredCapabilities: input.requiredCapabilities,
            sessionKey: input.sessionId,
            turnKey: input.turnKey,
            agentId: input.agentId,
            now: startedAt,
            state: input.routeState,
        });
        const provider = this.providerRegistry.get(route.route.providerId);
        if (!provider.endpoints.some((endpoint) => endpoint.protocol === route.route.protocol)) {
            throw new Error(`Provider '${route.route.providerId}' does not expose protocol '${route.route.protocol}'`);
        }
        if (this.options.quotaPolicy) {
            const quota = this.ledger.quota(this.options.quotaPolicy, { environmentId: input.environmentId, providerId: route.route.providerId, agentId: input.agentId }, startedAt);
            if (!quota.allowed)
                throw new Error(`Gateway quota exceeded: ${quota.reason ?? "unknown"}`);
        }
        return this.materializeDispatch(request, route, traceId, startedAt, "route");
    }
    async dispatchWithFallback(input, send) {
        const primary = this.dispatch(input);
        const dispatches = [
            primary,
            ...primary.route.fallbackRoutes.map((fallback, index) => this.materializeDispatch(primary.request, { ...primary.route, route: fallback, traces: [...primary.route.traces, ...fallback.decisionTrace] }, primary.traceId, primary.startedAt, `fallback:${index + 1}`)),
        ];
        const attempts = [];
        let lastError;
        for (let index = 0; index < dispatches.length; index += 1) {
            const dispatch = dispatches[index];
            try {
                const result = await send(dispatch, index);
                const status = result.status ?? null;
                const firstByteStarted = result.firstByteStarted === true;
                if (status !== null && status >= 400) {
                    const failureClass = classifyRouteFailure(status);
                    attempts.push({ route: dispatch.route.route, status, firstByteStarted, failureClass });
                    if (!firstByteStarted && isRetryableRouteFailure(failureClass) && index + 1 < dispatches.length)
                        continue;
                    throw new GatewayFallbackError(`Gateway upstream failed after ${attempts.length} attempt(s)`, attempts, result);
                }
                if (result.value === undefined) {
                    const failureClass = classifyRouteFailure(null, new Error("Gateway transport returned no value"));
                    attempts.push({ route: dispatch.route.route, status, firstByteStarted, failureClass });
                    if (!firstByteStarted && isRetryableRouteFailure(failureClass) && index + 1 < dispatches.length)
                        continue;
                    throw new GatewayFallbackError(`Gateway upstream returned no value after ${attempts.length} attempt(s)`, attempts, result);
                }
                attempts.push({ route: dispatch.route.route, status, firstByteStarted });
                return { value: result.value, dispatch, attempts, retryCount: Math.max(0, attempts.length - 1) };
            }
            catch (error) {
                lastError = error;
                if (error instanceof GatewayFallbackError)
                    throw error;
                const details = transportFailureDetails(error);
                const failureClass = classifyRouteFailure(details.status, error);
                attempts.push({ route: dispatch.route.route, status: details.status, firstByteStarted: details.firstByteStarted, failureClass });
                if (details.firstByteStarted || !isRetryableRouteFailure(failureClass) || index + 1 >= dispatches.length) {
                    throw new GatewayFallbackError(`Gateway upstream failed after ${attempts.length} attempt(s)`, attempts, lastError);
                }
            }
        }
        throw new GatewayFallbackError("Gateway upstream failed without a dispatch attempt", attempts, lastError);
    }
    materializeDispatch(request, route, traceId, startedAt, spanSuffix) {
        const provider = this.providerRegistry.get(route.route.providerId);
        if (!provider.endpoints.some((endpoint) => endpoint.protocol === route.route.protocol)) {
            throw new Error(`Provider '${route.route.providerId}' does not expose protocol '${route.route.protocol}'`);
        }
        const spanId = `${traceId}:${spanSuffix}`;
        this.trace.start(traceId, spanId, "route", { providerId: route.route.providerId, credentialId: route.route.credentialId, routeGroupId: route.groupId ?? "" });
        this.trace.finish(spanId, { upstreamModel: route.route.upstreamModelId });
        return {
            request,
            route,
            upstreamProtocol: route.route.protocol,
            upstreamModel: route.route.upstreamModelId,
            upstreamBody: encodeGatewayRequest(route.route.protocol, request, route.route.upstreamModelId),
            traceId,
            startedAt,
        };
    }
    complete(input) {
        const completedAt = input.completedAt ?? this.now();
        const events = input.upstreamBody ? decodeGatewayResponse(input.dispatch.upstreamProtocol, input.upstreamBody) : [];
        const usageEvent = events.find((event) => event.type === "usage");
        const status = input.status ?? (events.some((event) => event.type === "error") ? "error" : "success");
        const profile = this.options.pricingProfiles?.find((candidate) => candidate.providerId === input.dispatch.route.route.providerId && new RegExp(candidate.modelPattern).test(input.dispatch.route.route.upstreamModelId));
        const base = {
            requestId: input.dispatch.request.context.requestId,
            traceId: input.dispatch.traceId,
            sessionIdHash: input.dispatch.request.context.sessionId ? hashSessionId(input.dispatch.request.context.sessionId) : undefined,
            agentId: input.dispatch.request.context.agentId,
            environmentId: input.dispatch.request.context.environmentId,
            providerId: input.dispatch.route.route.providerId,
            credentialId: input.dispatch.route.route.credentialId,
            requestedModel: input.dispatch.request.context.logicalModelId,
            servedModel: input.dispatch.route.route.upstreamModelId,
            protocol: input.dispatch.request.context.protocol,
            routeGroupId: input.dispatch.route.groupId,
            startedAt: input.dispatch.startedAt,
            completedAt,
            ...(input.firstByteAt !== undefined ? { timeToFirstTokenMs: Math.max(0, input.firstByteAt - input.dispatch.startedAt) } : {}),
            inputTokens: usageEvent?.inputTokens ?? 0,
            outputTokens: usageEvent?.outputTokens ?? 0,
            reasoningTokens: usageEvent?.reasoningTokens ?? 0,
            cacheReadTokens: usageEvent?.cacheReadTokens ?? 0,
            cacheWriteTokens: usageEvent?.cacheWriteTokens ?? 0,
            actualCost: null,
            standardCost: null,
            status,
            ...(input.failureClass ? { failureClass: input.failureClass } : {}),
            retryCount: input.retryCount ?? 0,
        };
        const standardCost = profile ? calculateUsageCost(base, profile) : null;
        const usage = { ...base, standardCost, actualCost: standardCost };
        this.ledger.append(usage);
        this.trace.start(input.dispatch.traceId, `${input.dispatch.traceId}:usage`, "usage", { status, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        this.trace.finish(`${input.dispatch.traceId}:usage`, { cost: standardCost ?? 0 });
        return {
            ...(input.upstreamBody ? { responseBody: encodeGatewayResponse(input.dispatch.request.context.protocol, events) } : {}),
            usage,
        };
    }
}
function transportFailureDetails(error) {
    if (typeof error === "object" && error !== null) {
        const value = error;
        return {
            status: typeof value.status === "number" ? value.status : null,
            firstByteStarted: value.firstByteStarted === true,
        };
    }
    return { status: null, firstByteStarted: false };
}
//# sourceMappingURL=runtime.js.map