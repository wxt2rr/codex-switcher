import { CompatibilityError, type ChatToolCall } from "./types.js";

export interface StoredResponseHistory {
  responseId: string;
  createdAt: number;
  calls: ChatToolCall[];
  /** Complete Responses output items for lossless previous_response_id replay. */
  items?: Array<Record<string, unknown>>;
  /** Response metadata is kept separately so old snapshots remain readable. */
  metadata?: Record<string, unknown>;
  /** Provider usage is retained for diagnostics and lossless history inspection. */
  usage?: Record<string, unknown>;
  status?: string;
  incompleteReason?: string;
  incompleteDetails?: Record<string, unknown>;
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

const MAX_HISTORY_ITEM_BYTES = 512 * 1024;
const MAX_HISTORY_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_ITEMS_PER_RESPONSE = 512;

/** Prefer a conversation/thread scope when the client supplies one. */
export function resolveHistoryScope(routeId: string, request: Record<string, unknown>): string {
  const metadata = request.metadata && typeof request.metadata === "object" && !Array.isArray(request.metadata)
    ? request.metadata as Record<string, unknown>
    : undefined;
  const candidates = [request.conversation_id, request.conversationId, request.thread_id, request.threadId,
    metadata?.conversation_id, metadata?.conversationId, metadata?.thread_id, metadata?.threadId];
  const conversationId = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  return conversationId ? `${routeId}::conversation:${conversationId}` : routeId;
}

function cloneCall(call: ChatToolCall): ChatToolCall {
  return { ...call, function: { ...call.function } };
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
}

function safeItems(items: readonly Record<string, unknown>[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!items?.length) return undefined;
  let totalBytes = 0;
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (result.length >= MAX_HISTORY_ITEMS_PER_RESPONSE) break;
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.type !== "string") continue;
    // Opaque compaction/encrypted payloads are not a usable prompt and must
    // never be copied into a later request. Keep only an explicit readable
    // summary so history replay remains safe and deterministic.
    if (item.type === "compaction" || item.type === "compaction_summary") {
      const summary = typeof item.summary === "string" ? item.summary : typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
      if (!summary.trim()) continue;
      const compacted = { type: item.type, summary: summary.trim() };
      const bytes = Buffer.byteLength(JSON.stringify(compacted), "utf8");
      if (bytes > MAX_HISTORY_ITEM_BYTES || totalBytes + bytes > MAX_HISTORY_TOTAL_BYTES) continue;
      totalBytes += bytes;
      result.push(compacted);
      continue;
    }
    const cloned = cloneJson(item) as Record<string, unknown>;
    const bytes = Buffer.byteLength(JSON.stringify(cloned), "utf8");
    if (bytes > MAX_HISTORY_ITEM_BYTES || totalBytes + bytes > MAX_HISTORY_TOTAL_BYTES) continue;
    totalBytes += bytes;
    result.push(cloned);
  }
  return result.length ? result : undefined;
}

function hasValidArguments(call: ChatToolCall): boolean {
  if (!call.function.arguments.trim()) return false;
  if (call.kind === "custom") return true;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function safeCalls(calls: readonly ChatToolCall[]): ChatToolCall[] {
  return calls.filter((call) => typeof call.id === "string" && call.id.trim() && typeof call.function?.name === "string"
    && call.function.name.trim() && hasValidArguments(call)).map(cloneCall);
}

function cloneResponse(response: StoredResponseHistory): StoredResponseHistory {
  return {
    ...response,
    calls: safeCalls(response.calls),
    ...(safeItems(response.items) ? { items: safeItems(response.items) } : {}),
    ...(response.metadata ? { metadata: cloneJson(response.metadata) as Record<string, unknown> } : {}),
    ...(response.usage ? { usage: cloneJson(response.usage) as Record<string, unknown> } : {}),
    ...(response.incompleteDetails ? { incompleteDetails: cloneJson(response.incompleteDetails) as Record<string, unknown> } : {}),
  };
}

export class ConversationHistoryStore {
  private readonly routes = new Map<string, RouteHistory>();
  private readonly hydration = new Map<string, Promise<void>>();
  private readonly persistenceQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly options: { maxResponses?: number; ttlMs?: number; now?: () => number; persistence?: HistoryPersistence } = {},
  ) {}

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private maxResponses(): number { return this.options.maxResponses ?? 512; }
  // A persisted Codex conversation can be resumed long after the gateway
  // request that created it. Do not expire tool-call history by default; bound
  // storage by response count instead. Callers may still opt into a TTL for
  // ephemeral routes/tests.
  private ttlMs(): number | undefined { return this.options.ttlMs; }

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
    const pending = this.hydration.get(routeId);
    if (pending) return pending;
    const load = (async () => {
      const snapshot = await this.options.persistence!.load(routeId);
      // A persistence implementation is allowed to be backed by a shared
      // store. Never hydrate a snapshot that belongs to another route: doing
      // so would make a previous_response_id from one environment resolve to
      // a tool call from a different environment.
      if (snapshot && snapshot.routeId !== routeId) return;
      const route = this.route(routeId);
      for (const response of snapshot?.responses ?? []) {
        if (this.ttlMs() === undefined || this.now() - response.createdAt <= this.ttlMs()!) {
          route.responses.set(response.responseId, cloneResponse(response));
          route.order.push(response.responseId);
        }
      }
      this.prune(routeId);
    })();
    this.hydration.set(routeId, load);
    try {
      await load;
    } finally {
      if (this.hydration.get(routeId) === load) this.hydration.delete(routeId);
    }
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
    const route = this.route(routeId);
    const previousId = typeof request.previous_response_id === "string" ? request.previous_response_id : undefined;
    const previous = previousId ? route.responses.get(previousId) : undefined;
    // A Chat/Anthropic/Gemini upstream cannot resolve Responses'
    // `previous_response_id` itself.  Replay the complete saved output even
    // for an ordinary follow-up turn that contains no tool output.  The old
    // implementation only did this when a *_call_output was present, which
    // made a normal multi-turn conversation lose its assistant turn.
    if (previous?.items?.length) {
      const { previous_response_id: _ignored, ...rest } = request;
      const previousItemIds = new Set(previous.items.flatMap((item) => typeof item.id === "string" ? [item.id] : []));
      const currentInput = input.filter((item) => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : undefined;
        return !(value && typeof value.id === "string" && previousItemIds.has(value.id));
      });
      const restoredCount = previous.calls.filter((call) => outputIds.includes(call.id)).length;
      return { request: { ...rest, input: [...previous.items.map((item) => cloneJson(item)), ...currentInput] }, restoredCount };
    }
    // No complete item snapshot is available (old persisted data or an
    // interrupted response).  Continue with the call-id repair path below.
    if (!outputIds.length) {
      if (previousId) {
        const { previous_response_id: _ignored, ...rest } = request;
        return { request: rest, restoredCount: 0 };
      }
      return { request: { ...request }, restoredCount: 0 };
    }
    const restored: ChatToolCall[] = [];
    for (const callId of outputIds) {
      const fromPrevious = previous?.calls.find((call) => call.id === callId);
      if (fromPrevious) { restored.push(cloneCall(fromPrevious)); continue; }
      const candidates = [...route.responses.values()].flatMap((response) => response.calls.filter((call) => call.id === callId));
      if (candidates.length === 1) restored.push(cloneCall(candidates[0]));
      else if (candidates.length > 1) throw new CompatibilityError("INVALID_REQUEST", `Ambiguous tool call '${callId}' in conversation history`);
    }
    const { previous_response_id: _ignored, ...rest } = request;
    const restoredById = new Map(restored.map((call) => [call.id, call]));
    const callOrder = new Map((previous?.calls ?? restored).map((call, index) => [call.id, index]));
    const enrichedInput: unknown[] = [];
    for (let index = 0; index < input.length;) {
      const value = input[index];
      const item = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
      const isOutput = Boolean(item && /_call_output$/.test(String(item.type)) && typeof item.call_id === "string");
      if (!isOutput) {
        enrichedInput.push(value);
        index += 1;
        continue;
      }
      // A run of tool outputs is one Chat tool turn. Insert every recoverable
      // assistant call immediately before that run, preserving call order.
      const run: unknown[] = [];
      while (index < input.length) {
        const candidate = input[index];
        const candidateRecord = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : undefined;
        if (!candidateRecord || !/_call_output$/.test(String(candidateRecord.type)) || typeof candidateRecord.call_id !== "string") break;
        run.push(candidate);
        index += 1;
      }
      const runIds = run.flatMap((candidate) => {
        const candidateRecord = candidate as Record<string, unknown>;
        const call = restoredById.get(String(candidateRecord.call_id));
        return call ? [call] : [];
      }).sort((left, right) => (callOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (callOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
      for (const call of runIds) enrichedInput.push(restoredCallToResponses(call));
      enrichedInput.push(...run);
    }
    return { request: { ...rest, input: enrichedInput }, restoredCount: restored.length };
  }

  invalidateRoute(routeId: string): void {
    this.routes.delete(routeId);
    this.hydration.delete(routeId);
    this.persistenceQueues.delete(routeId);
    void this.options.persistence?.delete(routeId);
  }

  prune(routeId?: string): void {
    const routeIds = routeId ? [routeId] : [...this.routes.keys()];
    for (const id of routeIds) {
      const route = this.routes.get(id);
      if (!route) continue;
      const cutoff = this.ttlMs() === undefined ? undefined : this.now() - this.ttlMs()!;
      route.order = route.order.filter((responseId) => {
        const keep = cutoff === undefined || (route.responses.get(responseId)?.createdAt ?? 0) >= cutoff;
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
    if (!this.options.persistence) return;
    const previous = this.persistenceQueues.get(routeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.options.persistence!.save(this.snapshot(routeId)));
    this.persistenceQueues.set(routeId, next);
    try {
      await next;
    } finally {
      if (this.persistenceQueues.get(routeId) === next) this.persistenceQueues.delete(routeId);
    }
  }
}

function restoredCallToResponses(call: ChatToolCall): Record<string, unknown> {
  const location = { ...(call.itemId ? { id: call.itemId } : {}), ...(call.outputIndex !== undefined ? { output_index: call.outputIndex } : {}) };
  const signature = call.signature ? { thought_signature: call.signature } : {};
  if (call.kind === "custom") return { type: "custom_tool_call", ...location, call_id: call.id, name: call.function.name, input: call.function.arguments, ...signature };
  if (call.kind === "hosted" && call.raw) return { ...call.raw, ...location, call_id: call.id };
  return { type: "function_call", ...location, call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...signature };
}
