import { CompatibilityError, type ChatToolCall } from "./types.js";

export interface StoredResponseHistory {
  responseId: string;
  createdAt: number;
  calls: ChatToolCall[];
}

export interface RouteHistorySnapshot {
  routeId: string;
  responses: StoredResponseHistory[];
}

export interface HistoryPersistence {
  load(routeId: string): Promise<RouteHistorySnapshot | undefined>;
  save(snapshot: RouteHistorySnapshot): Promise<void>;
  delete(routeId: string): Promise<void>;
}

interface RouteHistory {
  responses: Map<string, StoredResponseHistory>;
  order: string[];
}

function cloneCall(call: ChatToolCall): ChatToolCall {
  return { ...call, function: { ...call.function } };
}

function cloneResponse(response: StoredResponseHistory): StoredResponseHistory {
  return { ...response, calls: response.calls.map(cloneCall) };
}

export class ConversationHistoryStore {
  private readonly routes = new Map<string, RouteHistory>();

  constructor(
    private readonly options: { maxResponses?: number; ttlMs?: number; now?: () => number; persistence?: HistoryPersistence } = {},
  ) {}

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private maxResponses(): number { return this.options.maxResponses ?? 512; }
  private ttlMs(): number { return this.options.ttlMs ?? 15 * 60 * 1000; }

  private route(routeId: string): RouteHistory {
    let route = this.routes.get(routeId);
    if (!route) {
      route = { responses: new Map(), order: [] };
      this.routes.set(routeId, route);
    }
    return route;
  }

  async hydrate(routeId: string): Promise<void> {
    if (!this.options.persistence || this.routes.has(routeId)) return;
    const snapshot = await this.options.persistence.load(routeId);
    const route = this.route(routeId);
    for (const response of snapshot?.responses ?? []) {
      if (this.now() - response.createdAt <= this.ttlMs()) {
        route.responses.set(response.responseId, cloneResponse(response));
        route.order.push(response.responseId);
      }
    }
    this.prune(routeId);
  }

  async recordResponse(routeId: string, response: StoredResponseHistory): Promise<void> {
    if (!routeId || !response.responseId) throw new CompatibilityError("INVALID_REQUEST", "History route and response IDs are required");
    const route = this.route(routeId);
    route.responses.set(response.responseId, cloneResponse(response));
    route.order = route.order.filter((id) => id !== response.responseId);
    route.order.push(response.responseId);
    this.prune(routeId);
    await this.persist(routeId);
  }

  async recordFunctionCall(routeId: string, responseId: string, call: ChatToolCall): Promise<void> {
    const route = this.route(routeId);
    const existing = route.responses.get(responseId) ?? { responseId, createdAt: this.now(), calls: [] };
    existing.calls = [...existing.calls.filter((item) => item.id !== call.id), cloneCall(call)];
    await this.recordResponse(routeId, existing);
  }

  async enrichRequest(routeId: string, request: Record<string, unknown>): Promise<{ request: Record<string, unknown>; restoredCount: number }> {
    await this.hydrate(routeId);
    this.prune(routeId);
    const input = Array.isArray(request.input) ? request.input : [];
    const outputIds = input.flatMap((item) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : null;
      return value && /_call_output$/.test(String(value.type)) && typeof value.call_id === "string" ? [value.call_id] : [];
    });
    if (!outputIds.length) return { request: { ...request }, restoredCount: 0 };

    const route = this.route(routeId);
    const previousId = typeof request.previous_response_id === "string" ? request.previous_response_id : undefined;
    const previous = previousId ? route.responses.get(previousId) : undefined;
    const restored: ChatToolCall[] = [];
    for (const callId of outputIds) {
      const fromPrevious = previous?.calls.find((call) => call.id === callId);
      if (fromPrevious) { restored.push(cloneCall(fromPrevious)); continue; }
      const candidates = [...route.responses.values()].flatMap((response) => response.calls.filter((call) => call.id === callId));
      if (candidates.length === 1) restored.push(cloneCall(candidates[0]));
      else if (candidates.length > 1) throw new CompatibilityError("INVALID_REQUEST", `Ambiguous tool call '${callId}' in conversation history`);
    }
    const callItems = restored.map((call) => ({
      type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments,
    }));
    const { previous_response_id: _ignored, ...rest } = request;
    return { request: { ...rest, input: [...callItems, ...input] }, restoredCount: restored.length };
  }

  invalidateRoute(routeId: string): void {
    this.routes.delete(routeId);
    void this.options.persistence?.delete(routeId);
  }

  prune(routeId?: string): void {
    const routeIds = routeId ? [routeId] : [...this.routes.keys()];
    for (const id of routeIds) {
      const route = this.routes.get(id);
      if (!route) continue;
      const cutoff = this.now() - this.ttlMs();
      route.order = route.order.filter((responseId) => {
        const keep = (route.responses.get(responseId)?.createdAt ?? 0) >= cutoff;
        if (!keep) route.responses.delete(responseId);
        return keep;
      });
      while (route.order.length > this.maxResponses()) {
        const oldest = route.order.shift();
        if (oldest) route.responses.delete(oldest);
      }
    }
  }

  snapshot(routeId: string): RouteHistorySnapshot {
    this.prune(routeId);
    const route = this.route(routeId);
    return { routeId, responses: route.order.flatMap((id) => {
      const response = route.responses.get(id);
      return response ? [cloneResponse(response)] : [];
    }) };
  }

  private async persist(routeId: string): Promise<void> {
    await this.options.persistence?.save(this.snapshot(routeId));
  }
}
