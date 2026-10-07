import { createHash } from "node:crypto";
export class RouteResolveError extends Error {
    code;
    traces;
    constructor(code, message, traces = []) {
        super(message);
        this.code = code;
        this.traces = traces;
    }
}
export const MAX_ROUTE_GROUP_DEPTH = 8;
export function resolveRoute(candidates, groups, input) {
    const traces = [];
    const now = input.now ?? input.ruleContext?.now ?? Date.now();
    const state = {
        cursors: { ...(input.state?.cursors ?? {}) },
        affinity: { ...(input.state?.affinity ?? {}) },
    };
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const rule = selectRouteRule(input.rules, {
        ...(input.ruleContext ?? {}),
        ...(input.requestedModel !== undefined ? { requestedModel: input.requestedModel } : {}),
        now,
    });
    const routedModel = rule?.targetModelId ?? input.requestedModel;
    if (rule)
        traces.push({ stage: "model", outcome: "accepted", reason: `matched explicit route rule '${rule.id}'` });
    const requestedGroup = routedModel ? Object.values(groups).find((group) => group.exposedModelId === routedModel || group.id === routedModel) : undefined;
    const candidateIds = requestedGroup
        ? flattenGroup(requestedGroup.id, groups, new Set(), 0, traces)
        : candidates.map((candidate) => candidate.id);
    if (requestedGroup)
        traces.push({ stage: "model", outcome: "accepted", reason: `matched route group '${requestedGroup.id}'` });
    else if (routedModel)
        traces.push({ stage: "model", outcome: "accepted", reason: `matching physical model '${routedModel}'` });
    const pool = candidateIds.map((id) => byId.get(id)).filter((candidate) => Boolean(candidate));
    const modelPool = routedModel && !requestedGroup ? pool.filter((candidate) => candidate.modelId === routedModel) : pool;
    if (!modelPool.length)
        throw new RouteResolveError("MODEL_NOT_FOUND", `No route matches model '${routedModel ?? "default"}'`, traces);
    const protocolPool = modelPool.filter((candidate) => input.allowProtocolConversion || candidate.protocol === input.protocol);
    if (!protocolPool.length)
        throw new RouteResolveError("NO_ROUTE", `No route supports protocol '${input.protocol}'`, traces);
    const capabilityPool = protocolPool.filter((candidate) => capabilitiesMatch(candidate.capabilities, input.requiredCapabilities) && (!requestedGroup || capabilitiesMatch(requestedGroup.capabilities, input.requiredCapabilities)));
    if (!capabilityPool.length)
        throw new RouteResolveError("CAPABILITY_NOT_SUPPORTED", "No route supports the requested capabilities", traces);
    traces.push(...capabilityPool.map((candidate) => ({ stage: "capability", candidateId: candidate.id, outcome: "accepted", reason: "protocol and capability match" })));
    const eligible = capabilityPool.filter((candidate) => candidate.healthy && (candidate.cooldownUntil ?? 0) <= now);
    const poolForSelection = eligible.length ? eligible : capabilityPool;
    if (!eligible.length)
        traces.push({ stage: "health", outcome: "failed", reason: "all matching routes are unhealthy; using degraded fallback" });
    const affinityKey = input.turnKey && requestedGroup?.affinity !== "off" ? `turn:${input.turnKey}` : input.sessionKey && requestedGroup?.affinity !== "off" ? `session:${input.sessionKey}` : undefined;
    if (affinityKey && requestedGroup?.affinity !== "off") {
        const binding = state.affinity[`${requestedGroup?.id ?? "default"}:${affinityKey}`];
        const bound = binding && binding.expiresAt > now ? poolForSelection.find((candidate) => candidate.id === binding.routeId) : undefined;
        if (bound) {
            traces.push({ stage: "strategy", candidateId: bound.id, outcome: "selected", reason: "affinity binding" });
            const group = requestedGroup ?? defaultGroup(routedModel ?? "default", poolForSelection);
            return result(bound, requestedGroup?.id, state, traces, affinityKey, selectionOrder(poolForSelection, group, state, input.sessionKey ?? input.turnKey ?? "anonymous", now), now);
        }
    }
    const group = requestedGroup ?? defaultGroup(routedModel ?? "default", poolForSelection);
    const selected = selectByStrategy(poolForSelection, group, state, input.sessionKey ?? input.turnKey ?? "anonymous", now);
    if (!selected)
        throw new RouteResolveError("NO_ROUTE", "No eligible route", traces);
    traces.push({ stage: "strategy", candidateId: selected.id, outcome: "selected", reason: group.strategy });
    if (affinityKey && group.affinity !== "off")
        state.affinity[`${group.id}:${affinityKey}`] = { routeId: selected.id, expiresAt: now + (group.affinity === "turn" ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000) };
    return result(selected, group.id, state, traces, affinityKey, group.fallbackEnabled ? selectionOrder(poolForSelection, group, state, input.sessionKey ?? input.turnKey ?? "anonymous", now) : [selected], now);
}
function flattenGroup(id, groups, visiting, depth, traces) {
    if (depth >= MAX_ROUTE_GROUP_DEPTH)
        throw new RouteResolveError("MAX_DEPTH", `Route group nesting exceeds ${MAX_ROUTE_GROUP_DEPTH}`, traces);
    if (visiting.has(id))
        throw new RouteResolveError("CYCLE", `Route group cycle detected at '${id}'`, traces);
    const group = groups[id];
    if (!group)
        return [];
    const nextVisiting = new Set(visiting).add(id);
    const result = [];
    for (const member of group.members) {
        const nestedId = groups[member] ? member : member.startsWith("group/") ? member.slice("group/".length) : undefined;
        if (nestedId && groups[nestedId])
            result.push(...flattenGroup(nestedId, groups, nextVisiting, depth + 1, traces));
        else
            result.push(member);
    }
    return [...new Set(result)];
}
function selectByStrategy(candidates, group, state, key, now) {
    if (!candidates.length)
        return undefined;
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    if (group.strategy === "order")
        return sorted[0];
    if (group.strategy === "rotate") {
        const index = state.cursors[group.id] ?? 0;
        state.cursors[group.id] = index + 1;
        return sorted[index % sorted.length];
    }
    if (group.strategy === "usage")
        return [...sorted].sort((a, b) => (a.requestsInWindow ?? 0) - (b.requestsInWindow ?? 0) || a.priority - b.priority)[0];
    if (group.strategy === "pace")
        return [...sorted].sort((a, b) => paceScore(a, now) - paceScore(b, now))[0];
    if (isWeightedStrategy(group.strategy)) {
        const total = sorted.reduce((sum, candidate) => sum + Math.max(1, group.weights?.[candidate.id] ?? candidate.weight), 0);
        let cursor = stableHash(key) % total;
        for (const candidate of sorted) {
            cursor -= Math.max(1, group.weights?.[candidate.id] ?? candidate.weight);
            if (cursor < 0)
                return candidate;
        }
    }
    return [...sorted].sort((a, b) => smartScore(b) - smartScore(a))[0];
}
function selectionOrder(candidates, group, state, key, now) {
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    if (group.strategy === "order")
        return sorted;
    if (group.strategy === "rotate") {
        const index = (state.cursors[group.id] ?? 0) % sorted.length;
        return [...sorted.slice(index), ...sorted.slice(0, index)];
    }
    if (group.strategy === "usage")
        return [...sorted].sort((a, b) => (a.requestsInWindow ?? 0) - (b.requestsInWindow ?? 0) || a.priority - b.priority);
    if (group.strategy === "pace")
        return [...sorted].sort((a, b) => paceScore(a, now) - paceScore(b, now));
    if (isWeightedStrategy(group.strategy)) {
        const total = sorted.reduce((sum, candidate) => sum + Math.max(1, group.weights?.[candidate.id] ?? candidate.weight), 0);
        const cursor = stableHash(key) % total;
        const selected = selectByWeightedCursor(sorted, group, cursor);
        return selected ? [selected, ...sorted.filter((candidate) => candidate.id !== selected.id)] : sorted;
    }
    return [...sorted].sort((a, b) => smartScore(b) - smartScore(a));
}
function selectByWeightedCursor(sorted, group, cursor) {
    let remaining = cursor;
    for (const candidate of sorted) {
        remaining -= Math.max(1, group.weights?.[candidate.id] ?? candidate.weight);
        if (remaining < 0)
            return candidate;
    }
    return sorted[0];
}
function paceScore(candidate, now) {
    if (candidate.quotaRemaining === undefined) {
        return (candidate.requestsInWindow ?? 0) + (candidate.tokensInWindow ?? 0) / 1000 + (candidate.latencyMs ?? 0) / 1000;
    }
    const remaining = candidate.quotaRemaining;
    const untilReset = Math.max(1, (candidate.resetAt ?? now + 60 * 60 * 1000) - now);
    return remaining / untilReset;
}
function isWeightedStrategy(strategy) {
    return strategy === "weight" || strategy === "weighted_round_robin";
}
function smartScore(candidate) {
    return (candidate.quotaRemaining ?? 1) * 10 + Math.max(1, candidate.weight) * 2 - (candidate.requestsInWindow ?? 0) - (candidate.latencyMs ?? 0) / 1000 - candidate.priority;
}
function capabilitiesMatch(available, required) {
    if (!required)
        return true;
    if (!available)
        return true;
    if (!Array.isArray(available)) {
        const flags = available;
        return Object.entries(required).every(([key, value]) => !value || flags[key] === true);
    }
    return Object.entries(required).every(([key, value]) => !value || available.includes(key));
}
function selectRouteRule(rules, context) {
    return [...(rules ?? [])]
        .filter((rule) => {
        if (!rule.enabled || !routeRuleMatches(rule.match, context))
            return false;
        // An explicit model is authoritative unless the rule explicitly names
        // that model. This keeps metadata routing deterministic without turning
        // broad rules overriding an explicitly selected model.
        if (context.requestedModel !== undefined) {
            return Boolean(rule.match.modelIds?.includes(context.requestedModel));
        }
        return true;
    })
        .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0];
}
function routeRuleMatches(match, context) {
    if (match.tokenCount) {
        if (context.tokenCount === undefined)
            return false;
        if (match.tokenCount.min !== undefined && context.tokenCount < match.tokenCount.min)
            return false;
        if (match.tokenCount.max !== undefined && context.tokenCount > match.tokenCount.max)
            return false;
    }
    if (match.hasImages !== undefined && context.hasImages !== match.hasImages)
        return false;
    if (match.reasoning !== undefined && context.reasoning !== match.reasoning)
        return false;
    if (match.reasoningProfiles?.length && (!context.reasoningProfile || !match.reasoningProfiles.includes(context.reasoningProfile)))
        return false;
    if (match.agentIds?.length && (!context.agentId || !match.agentIds.includes(context.agentId)))
        return false;
    if (match.contextCompacted !== undefined && context.contextCompacted !== match.contextCompacted)
        return false;
    if (match.modelIds?.length && (!context.requestedModel || !match.modelIds.includes(context.requestedModel)))
        return false;
    if (match.providerIds?.length && (!context.providerId || !match.providerIds.includes(context.providerId)))
        return false;
    if (match.time && !routeRuleTimeMatches(match.time, context.now ?? Date.now()))
        return false;
    return true;
}
function routeRuleTimeMatches(match, timestamp) {
    const date = new Date(timestamp);
    const hour = match.timezone === "utc" ? date.getUTCHours() : date.getHours();
    const day = match.timezone === "utc" ? date.getUTCDay() : date.getDay();
    if (match.daysOfWeek?.length && !match.daysOfWeek.includes(day))
        return false;
    if (match.startHour === match.endHour)
        return true;
    return match.startHour < match.endHour
        ? hour >= match.startHour && hour < match.endHour
        : hour >= match.startHour || hour < match.endHour;
}
function defaultGroup(id, candidates) { return { id: `implicit:${id}`, displayName: id, exposedModelId: id, members: candidates.map((candidate) => candidate.id), strategy: "smart", affinity: "auto", fallbackEnabled: true, priority: 0 }; }
function stableHash(value) { return createHash("sha256").update(value).digest().readUInt32BE(0); }
function result(candidate, groupId, state, traces, sessionBindingKey, ordered, _now) {
    const logicalModelId = groupId ?? candidate.modelId;
    const route = toResolvedRoute(candidate, logicalModelId, sessionBindingKey, traces);
    const fallbackRoutes = ordered
        .filter((item) => item.id !== candidate.id)
        .map((item) => toResolvedRoute(item, logicalModelId, sessionBindingKey, [...traces, { stage: "fallback", candidateId: item.id, outcome: "accepted", reason: "eligible fallback before first byte" }]));
    return { route, fallbackRoutes, state, ...(groupId ? { groupId } : {}), traces };
}
function toResolvedRoute(candidate, logicalModelId, sessionBindingKey, decisionTrace) {
    return { logicalModelId, providerId: candidate.providerId, credentialId: candidate.credentialId, upstreamModelId: candidate.modelId, protocol: candidate.protocol, ...(sessionBindingKey ? { sessionBindingKey } : {}), decisionTrace };
}
export function classifyRouteFailure(status, error) {
    if (error instanceof Error && /timeout/i.test(error.message))
        return "timeout";
    if (status === 401 || status === 403)
        return "unauthorized";
    if (status === 408)
        return "timeout";
    if (status === 409 || status === 429)
        return status === 429 ? "rate_limit" : "quota";
    if (status !== null && status >= 500)
        return "upstream_5xx";
    if (status !== null && status >= 400)
        return "upstream_4xx";
    if (error instanceof Error && /stream/i.test(error.message))
        return "stream_interrupted";
    return "transport";
}
export function isRetryableRouteFailure(failure) { return ["transport", "timeout", "rate_limit", "quota", "upstream_5xx", "stream_interrupted"].includes(failure); }
//# sourceMappingURL=engine.js.map