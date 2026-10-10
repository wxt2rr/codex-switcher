import type { GatewayProtocol, JsonObject } from "../protocol.js";
import { planConversion } from "./formats.js";
import { decodeResponseEvents, type ConversionResponseEvent } from "./response-converter.js";
import { encodeUsage, mergeUsage, type ConversionUsage } from "./usage.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";

export interface ResponseStreamState {
  readonly id: string;
  readonly source: GatewayProtocol;
  readonly target: GatewayProtocol;
  readonly metadata: ConversionMetadata;
  readonly options: ConversionOptions;
  started: boolean;
  ended: boolean;
  sequenceNumber: number;
  toolCallAliases: Map<string, string>;
  nextToolCallIndex: number;
  anthropicOpenBlock?: { type: "text" | "thinking" | "tool_use"; index: number };
  anthropicNextBlockIndex: number;
  anthropicToolBlockIndexes: Map<string, number>;
  usage: ConversionUsage;
  events: ConversionResponseEvent[];
}

export function createResponseStreamState(
  source: GatewayProtocol,
  target: GatewayProtocol,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): ResponseStreamState {
  return {
    id: metadata.requestId ?? `${source}-${target}-stream`,
    source,
    target,
    metadata: { ...metadata },
    options: { ...options },
    started: false,
    ended: false,
    sequenceNumber: 0,
    toolCallAliases: new Map(),
    nextToolCallIndex: 0,
    anthropicNextBlockIndex: 0,
    anthropicToolBlockIndexes: new Map(),
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    events: [],
  };
}

export async function convertStreamChunk(state: ResponseStreamState, body: JsonObject): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) throw new Error(`Response stream '${state.id}' is already finalized`);
  const decoded = decodeResponseEvents(state.source, body);
  const terminal = hasTerminalMarker(state.source, body);
  const events: ConversionResponseEvent[] = [];
  if (!state.started) {
    state.started = true;
    events.push({ type: "message_start", responseId: state.id, role: "assistant" });
  }
  for (const event of decoded) {
    if (event.type === "message_start") continue;
    if (event.type === "message_end" && !terminal) continue;
    const normalizedEvent = normalizeStreamEvent(state, event);
    events.push(normalizedEvent);
    state.events.push(normalizedEvent);
    if (normalizedEvent.type === "usage") state.usage = mergeUsage(state.usage, normalizedEvent.usage);
    if (normalizedEvent.type === "message_end" || normalizedEvent.type === "error") state.ended = true;
  }
  const path = planConversion(state.source, state.target);
  return {
    value: events.flatMap((event) => encodeStreamEvents(state.target, event, state)),
    from: state.source,
    to: state.target,
    converterId: path.steps.map((step) => step.id).join("/"),
    quality: path.quality,
    steps: path.steps,
    diagnostics: [],
    usage: encodeUsage(state.target, state.usage),
    stream: true,
  };
}

export async function finalizeResponseStream(state: ResponseStreamState, reason = "stop"): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) return emptyStreamResult(state);
  if (!state.started) state.started = true;
  state.ended = true;
  const event: ConversionResponseEvent = { type: "message_end", reason };
  state.events.push(event);
  const path = planConversion(state.source, state.target);
  return {
    value: encodeStreamEvents(state.target, event, state),
    from: state.source,
    to: state.target,
    converterId: path.steps.map((step) => step.id).join("/"),
    quality: path.quality,
    steps: path.steps,
    diagnostics: [],
    usage: encodeUsage(state.target, state.usage),
    stream: true,
  };
}

export async function failResponseStream(state: ResponseStreamState, code: string, message: string): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) return emptyStreamResult(state);
  state.ended = true;
  const event: ConversionResponseEvent = { type: "error", code, message, retryable: false };
  state.events.push(event);
  const path = planConversion(state.source, state.target);
  return {
    value: encodeStreamEvents(state.target, event, state),
    from: state.source,
    to: state.target,
    converterId: path.steps.map((step) => step.id).join("/"),
    quality: path.quality,
    steps: path.steps,
    diagnostics: [],
    usage: encodeUsage(state.target, state.usage),
    stream: true,
  };
}

function encodeStreamEvents(protocol: GatewayProtocol, event: ConversionResponseEvent, state: ResponseStreamState): JsonObject[] {
  const sequence = (): JsonObject => state.options.emitSequenceNumber ? { sequence_number: state.sequenceNumber++ } : {};
  if (event.type === "message_start") {
    if (protocol === "responses") return [json({ type: "response.created", response: { id: event.responseId, object: "response", status: "in_progress" }, ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: event.responseId, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [json({ type: "message_start", message: { id: event.responseId, type: "message", role: "assistant", content: [], ...(state.metadata.upstreamModelName ? { model: state.metadata.upstreamModelName } : {}) }, ...sequence() })];
    return [json({ responseId: event.responseId, candidates: [{ content: { role: "model", parts: [] } }], ...sequence() })];
  }
  if (event.type === "text_delta") {
    if (protocol === "responses") return [json({ type: "response.output_text.delta", delta: event.text, ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [...openAnthropicBlock(state, "text"), json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "text_delta", text: event.text }, ...sequence() })];
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ text: event.text }] } }], ...sequence() })];
  }
  if (event.type === "reasoning_delta") {
    if (protocol === "responses") return [json({ type: "response.reasoning_summary_text.delta", delta: event.text, ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [...openAnthropicBlock(state, "thinking"), json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "thinking_delta", thinking: event.text }, ...sequence() })];
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ text: event.text, thought: true }] } }], ...sequence() })];
  }
  if (event.type === "tool_call_delta") {
    if (protocol === "responses") return [json({ type: "response.function_call_arguments.delta", item_id: event.callId, call_id: event.callId, ...(event.name ? { name: event.name } : {}), delta: event.argumentsDelta ?? "", ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ id: event.callId, type: "function", function: { ...(event.name ? { name: event.name } : {}), arguments: event.argumentsDelta ?? "" } }] }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") {
      const index = state.anthropicToolBlockIndexes.get(event.callId) ?? state.anthropicNextBlockIndex;
      if (!state.anthropicToolBlockIndexes.has(event.callId)) {
        state.anthropicToolBlockIndexes.set(event.callId, index);
        state.anthropicNextBlockIndex = index + 1;
      }
      const opened = openAnthropicBlock(state, "tool_use", index, { id: event.callId, name: event.name ?? "tool" });
      return [...opened, json({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: event.argumentsDelta ?? "" }, ...sequence() })];
    }
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ functionCall: { name: event.name ?? "tool", args: parseObject(event.argumentsDelta) } }] } }], ...sequence() })];
  }
  if (event.type === "usage") {
    if (protocol === "responses") return [json({ type: "response.usage", usage: encodeUsage(protocol, event.usage), ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [], usage: encodeUsage(protocol, event.usage), ...sequence() })];
    if (protocol === "anthropic") return [json({ type: "message_delta", delta: {}, usage: encodeUsage(protocol, event.usage), ...sequence() })];
    return [json({ responseId: state.id, candidates: [], usageMetadata: encodeUsage(protocol, event.usage), ...sequence() })];
  }
  if (event.type === "error") {
    if (protocol === "responses") return [json({ type: "response.failed", response: { id: state.id, status: "failed", error: { code: event.code, message: event.message } }, ...sequence() })];
    return [json({ error: { code: event.code, message: event.message }, ...sequence() })];
  }
  if (protocol === "responses") return [json({ type: "response.completed", response: { id: state.id, status: "completed", usage: encodeUsage(protocol, state.usage) }, ...sequence() })];
  if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: event.reason ?? "stop" }], ...sequence() })];
  if (protocol === "anthropic") {
    const events: JsonObject[] = [];
    if (state.anthropicOpenBlock) events.push(json({ type: "content_block_stop", index: state.anthropicOpenBlock.index, ...sequence() }));
    state.anthropicOpenBlock = undefined;
    events.push(json({ type: "message_delta", delta: { stop_reason: event.reason ?? "end_turn" }, usage: encodeUsage(protocol, state.usage), ...sequence() }));
    events.push(json({ type: "message_stop", ...sequence() }));
    return events;
  }
  return [json({ responseId: state.id, candidates: [{ finishReason: event.reason ?? "STOP" }], usageMetadata: encodeUsage(protocol, state.usage), ...sequence() })];
}

function openAnthropicBlock(
  state: ResponseStreamState,
  type: "text" | "thinking" | "tool_use",
  requestedIndex?: number,
  tool?: { id: string; name: string },
): JsonObject[] {
  const index = requestedIndex ?? state.anthropicNextBlockIndex;
  if (state.anthropicOpenBlock?.type === type && state.anthropicOpenBlock.index === index) return [];
  const events: JsonObject[] = [];
  if (state.anthropicOpenBlock) events.push({ type: "content_block_stop", index: state.anthropicOpenBlock.index });
  state.anthropicOpenBlock = { type, index };
  state.anthropicNextBlockIndex = Math.max(state.anthropicNextBlockIndex, index + 1);
  const contentBlock: JsonObject = type === "text" ? { type: "text", text: "" } : type === "thinking" ? { type: "thinking", thinking: "" } : { type: "tool_use", id: tool?.id ?? "call", name: tool?.name ?? "tool", input: {} };
  events.push({ type: "content_block_start", index, content_block: contentBlock });
  return events;
}

function emptyStreamResult(state: ResponseStreamState): ConversionResult<JsonObject[]> {
  const path = planConversion(state.source, state.target);
  return { value: [], from: state.source, to: state.target, converterId: path.steps.map((step) => step.id).join("/"), quality: path.quality, steps: path.steps, diagnostics: [], usage: encodeUsage(state.target, state.usage), stream: true };
}

function hasTerminalMarker(protocol: GatewayProtocol, body: JsonObject): boolean {
  if (protocol === "chat_completions") return Array.isArray(body.choices) && Boolean(isObject(body.choices[0]) && body.choices[0].finish_reason !== null && body.choices[0].finish_reason !== undefined);
  if (protocol === "responses") return body.type === "response.completed" || body.type === "response.failed" || body.type === "response.incomplete"
    || body.status === "completed" || body.status === "failed" || body.status === "incomplete"
    || isObject(body.response) && (body.response.status === "completed" || body.response.status === "failed" || body.response.status === "incomplete");
  if (protocol === "anthropic") return body.stop_reason !== undefined || body.type === "message_stop"
    || body.type === "message_delta" && isObject(body.delta) && body.delta.stop_reason !== undefined;
  return Array.isArray(body.candidates) && Boolean(isObject(body.candidates[0]) && body.candidates[0].finishReason);
}

function normalizeStreamEvent(state: ResponseStreamState, event: ConversionResponseEvent): ConversionResponseEvent {
  if (event.type !== "tool_call_delta") return event;
  if (event.name && !event.argumentsDelta && !state.toolCallAliases.has(event.callId)) {
    state.toolCallAliases.set(String(state.nextToolCallIndex), event.callId);
    state.nextToolCallIndex += 1;
  }
  const alias = state.toolCallAliases.get(event.callId);
  return alias ? { ...event, callId: alias } : event;
}

function parseObject(value: string | undefined): JsonObject { try { const parsed: unknown = JSON.parse(value ?? "{}"); return isObject(parsed as JsonObject) ? parsed as JsonObject : {}; } catch { return {}; } }
function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function json(value: unknown): JsonObject { return value as JsonObject; }
