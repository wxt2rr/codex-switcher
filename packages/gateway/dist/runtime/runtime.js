import { randomUUID } from "node:crypto";
import { decodeGatewayRequest } from "../protocol/codecs.js";
import { convertGatewayRequest } from "../conversion/request-converter.js";
import { convertGatewayResponse } from "../conversion/response-converter.js";
import { convertStreamChunk, createResponseStreamState, failResponseStream, finalizeResponseStream } from "../conversion/stream-state.js";
import { decodeUsage } from "../conversion/usage.js";
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
export class GatewayMiddlewareRejectedError extends Error {
    status;
    code;
    constructor(message, status = 403, code = "MIDDLEWARE_REJECTED") {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "GatewayMiddlewareRejectedError";
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
    streamMiddlewareContexts = new WeakMap();
    constructor(options) {
        this.options = { ...options, candidates: [...options.candidates] };
        this.providerRegistry = options.providerRegistry ?? new ProviderRegistry();
        this.ledger = options.ledger ?? new UsageLedger();
        this.now = options.now ?? Date.now;
        this.trace = new UsageTrace(this.ledger, this.now);
    }
    async dispatch(input) {
        const startedAt = input.now ?? this.now();
        const requestId = input.requestId ?? randomUUID();
        const traceId = input.traceId ?? randomUUID();
        const middlewareContext = this.createMiddlewareContext({
            requestId,
            traceId,
            input,
            model: input.model,
        });
        const middlewareRequest = await this.options.middleware?.runRequest(input.body, middlewareContext);
        if (middlewareRequest?.reject) {
            throw new GatewayMiddlewareRejectedError(middlewareRequest.reject.message, middlewareRequest.reject.status, middlewareRequest.reject.code);
        }
        const requestBody = middlewareRequest?.body ?? input.body;
        const requestedModel = middlewareRequest?.model ?? input.model;
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
        const request = decodeGatewayRequest(input.protocol, requestBody, context);
        this.trace.start(traceId, `${traceId}:ingress`, "ingress", { agentId: input.agentId, protocol: input.protocol });
        this.trace.finish(`${traceId}:ingress`, { model: input.model });
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
        return this.materializeDispatch(request, requestBody, route, traceId, startedAt, "route", middlewareContext);
    }
    async dispatchWithFallback(input, send) {
        const primary = await this.dispatch(input);
        const dispatches = [
            primary,
            ...await Promise.all(primary.route.fallbackRoutes.map((fallback, index) => this.materializeDispatch(primary.request, primary.requestBody, { ...primary.route, route: fallback, traces: [...primary.route.traces, ...fallback.decisionTrace] }, primary.traceId, primary.startedAt, `fallback:${index + 1}`, primary.middlewareContext))),
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
    async materializeDispatch(request, requestBody, route, traceId, startedAt, spanSuffix, middlewareContext) {
        const provider = this.providerRegistry.get(route.route.providerId);
        if (!provider.endpoints.some((endpoint) => endpoint.protocol === route.route.protocol)) {
            throw new Error(`Provider '${route.route.providerId}' does not expose protocol '${route.route.protocol}'`);
        }
        const spanId = `${traceId}:${spanSuffix}`;
        this.trace.start(traceId, spanId, "route", { providerId: route.route.providerId, credentialId: route.route.credentialId, routeGroupId: route.groupId ?? "" });
        this.trace.finish(spanId, { upstreamModel: route.route.upstreamModelId });
        const conversion = await convertGatewayRequest(request.context.protocol, route.route.protocol, requestBody, {
            requestId: request.context.requestId,
            traceId,
            originModelName: request.context.logicalModelId,
            upstreamModelName: route.route.upstreamModelId,
            providerDialect: route.route.providerId,
        });
        return {
            request,
            requestBody,
            route,
            upstreamProtocol: route.route.protocol,
            upstreamModel: route.route.upstreamModelId,
            upstreamBody: conversion.value,
            conversion,
            traceId,
            startedAt,
            ...(middlewareContext ? { middlewareContext } : {}),
        };
    }
    async complete(input) {
        const completedAt = input.completedAt ?? this.now();
        const responseConversion = input.upstreamBody ? await convertGatewayResponse(input.dispatch.upstreamProtocol, input.dispatch.request.context.protocol, input.upstreamBody, {
            requestId: input.dispatch.request.context.requestId,
            traceId: input.dispatch.traceId,
            originModelName: input.dispatch.upstreamModel,
            upstreamModelName: input.dispatch.request.context.logicalModelId,
        }) : undefined;
        let responseBody = responseConversion?.value;
        if (responseBody && this.options.middleware) {
            const middlewareResponse = await this.options.middleware.runResponse(responseBody, input.dispatch.middlewareContext ?? this.createMiddlewareContextFromDispatch(input.dispatch));
            if (middlewareResponse.reject)
                throw new GatewayMiddlewareRejectedError(middlewareResponse.reject.message, middlewareResponse.reject.status, middlewareResponse.reject.code);
            responseBody = middlewareResponse.body;
        }
        const rawUsage = input.upstreamBody ? decodeUsage(input.dispatch.upstreamProtocol, input.upstreamBody) : undefined;
        const status = input.status ?? (input.upstreamBody?.error ? "error" : "success");
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
            inputTokens: rawUsage?.inputTokens ?? 0,
            outputTokens: rawUsage?.outputTokens ?? 0,
            reasoningTokens: rawUsage?.reasoningTokens ?? 0,
            cacheReadTokens: rawUsage?.cacheReadTokens ?? 0,
            cacheWriteTokens: rawUsage?.cacheWriteTokens ?? 0,
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
            ...(responseBody ? { responseBody } : {}),
            usage,
        };
    }
    createResponseStream(dispatch, options = {}) {
        const state = createResponseStreamState(dispatch.upstreamProtocol, dispatch.request.context.protocol, {
            requestId: dispatch.request.context.requestId,
            traceId: dispatch.traceId,
            originModelName: dispatch.upstreamModel,
            upstreamModelName: dispatch.request.context.logicalModelId,
        }, options);
        if (this.options.middleware)
            this.streamMiddlewareContexts.set(state, dispatch.middlewareContext ?? this.createMiddlewareContextFromDispatch(dispatch));
        return state;
    }
    convertStreamChunk(state, upstreamBody) {
        return convertStreamChunk(state, upstreamBody).then(async (result) => {
            if (!this.options.middleware)
                return result;
            const context = this.streamMiddlewareContexts.get(state) ?? this.createMiddlewareContextFromStream(state);
            const nextEvents = [];
            for (const event of result.value) {
                const next = await this.options.middleware.runEvent(event, context);
                if (next.reject)
                    throw new GatewayMiddlewareRejectedError(next.reject.message, next.reject.status, next.reject.code);
                if (next.event)
                    nextEvents.push(next.event);
            }
            return { ...result, value: nextEvents };
        });
    }
    finalizeStream(state, reason) {
        return finalizeResponseStream(state, reason);
    }
    failStream(state, code, message) {
        return failResponseStream(state, code, message);
    }
    createMiddlewareContext(input) {
        return {
            requestId: input.requestId,
            traceId: input.traceId,
            protocol: input.input.protocol,
            model: input.model,
            stream: input.input.body.stream === true,
            agentId: input.input.agentId,
            environmentId: input.input.environmentId,
            state: {},
        };
    }
    createMiddlewareContextFromDispatch(dispatch) {
        return {
            requestId: dispatch.request.context.requestId,
            traceId: dispatch.traceId,
            protocol: dispatch.request.context.protocol,
            model: dispatch.request.context.logicalModelId,
            stream: dispatch.request.stream,
            agentId: dispatch.request.context.agentId,
            environmentId: dispatch.request.context.environmentId,
            state: {},
        };
    }
    createMiddlewareContextFromStream(state) {
        return {
            requestId: state.metadata.requestId ?? state.id,
            traceId: state.metadata.traceId ?? state.id,
            protocol: state.target,
            model: state.metadata.originModelName ?? state.metadata.upstreamModelName ?? "",
            stream: true,
            state: {},
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