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
  /** Output item bookkeeping used when emitting a native Responses stream. */
  responseCreatedAt: number;
  responseOutputIndex: number;
  responseTextState?: { itemId: string; outputIndex: number; text: string; announced: boolean };
  responseReasoningState?: { itemId: string; outputIndex: number; text: string; announced: boolean };
  responseToolStates: Map<string, { callId: string; itemId: string; outputIndex?: number; name?: string; arguments: string; announced: boolean }>;
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
    responseCreatedAt: Math.floor(Date.now() / 1000),
    responseOutputIndex: 0,
    responseToolStates: new Map(),
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
    if (protocol === "responses") {
      const model = state.metadata.upstreamModelName ?? state.metadata.originModelName;
      const response = { id: event.responseId, object: "response", created_at: state.responseCreatedAt, status: "in_progress", ...(model ? { model } : {}), output: [], error: null, incomplete_details: null };
      return [
        json({ type: "response.created", response, ...sequence() }),
        json({ type: "response.in_progress", response, ...sequence() }),
      ];
    }
    if (protocol === "chat_completions") return [json({ id: event.responseId, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [json({ type: "message_start", message: { id: event.responseId, type: "message", role: "assistant", content: [], ...(state.metadata.upstreamModelName ? { model: state.metadata.upstreamModelName } : {}) }, ...sequence() })];
    return [json({ responseId: event.responseId, candidates: [{ content: { role: "model", parts: [] } }], ...sequence() })];
  }
  if (event.type === "text_delta") {
    if (protocol === "responses") {
      if (!event.text) return [];
      const output = ensureResponseTextState(state);
      output.text += event.text;
      return [
        ...announceResponseText(output, state, sequence),
        json({ type: "response.output_text.delta", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, content_index: 0, delta: event.text, ...sequence() }),
      ];
    }
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [...openAnthropicBlock(state, "text"), json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "text_delta", text: event.text }, ...sequence() })];
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ text: event.text }] } }], ...sequence() })];
  }
  if (event.type === "reasoning_delta") {
    if (protocol === "responses") {
      if (!event.text) return [];
      const output = ensureResponseReasoningState(state);
      output.text += event.text;
      return [
        ...announceResponseReasoning(output, state, sequence),
        json({ type: "response.reasoning_summary_text.delta", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, summary_index: 0, delta: event.text, ...sequence() }),
      ];
    }
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [...openAnthropicBlock(state, "thinking"), json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "thinking_delta", thinking: event.text }, ...sequence() })];
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ text: event.text, thought: true }] } }], ...sequence() })];
  }
  if (event.type === "tool_call_delta") {
    if (protocol === "responses") {
      const tool = state.responseToolStates.get(event.callId) ?? {
        callId: event.callId,
        itemId: `fc_${state.id}_${state.responseToolStates.size}`,
        arguments: "",
        announced: false,
      };
      tool.name ??= event.name;
      tool.arguments += event.argumentsDelta ?? "";
      state.responseToolStates.set(event.callId, tool);
      const events: JsonObject[] = [];
      if (!tool.announced && tool.name) {
        tool.announced = true;
        tool.outputIndex = state.responseOutputIndex++;
        events.push(json({ type: "response.output_item.added", response_id: state.id, output_index: tool.outputIndex, item: {
          id: tool.itemId, type: "function_call", status: "in_progress", arguments: "", call_id: tool.callId, name: tool.name,
        }, ...sequence() }));
      }
      if (tool.announced) events.push(json({ type: "response.function_call_arguments.delta", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, call_id: tool.callId, ...(tool.name ? { name: tool.name } : {}), delta: event.argumentsDelta ?? "", ...sequence() }));
      return events;
    }
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
  if (protocol === "responses") return finishResponsesStream(state, event.reason, sequence);
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

function ensureResponseTextState(state: ResponseStreamState): NonNullable<ResponseStreamState["responseTextState"]> {
  if (!state.responseTextState) state.responseTextState = { itemId: `msg_${state.id}`, outputIndex: state.responseOutputIndex++, text: "", announced: false };
  return state.responseTextState;
}

function ensureResponseReasoningState(state: ResponseStreamState): NonNullable<ResponseStreamState["responseReasoningState"]> {
  if (!state.responseReasoningState) state.responseReasoningState = { itemId: `rs_${state.id}`, outputIndex: state.responseOutputIndex++, text: "", announced: false };
  return state.responseReasoningState;
}

function announceResponseText(
  output: NonNullable<ResponseStreamState["responseTextState"]>,
  state: ResponseStreamState,
  sequence: () => JsonObject,
): JsonObject[] {
  if (output.announced) return [];
  output.announced = true;
  return [
    json({ type: "response.output_item.added", response_id: state.id, output_index: output.outputIndex, item: {
      id: output.itemId, type: "message", status: "in_progress", role: "assistant", content: [],
    }, ...sequence() }),
    json({ type: "response.content_part.added", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, content_index: 0, part: {
      type: "output_text", text: "", annotations: [],
    }, ...sequence() }),
  ];
}

function announceResponseReasoning(
  output: NonNullable<ResponseStreamState["responseReasoningState"]>,
  state: ResponseStreamState,
  sequence: () => JsonObject,
): JsonObject[] {
  if (output.announced) return [];
  output.announced = true;
  return [
    json({ type: "response.output_item.added", response_id: state.id, output_index: output.outputIndex, item: {
      id: output.itemId, type: "reasoning", summary: [],
    }, ...sequence() }),
    json({ type: "response.reasoning_summary_part.added", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, summary_index: 0, part: {
      type: "summary_text", text: "",
    }, ...sequence() }),
  ];
}

function finishResponsesStream(state: ResponseStreamState, reason: string | undefined, sequence: () => JsonObject): JsonObject[] {
  const events: JsonObject[] = [];
  const output: JsonObject[] = [];
  const model = state.metadata.upstreamModelName ?? state.metadata.originModelName;
  if (state.responseReasoningState) {
    const reasoning = state.responseReasoningState;
    const item = { id: reasoning.itemId, type: "reasoning", summary: [{ type: "summary_text", text: reasoning.text }] };
    output.push({ ...item, output_index: reasoning.outputIndex });
    events.push(
      json({ type: "response.reasoning_summary_text.done", response_id: state.id, item_id: reasoning.itemId, output_index: reasoning.outputIndex, summary_index: 0, text: reasoning.text, ...sequence() }),
      json({ type: "response.output_item.done", response_id: state.id, output_index: reasoning.outputIndex, item, ...sequence() }),
    );
  }
  if (state.responseTextState) {
    const text = state.responseTextState;
    const item = { id: text.itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: text.text, annotations: [] }] };
    output.push({ ...item, output_index: text.outputIndex });
    events.push(
      json({ type: "response.output_text.done", response_id: state.id, item_id: text.itemId, output_index: text.outputIndex, content_index: 0, text: text.text, ...sequence() }),
      json({ type: "response.content_part.done", response_id: state.id, item_id: text.itemId, output_index: text.outputIndex, content_index: 0, part: item.content[0], ...sequence() }),
      json({ type: "response.output_item.done", response_id: state.id, output_index: text.outputIndex, item, ...sequence() }),
    );
  }
  for (const tool of [...state.responseToolStates.values()].filter((candidate) => candidate.announced).sort((left, right) => (left.outputIndex ?? 0) - (right.outputIndex ?? 0))) {
    const item = { id: tool.itemId, type: "function_call", status: "completed", arguments: tool.arguments, call_id: tool.callId, name: tool.name ?? "tool" };
    output.push({ ...item, output_index: tool.outputIndex ?? 0 });
    events.push(
      json({ type: "response.function_call_arguments.done", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, arguments: tool.arguments, ...sequence() }),
      json({ type: "response.output_item.done", response_id: state.id, output_index: tool.outputIndex, item, ...sequence() }),
    );
  }
  output.sort((left, right) => Number(left.output_index ?? 0) - Number(right.output_index ?? 0));
  const incomplete = reason === "length" || reason === "max_tokens" || reason === "max_output_tokens" || reason === "incomplete";
  const response: JsonObject = { id: state.id, object: "response", created_at: state.responseCreatedAt, status: incomplete ? "incomplete" : "completed", ...(model ? { model } : {}), output: output.map(({ output_index: _index, ...item }) => item), error: null, incomplete_details: incomplete ? { reason: reason ?? "incomplete" } : null, usage: encodeUsage("responses", state.usage) };
  events.push(json({ type: incomplete ? "response.incomplete" : "response.completed", response, ...sequence() }));
  return events;
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
