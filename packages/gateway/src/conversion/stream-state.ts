import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { planConversion } from "./formats.js";
import { decodeResponseEvents, type ConversionResponseEvent } from "./response-converter.js";
import { encodeUsage, mergeUsage, type ConversionUsage } from "./usage.js";
import type { ConversionDiagnostic } from "./diagnostics.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";

interface ResponseToolState {
  callId: string;
  itemId: string;
  outputIndex?: number;
  name?: string;
  namespace?: string;
  kind?: "function" | "custom" | "tool_search" | "hosted";
  signature?: string;
  raw?: JsonObject;
  arguments: string;
  announced: boolean;
}

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
  responseTextState?: { itemId: string; outputIndex: number; text: string; announced: boolean; annotations?: JsonValue[]; refusal?: string };
  responseReasoningState?: { itemId: string; outputIndex: number; text: string; announced: boolean; signature?: string; encryptedContent?: string; summaryParts: Array<{ text: string; signature?: string }> };
  /** Responses can interleave multiple message/reasoning output items. Keep
   * each lifecycle independently instead of coalescing the whole response
   * into the first item (the legacy singular fields remain as first-item
   * compatibility aliases for callers that inspect stream state). */
  responseTextStates: Map<string, { itemId: string; outputIndex: number; text: string; announced: boolean; annotations?: JsonValue[]; refusal?: string }>;
  responseReasoningStates: Map<string, { itemId: string; outputIndex: number; text: string; announced: boolean; signature?: string; encryptedContent?: string; summaryParts: Array<{ text: string; signature?: string }> }>;
  responseMediaStates: Array<{ itemId: string; outputIndex: number; mediaType: "image" | "file"; media: JsonObject; announced: boolean; completed: boolean }>;
  responseToolStates: Map<string, ResponseToolState>;
  usage: ConversionUsage;
  events: ConversionResponseEvent[];
  responseMetadata?: JsonObject;
  responseStatus?: string;
  responseIncompleteReason?: string;
  responseIncompleteDetails?: JsonObject;
  warningEmitted: boolean;
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
    responseTextStates: new Map(),
    responseReasoningStates: new Map(),
    responseMediaStates: [],
    warningEmitted: false,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    events: [],
  };
}

export async function convertStreamChunk(state: ResponseStreamState, body: JsonObject): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) throw new Error(`Response stream '${state.id}' is already finalized`);
  let decoded = decodeResponseEvents(state.source, body, state.metadata);
  if (state.options.warning && !state.warningEmitted) {
    state.warningEmitted = true;
    decoded = [{ type: "text_delta", text: `${state.options.warning}\n\n` }, ...decoded];
  }
  // A native Responses stream sends text/reasoning deltas and then repeats the
  // complete item in `response.output_item.done`. The canonical stream state
  // already has the deltas; replaying the done payload would duplicate the
  // assistant answer. Keep the done item as a lifecycle marker and only decode
  // its content when no delta has been observed for that item.
  if (state.source === "responses" && body.type === "response.output_item.done" && isObject(body.item)) {
    const itemType = body.item.type;
    if (itemType === "message" && hasResponseTextItem(state, typeof body.item.id === "string" ? body.item.id : undefined, typeof body.output_index === "number" ? body.output_index : undefined)) decoded = decoded.filter((event) => event.type !== "text_delta");
    if (itemType === "message" && hasResponseMediaItem(state, typeof body.item.id === "string" ? body.item.id : undefined, typeof body.output_index === "number" ? body.output_index : undefined)) decoded = decoded.filter((event) => event.type !== "media");
    if (itemType === "reasoning" && hasResponseReasoningItem(state, typeof body.item.id === "string" ? body.item.id : undefined, typeof body.output_index === "number" ? body.output_index : undefined)) decoded = decoded.filter((event) => event.type !== "reasoning_delta");
    if (typeof itemType === "string" && itemType.endsWith("_call") && isObject(body.item)) {
      const callId = typeof body.item.call_id === "string" ? body.item.call_id : typeof body.item.id === "string" ? body.item.id : undefined;
      // `output_item.added` commonly announces a function call before its
      // arguments are available. Only suppress the terminal item when a
      // complete call was already observed; otherwise `.done` is the first
      // authoritative copy of the arguments and must be retained.
      if (callId && hasCompleteResponseTool(state, callId)) decoded = decoded.filter((event) => event.type !== "tool_call_delta");
    }
  }
  // Responses emits a full `*.done` event after its delta stream. The full
  // value is authoritative only when no delta was observed for that item;
  // otherwise forwarding it would duplicate the answer for Chat/Anthropic/
  // Gemini consumers.
  if (state.source === "responses" && body.type === "response.output_text.done" && (hasResponseTextItem(state, typeof body.item_id === "string" ? body.item_id : undefined, typeof body.output_index === "number" ? body.output_index : undefined) || hasSeenResponsesText(state, body))) {
    decoded = decoded.filter((event) => event.type !== "text_delta");
  }
  if (state.source === "responses" && body.type === "response.refusal.done" && hasSeenResponsesRefusal(state, body)) {
    decoded = decoded.filter((event) => event.type !== "text_delta");
  }
  if (state.source === "responses" && (body.type === "response.reasoning_summary_text.done" || body.type === "response.reasoning_summary.done" || body.type === "response.reasoning.done") && (hasResponseReasoningItem(state, typeof body.item_id === "string" ? body.item_id : undefined, typeof body.output_index === "number" ? body.output_index : undefined) || hasSeenResponsesReasoning(state, body))) {
    decoded = decoded.filter((event) => event.type !== "reasoning_delta");
  }
  // The terminal Responses envelope repeats the complete `output` array after
  // all item/delta events have already been delivered. Replaying that array
  // would duplicate text, reasoning, media and tool calls for every target
  // protocol. If we have observed any output item, the lifecycle events are
  // authoritative; only retain terminal metadata from the aggregate frame.
  if (state.source === "responses" && isResponsesTerminalEnvelope(body) && hasTrackedResponsesOutput(state)) {
    decoded = decoded.filter((event) => event.type === "message_start" || event.type === "message_end" || event.type === "usage" || event.type === "error");
  }
  const terminal = hasTerminalMarker(state.source, body);
  const events: ConversionResponseEvent[] = [];
  if (!state.started) {
    state.started = true;
    events.push({ type: "message_start", responseId: state.id, role: "assistant" });
  }
  for (const event of decoded) {
    if (event.type === "message_start") {
      if (event.createdAt !== undefined) state.responseCreatedAt = event.createdAt;
      state.responseStatus ??= event.status;
      state.responseMetadata ??= event.metadata;
      continue;
    }
    if (event.type === "message_end" && !terminal) continue;
    const normalizedEvent = normalizeStreamEvent(state, event);
    if (normalizedEvent.type === "message_end") {
      state.responseMetadata ??= normalizedEvent.metadata;
      state.responseStatus ??= normalizedEvent.status;
      state.responseIncompleteDetails ??= normalizedEvent.incompleteDetails;
    }
    if (normalizedEvent.type === "tool_call_delta") recordToolCallDelta(state, normalizedEvent);
    const terminalEvent = invalidToolCallEvent(state, normalizedEvent) ?? normalizedEvent;
    events.push(terminalEvent);
    state.events.push(terminalEvent);
    if (terminalEvent.type === "usage") state.usage = mergeUsage(state.usage, terminalEvent.usage);
    if (terminalEvent.type === "message_end") {
      state.responseIncompleteReason ??= terminalEvent.incompleteReason;
      state.responseStatus ??= terminalEvent.status ?? (terminalEvent.incompleteReason ? "incomplete" : undefined);
      state.ended = true;
    }
    if (terminalEvent.type === "error") state.ended = true;
  }
  const path = planConversion(state.source, state.target);
  const diagnostics = diagnoseStreamChunk(state.source, state.target, body, decoded);
  return {
    value: events.flatMap((event) => encodeStreamEvents(state.target, event, state)),
    from: state.source,
    to: state.target,
    converterId: path.steps.map((step) => step.id).join("/"),
    quality: path.quality,
    steps: path.steps,
    diagnostics,
    usage: encodeUsage(state.target, state.usage),
    stream: true,
  };
}

export async function finalizeResponseStream(state: ResponseStreamState, reason = "stop"): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) return emptyStreamResult(state);
  if (!state.started) state.started = true;
  state.ended = true;
  const event: ConversionResponseEvent = invalidToolCallEvent(state, { type: "message_end", reason })
    ?? { type: "message_end", reason };
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

export async function failResponseStream(
  state: ResponseStreamState,
  code: string,
  message: string,
  retryable = false,
  details?: JsonObject,
): Promise<ConversionResult<JsonObject[]>> {
  if (state.ended) return emptyStreamResult(state);
  state.ended = true;
  const event: ConversionResponseEvent = { type: "error", code, message, retryable, ...(details ? { details } : {}) };
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
      const response = { id: event.responseId, object: "response", created_at: state.responseCreatedAt, status: "in_progress", ...(model ? { model } : {}), ...(state.responseMetadata ? { metadata: state.responseMetadata } : {}), output: [], error: null, incomplete_details: null };
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
      if (!event.text && !event.annotations?.length && !event.refusal) return [];
      const output = ensureResponseTextState(state, event.itemId, event.outputIndex);
      output.text += event.text;
      const annotationStart = output.annotations?.length ?? 0;
      if (event.annotations?.length) output.annotations = [...(output.annotations ?? []), ...event.annotations];
      if (event.refusal) output.refusal = output.refusal ? `${output.refusal}${event.refusal}` : event.refusal;
      const annotationEvents = (event.annotations ?? []).map((annotation, index) => json({ type: "response.output_text.annotation.added", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, content_index: 0, annotation_index: event.annotationIndex !== undefined ? event.annotationIndex + index : annotationStart + index, annotation, ...sequence() }));
      const refusalEvents = event.refusal
        ? [json({ type: "response.refusal.delta", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, content_index: 0, delta: event.refusal, ...sequence() })]
        : [];
      const textEvents = event.text
        ? [json({ type: "response.output_text.delta", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, content_index: 0, delta: event.text, ...sequence() })]
        : [];
      return [
        ...announceResponseText(output, state, sequence),
        ...textEvents,
        ...refusalEvents,
        ...annotationEvents,
      ];
    }
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: event.text, ...(event.refusal ? { refusal: event.refusal } : {}), ...(event.annotations?.length ? { annotations: event.annotations } : {}) }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") return [...openAnthropicBlock(state, "text"), json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "text_delta", text: event.text }, ...sequence() })];
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ text: event.text }] } }], ...sequence() })];
  }
  if (event.type === "reasoning_delta") {
    if (protocol === "responses") {
      if (!event.text && !event.signature && !event.encryptedContent) return [];
      const output = ensureResponseReasoningState(state, event.itemId, event.outputIndex);
      output.text += event.text;
      output.signature ??= event.signature;
      output.encryptedContent ??= event.encryptedContent;
      const summaryIndex = event.summaryIndex ?? Math.max(0, output.summaryParts.length - 1);
      const summaryPart = output.summaryParts[summaryIndex] ?? { text: "" };
      summaryPart.text += event.text;
      summaryPart.signature ??= event.signature;
      output.summaryParts[summaryIndex] = summaryPart;
      const delta = event.text
        ? [json({ type: "response.reasoning_summary_text.delta", response_id: state.id, item_id: output.itemId, output_index: output.outputIndex, summary_index: summaryIndex, delta: event.text, ...(event.signature ? { signature: event.signature } : {}), ...sequence() })]
        : [];
      return [...announceResponseReasoning(output, state, sequence), ...delta];
    }
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { ...(event.text ? { reasoning_content: event.text } : {}), ...(event.signature ? { reasoning_signature: event.signature } : {}) }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") {
      if (event.encryptedContent) {
        const index = state.anthropicNextBlockIndex++;
        const events: JsonObject[] = [];
        if (state.anthropicOpenBlock) {
          events.push(json({ type: "content_block_stop", index: state.anthropicOpenBlock.index, ...sequence() }));
          state.anthropicOpenBlock = undefined;
        }
        events.push(json({ type: "content_block_start", index, content_block: { type: "redacted_thinking", data: event.encryptedContent }, ...sequence() }));
        events.push(json({ type: "content_block_stop", index, ...sequence() }));
        return events;
      }
      return [...openAnthropicBlock(state, "thinking"), ...(event.text
        ? [json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "thinking_delta", thinking: event.text }, ...sequence() })]
        : event.signature ? [json({ type: "content_block_delta", index: state.anthropicOpenBlock?.index ?? 0, delta: { type: "signature_delta", signature: event.signature }, ...sequence() })] : [])];
    }
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ ...(event.text ? { text: event.text } : {}), thought: true, ...(event.signature ? { thoughtSignature: event.signature } : {}) }] } }], ...sequence() })];
  }
  if (event.type === "media") {
    const media = ensureResponseMediaState(state, event.mediaType, event.media, event.itemId, event.outputIndex);
    if (protocol === "responses") {
      if (media.announced) return [];
      media.announced = true;
      media.completed = true;
      const item = { id: media.itemId, type: "message", status: "completed", role: "assistant", content: [{ ...media.media, type: media.mediaType === "image" ? "output_image" : "output_file" }] };
      const part = item.content[0];
      return [
        json({ type: "response.output_item.added", response_id: state.id, output_index: media.outputIndex, item, ...sequence() }),
        json({ type: "response.content_part.added", response_id: state.id, item_id: media.itemId, output_index: media.outputIndex, content_index: 0, part, ...sequence() }),
        json({ type: "response.content_part.done", response_id: state.id, item_id: media.itemId, output_index: media.outputIndex, content_index: 0, part, ...sequence() }),
        json({ type: "response.output_item.done", response_id: state.id, output_index: media.outputIndex, item, ...sequence() }),
      ];
    }
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: [{ type: media.mediaType === "image" ? "image_url" : "file", ...(media.mediaType === "image" ? { image_url: media.media.image_url ?? media.media.url ?? media.media } : { file: media.media }) }] }, finish_reason: null }], ...sequence() })];
    if (protocol === "anthropic") {
      const index = state.anthropicNextBlockIndex++;
      const events: JsonObject[] = [];
      if (state.anthropicOpenBlock) {
        events.push(json({ type: "content_block_stop", index: state.anthropicOpenBlock.index, ...sequence() }));
        state.anthropicOpenBlock = undefined;
      }
      events.push(json({ type: "content_block_start", index, content_block: { type: media.mediaType === "image" ? "image" : "document", source: media.media.source ?? media.media }, ...sequence() }));
      events.push(json({ type: "content_block_stop", index, ...sequence() }));
      return events;
    }
    return [json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ ...(media.mediaType === "image" ? { inlineData: media.media } : { fileData: media.media }) }] } }], ...sequence() })];
  }
  if (event.type === "tool_call_delta") {
    // Tool arguments are frequently split across SSE frames.  Buffer the
    // exchange until the terminal event so an empty/malformed upstream call
    // can never be exposed as a callable item to the downstream client.
    if (protocol === "responses") return emitResponseToolDelta(state, event, sequence);
    return [];
  }
  if (event.type === "tool_result") {
    if (protocol === "responses") {
      const type = event.kind === "custom" ? "custom_tool_call_output" : event.kind === "tool_search" && event.raw?.type === "tool_search_output" ? "tool_search_output" : event.kind === "tool_search" ? "tool_search_call_output" : "function_call_output";
      return [json({ ...(event.raw ?? {}), type, call_id: event.callId, output: event.output, ...(event.isError !== undefined ? { is_error: event.isError } : {}), ...sequence() })];
    }
    if (protocol === "anthropic") {
      const index = state.anthropicNextBlockIndex++;
      const events: JsonObject[] = [];
      if (state.anthropicOpenBlock) {
        events.push(json({ type: "content_block_stop", index: state.anthropicOpenBlock.index, ...sequence() }));
        state.anthropicOpenBlock = undefined;
      }
      events.push(json({ type: "content_block_start", index, content_block: { type: "tool_result", tool_use_id: event.callId, content: event.output, ...(event.isError !== undefined ? { is_error: event.isError } : {}) }, ...sequence() }));
      events.push(json({ type: "content_block_stop", index, ...sequence() }));
      return events;
    }
    // Gemini function responses are user/tool context, not model output. A
    // model-role functionResponse is rejected by the native API and was the
    // source of otherwise silent tool-turn termination on Gemini routes.
    if (protocol === "gemini") return [json({ responseId: state.id, candidates: [{ content: { role: "user", parts: [{ functionResponse: { name: event.name ?? event.callId, response: event.output, ...(event.isError !== undefined ? { isError: event.isError } : {}) } }] } }], ...sequence() })];
    // Chat Completions has no assistant-side tool-result envelope.  Keep the
    // exchange explicit in the extension field used by the canonical codec;
    // clients that understand tool results can replay it, while ordinary Chat
    // consumers still receive a valid chunk with a tool-role delta.
    return [json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {
      role: "tool", tool_call_id: event.callId, content: typeof event.output === "string" ? event.output : JSON.stringify(event.output),
      ...(event.isError !== undefined ? { is_error: event.isError } : {}),
    }, finish_reason: null }], ...sequence() })];
  }
  if (event.type === "usage") {
    if (protocol === "responses") return [json({ type: "response.usage", usage: encodeUsage(protocol, event.usage), ...sequence() })];
    if (protocol === "chat_completions") return [json({ id: state.id, object: "chat.completion.chunk", choices: [], usage: encodeUsage(protocol, event.usage), ...sequence() })];
    if (protocol === "anthropic") return [json({ type: "message_delta", delta: {}, usage: encodeUsage(protocol, event.usage), ...sequence() })];
    return [json({ responseId: state.id, candidates: [], usageMetadata: encodeUsage(protocol, event.usage), ...sequence() })];
  }
  if (event.type === "error") {
    if (protocol === "responses") return [json({ type: "response.failed", response: { id: state.id, object: "response", created_at: state.responseCreatedAt, status: "failed", ...(state.metadata.upstreamModelName || state.metadata.originModelName ? { model: state.metadata.upstreamModelName ?? state.metadata.originModelName } : {}), ...(state.responseMetadata ? { metadata: state.responseMetadata } : {}), error: { ...(event.details ?? {}), code: event.code, message: event.message, retryable: event.retryable }, output: [], incomplete_details: null }, ...sequence() })];
    return [json({ error: { ...(event.details ?? {}), code: event.code, message: event.message, retryable: event.retryable }, ...sequence() })];
  }
  if (protocol === "responses") return finishResponsesStream(state, event.reason, sequence, event.incompleteDetails);
  const bufferedTools = emitBufferedToolCalls(state, protocol, sequence);
  if (protocol === "chat_completions") return [...bufferedTools, json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: event.reason ?? "stop" }], ...sequence() })];
  if (protocol === "anthropic") {
    const events: JsonObject[] = [...bufferedTools];
    if (state.anthropicOpenBlock) events.push(json({ type: "content_block_stop", index: state.anthropicOpenBlock.index, ...sequence() }));
    state.anthropicOpenBlock = undefined;
    events.push(json({ type: "message_delta", delta: { stop_reason: event.reason ?? "end_turn" }, usage: encodeUsage(protocol, state.usage), ...sequence() }));
    events.push(json({ type: "message_stop", ...sequence() }));
    return events;
  }
  return [...bufferedTools, json({ responseId: state.id, candidates: [{ finishReason: event.reason ?? "STOP" }], usageMetadata: encodeUsage(protocol, state.usage), ...sequence() })];
}

function ensureResponseTextState(state: ResponseStreamState, itemId?: string, outputIndex?: number): NonNullable<ResponseStreamState["responseTextState"]> {
  const key = responseItemKey(itemId, outputIndex, "message");
  const existing = state.responseTextStates.get(key);
  if (existing) return existing;
  const created = { itemId: itemId ?? `msg_${state.id}_${state.responseTextStates.size}`, outputIndex: outputIndex ?? state.responseOutputIndex++, text: "", announced: false };
  state.responseOutputIndex = Math.max(state.responseOutputIndex, created.outputIndex + 1);
  state.responseTextStates.set(key, created);
  state.responseTextState ??= created;
  return created;
}

function ensureResponseReasoningState(state: ResponseStreamState, itemId?: string, outputIndex?: number): NonNullable<ResponseStreamState["responseReasoningState"]> {
  const key = responseItemKey(itemId, outputIndex, "reasoning");
  const existing = state.responseReasoningStates.get(key);
  if (existing) return existing;
  const created = { itemId: itemId ?? `rs_${state.id}_${state.responseReasoningStates.size}`, outputIndex: outputIndex ?? state.responseOutputIndex++, text: "", announced: false, summaryParts: [] as Array<{ text: string; signature?: string }> };
  state.responseOutputIndex = Math.max(state.responseOutputIndex, created.outputIndex + 1);
  state.responseReasoningStates.set(key, created);
  state.responseReasoningState ??= created;
  return created;
}

function ensureResponseMediaState(state: ResponseStreamState, mediaType: "image" | "file", media: JsonObject, itemId?: string, outputIndex?: number): ResponseStreamState["responseMediaStates"][number] {
  const existing = state.responseMediaStates.find((item) => item.mediaType === mediaType
    && ((itemId !== undefined && item.itemId === itemId) || (outputIndex !== undefined && item.outputIndex === outputIndex)
      || (itemId === undefined && outputIndex === undefined && JSON.stringify(item.media) === JSON.stringify(media))));
  if (existing) return existing;
  const effectiveOutputIndex = outputIndex ?? state.responseOutputIndex++;
  const created = { itemId: itemId ?? `${mediaType}_${state.id}_${state.responseMediaStates.length}`, outputIndex: effectiveOutputIndex, mediaType, media, announced: false, completed: false };
  state.responseOutputIndex = Math.max(state.responseOutputIndex, effectiveOutputIndex + 1);
  state.responseMediaStates.push(created);
  return created;
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

function finishResponsesStream(state: ResponseStreamState, reason: string | undefined, sequence: () => JsonObject, incompleteDetails?: JsonObject): JsonObject[] {
  const events: JsonObject[] = [];
  const output: JsonObject[] = [];
  const completedItems: Array<{ outputIndex: number; events: JsonObject[] }> = [];
  const deferredSequence = (): JsonObject => ({});
  const model = state.metadata.upstreamModelName ?? state.metadata.originModelName;
  const reasoningStates = [...state.responseReasoningStates.values()];
  if (!reasoningStates.length && state.responseReasoningState) reasoningStates.push(state.responseReasoningState);
  for (const reasoning of reasoningStates.sort((left, right) => left.outputIndex - right.outputIndex)) {
    const summary = reasoning.summaryParts.length
      ? reasoning.summaryParts.map((part) => ({ type: "summary_text", text: part.text, ...(part.signature ? { signature: part.signature } : {}) }))
      : [{ type: "summary_text", text: reasoning.text, ...(reasoning.signature ? { signature: reasoning.signature } : {}) }];
    const item = { id: reasoning.itemId, type: "reasoning", summary, ...(reasoning.encryptedContent ? { encrypted_content: reasoning.encryptedContent } : {}) };
    output.push({ ...item, output_index: reasoning.outputIndex });
    completedItems.push({ outputIndex: reasoning.outputIndex, events: [
      ...summary.map((part, summaryIndex) => json({ type: "response.reasoning_summary_text.done", response_id: state.id, item_id: reasoning.itemId, output_index: reasoning.outputIndex, summary_index: summaryIndex, text: part.text, ...deferredSequence() })),
      json({ type: "response.output_item.done", response_id: state.id, output_index: reasoning.outputIndex, item, ...deferredSequence() }),
    ] });
  }
  for (const media of state.responseMediaStates) {
    const item = { id: media.itemId, type: "message", status: "completed", role: "assistant", content: [{ ...media.media, type: media.mediaType === "image" ? "output_image" : "output_file" }] };
    output.push({ ...item, output_index: media.outputIndex });
    const mediaEvents: JsonObject[] = [];
    if (!media.announced) mediaEvents.push(json({ type: "response.output_item.added", response_id: state.id, output_index: media.outputIndex, item, ...deferredSequence() }));
    if (!media.completed) mediaEvents.push(json({ type: "response.output_item.done", response_id: state.id, output_index: media.outputIndex, item, ...deferredSequence() }));
    completedItems.push({ outputIndex: media.outputIndex, events: mediaEvents });
    media.announced = true;
    media.completed = true;
  }
  const textStates = [...state.responseTextStates.values()];
  if (!textStates.length && state.responseTextState) textStates.push(state.responseTextState);
  for (const text of textStates.sort((left, right) => left.outputIndex - right.outputIndex)) {
    const item = { id: text.itemId, type: "message", status: "completed", role: "assistant", content: [{ type: text.refusal ? "refusal" : "output_text", ...(text.refusal ? { refusal: text.refusal } : { text: text.text, annotations: text.annotations ?? [] }) }] };
    output.push({ ...item, output_index: text.outputIndex });
    completedItems.push({ outputIndex: text.outputIndex, events: [
      ...(text.refusal
        ? [json({ type: "response.refusal.done", response_id: state.id, item_id: text.itemId, output_index: text.outputIndex, content_index: 0, refusal: text.refusal, ...deferredSequence() })]
        : [json({ type: "response.output_text.done", response_id: state.id, item_id: text.itemId, output_index: text.outputIndex, content_index: 0, text: text.text, ...deferredSequence() })]),
      json({ type: "response.content_part.done", response_id: state.id, item_id: text.itemId, output_index: text.outputIndex, content_index: 0, part: item.content[0], ...deferredSequence() }),
      json({ type: "response.output_item.done", response_id: state.id, output_index: text.outputIndex, item, ...deferredSequence() }),
    ] });
  }
  for (const tool of completeToolStates(state)) {
    tool.announced = true;
    tool.outputIndex ??= state.responseOutputIndex++;
    const item = tool.kind === "custom"
      ? { id: tool.itemId, type: "custom_tool_call", status: "completed", input: tool.arguments, call_id: tool.callId, name: tool.name! }
      : tool.kind === "tool_search"
        ? { ...(tool.raw ?? {}), id: tool.itemId, type: "tool_search_call", status: "completed", call_id: tool.callId, name: tool.name!, input: parseObject(tool.arguments) }
        : tool.kind === "hosted" && tool.raw ? tool.raw
          : { id: tool.itemId, type: "function_call", status: "completed", arguments: tool.arguments, call_id: tool.callId, name: tool.name!, ...(tool.namespace ? { namespace: tool.namespace } : {}) };
    output.push({ ...item, output_index: tool.outputIndex ?? 0 });
    const toolEvents = [
      ...(tool.kind === "custom"
        ? [json({ type: "response.custom_tool_call_input.done", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, input: tool.arguments, ...deferredSequence() })]
        : tool.kind === "tool_search"
          ? [json({ type: "response.tool_search_call.done", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, input: parseObject(tool.arguments), ...deferredSequence() })]
          : [json({ type: "response.function_call_arguments.done", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, arguments: tool.arguments, ...deferredSequence() })]),
      json({ type: "response.output_item.done", response_id: state.id, output_index: tool.outputIndex, item, ...deferredSequence() }),
    ];
    completedItems.push({ outputIndex: tool.outputIndex, events: toolEvents });
  }
  completedItems.sort((left, right) => left.outputIndex - right.outputIndex).forEach((group) => events.push(...group.events));
  if (state.options.emitSequenceNumber) for (const event of events) event.sequence_number = state.sequenceNumber++;
  output.sort((left, right) => Number(left.output_index ?? 0) - Number(right.output_index ?? 0));
  const incomplete = reason === "length" || reason === "max_tokens" || reason === "max_output_tokens" || reason === "incomplete" || reason === "content_filter" || reason === "safety" || reason === "MAX_TOKENS" || reason === "SAFETY";
  const details = incomplete ? { ...(state.responseIncompleteDetails ?? {}), ...(incompleteDetails ?? {}), reason: reason ?? state.responseIncompleteReason ?? incompleteDetails?.reason ?? "incomplete" } : null;
  const response: JsonObject = { id: state.id, object: "response", created_at: state.responseCreatedAt, status: incomplete ? "incomplete" : state.responseStatus ?? "completed", ...(model ? { model } : {}), ...(state.responseMetadata ? { metadata: state.responseMetadata } : {}), output: output.map(({ output_index: _index, ...item }) => item), error: null, incomplete_details: details, usage: encodeUsage("responses", state.usage) };
  events.push(json({ type: incomplete ? "response.incomplete" : "response.completed", response, ...(state.options.emitSequenceNumber ? { sequence_number: state.sequenceNumber++ } : {}) }));
  return events;
}

function emitBufferedToolCalls(
  state: ResponseStreamState,
  protocol: GatewayProtocol,
  sequence: () => JsonObject,
): JsonObject[] {
  const calls = completeToolStates(state);
  if (protocol === "chat_completions") {
    return calls.map((tool, index) => json({ id: state.id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {
      // Chat Completions uses this zero-based index to associate argument
      // fragments with the correct parallel tool call.  Responses exposes a
      // separate output_index, so it must not be forwarded here: output items
      // such as reasoning/text can make it sparse or non-contiguous.
      tool_calls: [{ index, id: tool.callId, type: "function", function: { name: tool.name, arguments: encodeToolArguments(protocol, tool) } }],
    }, finish_reason: null }], ...sequence() }));
  }
  if (protocol === "anthropic") {
    const events: JsonObject[] = [];
    for (const tool of calls) {
      const index = state.anthropicToolBlockIndexes.get(tool.callId) ?? state.anthropicNextBlockIndex;
      if (!state.anthropicToolBlockIndexes.has(tool.callId)) {
        state.anthropicToolBlockIndexes.set(tool.callId, index);
        state.anthropicNextBlockIndex = index + 1;
      }
      events.push(...openAnthropicBlock(state, "tool_use", index, { id: tool.callId, name: tool.name! }));
      events.push(json({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: encodeToolArguments(protocol, tool) }, ...sequence() }));
    }
    return events;
  }
  return calls.map((tool) => json({ responseId: state.id, candidates: [{ content: { role: "model", parts: [{ functionCall: { name: tool.name, args: parseObject(encodeToolArguments(protocol, tool)) }, ...(tool.signature ? { thoughtSignature: tool.signature } : {}) }] } }], ...sequence() }));
}

/** Emit the native Responses item lifecycle while arguments arrive. */
function emitResponseToolDelta(
  state: ResponseStreamState,
  event: Extract<ConversionResponseEvent, { type: "tool_call_delta" }>,
  sequence: () => JsonObject,
): JsonObject[] {
  const tool = state.responseToolStates.get(event.callId);
  if (!tool || !tool.name) return [];
  const completeArguments = validToolArguments(tool.arguments, tool.kind);
  // Do not expose an output item for an empty or malformed call.  Waiting
  // until the buffered JSON is complete prevents downstream Responses clients
  // from attempting to execute a call that will later be rejected.
  if (!tool.announced && tool.kind !== "custom" && !completeArguments) return [];
  const events: JsonObject[] = [];
  const wasAnnounced = tool.announced;
  tool.outputIndex ??= state.responseOutputIndex++;
  if (!tool.announced) {
    tool.announced = true;
    const item = tool.kind === "custom"
      ? { id: tool.itemId, type: "custom_tool_call", status: "in_progress", input: "", call_id: tool.callId, name: tool.name }
      : tool.kind === "tool_search"
        ? { ...(tool.raw ?? {}), id: tool.itemId, type: "tool_search_call", status: "in_progress", call_id: tool.callId, name: tool.name }
        : { id: tool.itemId, type: "function_call", status: "in_progress", call_id: tool.callId, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}) };
    events.push(json({ type: "response.output_item.added", response_id: state.id, output_index: tool.outputIndex, item, ...sequence() }));
  }
  // A native Responses stream emits a final `*.arguments.done` event after
  // the last delta. The final value is carried in the terminal item, so do
  // not emit the complete argument string a second time when this state has
  // already been announced.
  const delta = event.argumentsFinal && wasAnnounced
    ? ""
    : !wasAnnounced && tool.kind !== "custom" ? completeArguments ?? "" : event.argumentsDelta ?? "";
  if (!delta) return events;
  if (tool.kind === "custom") events.push(json({ type: "response.custom_tool_call_input.delta", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, delta, ...sequence() }));
  else if (tool.kind === "tool_search") events.push(json({ type: "response.tool_search_call.delta", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, delta, ...sequence() }));
  else events.push(json({ type: "response.function_call_arguments.delta", response_id: state.id, item_id: tool.itemId, output_index: tool.outputIndex, delta, ...sequence() }));
  return events;
}

function encodeToolArguments(protocol: GatewayProtocol, tool: ResponseToolState): string {
  if (tool.kind !== "custom" || protocol === "responses") return tool.arguments;
  // Custom tools carry free-form text.  Function-call protocols only accept a
  // JSON object, so use the same explicit wrapper as the non-stream encoder.
  return JSON.stringify({ input: tool.arguments });
}

function completeToolStates(state: ResponseStreamState): ResponseToolState[] {
  return [...state.responseToolStates.values()]
    .flatMap((tool) => {
      const argumentsText = validToolArguments(tool.arguments, tool.kind);
      return tool.name && argumentsText ? [{ ...tool, arguments: argumentsText }] : [];
    });
}

function recordToolCallDelta(state: ResponseStreamState, event: Extract<ConversionResponseEvent, { type: "tool_call_delta" }>): void {
  const tool = state.responseToolStates.get(event.callId) ?? {
    callId: event.callId,
    itemId: event.itemId ?? `fc_${state.id}_${state.responseToolStates.size}`,
    arguments: "",
    announced: false,
  };
  if (event.itemId) tool.itemId = event.itemId;
  if (event.outputIndex !== undefined) {
    tool.outputIndex = event.outputIndex;
    state.responseOutputIndex = Math.max(state.responseOutputIndex, event.outputIndex + 1);
  }
  tool.name ??= event.name;
  tool.namespace ??= event.namespace;
  tool.kind ??= event.kind;
  tool.signature ??= event.signature;
  tool.raw ??= event.raw;
  tool.arguments = event.argumentsFinal ? event.argumentsDelta ?? "" : tool.arguments + (event.argumentsDelta ?? "");
  state.responseToolStates.set(event.callId, tool);
}

function invalidToolCallEvent(
  state: ResponseStreamState,
  event: ConversionResponseEvent,
): Extract<ConversionResponseEvent, { type: "error" }> | undefined {
  if (event.type !== "message_end") return undefined;
  if (state.target !== "responses" && [...state.responseToolStates.values()].some((tool) => tool.kind === "hosted")) {
    return {
      type: "error",
      code: "unsupported_hosted_tool_response",
      message: `The upstream returned a hosted tool call that cannot be represented by '${state.target}'`,
      retryable: false,
    };
  }
  const validCalls = completeToolStates(state);
  const hasToolIntent = state.responseToolStates.size > 0 || isToolCallFinishReason(event.reason);
  // A valid call keeps the turn executable. If every attempted call was
  // empty, malformed, or unnamed, a normal terminal event would make the
  // Responses client believe the model answered successfully and silently
  // discard the tool turn.
  if (!hasToolIntent || validCalls.length > 0) return undefined;
  if (!isToolCallFinishReason(event.reason) && event.reason !== "stop") return undefined;
  const attempted = [...state.responseToolStates.values()]
    .map((tool) => `${tool.name ?? "<unnamed>"}(arguments=${tool.arguments.length ? `${tool.arguments.length} chars` : "empty"})`)
    .join(", ");
  return {
    type: "error",
    code: "upstream_invalid_tool_call",
    message: `Upstream finished with '${event.reason ?? "stop"}' but returned no valid tool call arguments; the provider likely emitted an empty or malformed tool call${attempted ? `: ${attempted}` : ""}`,
    retryable: false,
  };
}

function isToolCallFinishReason(value: string | undefined): boolean {
  return value !== undefined && ["tool_calls", "function_call", "tool_use", "tools"].includes(value);
}

function validToolArguments(value: string, kind?: "function" | "custom" | "tool_search" | "hosted"): string | undefined {
  if (!value.trim()) return undefined;
  if (kind === "custom") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed as JsonObject) ? value : undefined;
  } catch {
    return undefined;
  }
}
function isJsonObjectText(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed as JsonObject);
  } catch {
    return false;
  }
}

function openAnthropicBlock(
  state: ResponseStreamState,
  type: "text" | "thinking" | "tool_use",
  requestedIndex?: number,
  tool?: { id: string; name: string },
): JsonObject[] {
  const index = requestedIndex
    ?? (state.anthropicOpenBlock?.type === type
      ? state.anthropicOpenBlock.index
      : state.anthropicNextBlockIndex);
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

/**
 * Streaming adapters must not silently swallow a provider event that has no
 * canonical representation.  Known lifecycle frames are intentionally quiet;
 * everything else that produces neither a canonical event nor a supported
 * envelope gets a structured warning so callers can surface/telemetry it.
 */
function diagnoseStreamChunk(
  source: GatewayProtocol,
  target: GatewayProtocol,
  body: JsonObject,
  decoded: readonly ConversionResponseEvent[],
): ConversionDiagnostic[] {
  const type = typeof body.type === "string" ? body.type : undefined;
  const known = source === "responses"
    ? new Set(["response.created", "response.queued", "response.in_progress", "response.completed", "response.incomplete", "response.failed", "response.usage", "response.output_text.delta", "response.output_text.done", "response.output_text.annotation.added", "response.refusal.delta", "response.refusal.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_summary.done", "response.reasoning.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done", "response.tool_search_call.delta", "response.tool_search_call.done", "response.tool_search_call_input.delta", "response.tool_search_call_input.done", "response.output_item.added", "response.output_item.done"])
    : source === "anthropic"
      ? new Set(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"])
      : undefined;
  const recognizedShape = source === "chat_completions"
    ? Array.isArray(body.choices) || body.usage !== undefined || body.error !== undefined
    : source === "gemini"
      ? Array.isArray(body.candidates) || body.usageMetadata !== undefined || body.error !== undefined
      : false;
  if (type && known && !known.has(type) && !recognizedShape) return [{ code: "unknown_stream_event", level: "warning", message: `Ignored unsupported ${source} stream event '${type}'`, source, target, path: "type" }];
  if ((type && known?.has(type)) || recognizedShape || decoded.some((event) => event.type !== "message_start")) return [];
  if (!type && !recognizedShape) return [{ code: "unknown_stream_frame", level: "warning", message: `Ignored a ${source} stream frame without a recognized event shape`, source, target, path: "stream" }];
  return [];
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

function isResponsesTerminalEnvelope(body: JsonObject): boolean {
  return body.type === "response.completed" || body.type === "response.incomplete" || body.type === "response.failed"
    || body.status === "completed" || body.status === "incomplete" || body.status === "failed"
    || isObject(body.response) && ["completed", "incomplete", "failed"].includes(String(body.response.status ?? ""));
}

function hasTrackedResponsesOutput(state: ResponseStreamState): boolean {
  // Native Responses targets materialize output-item state as they encode the
  // stream.  When the target is Chat/Anthropic/Gemini there is no need to
  // materialize that state, but the canonical event history still records the
  // output that has already been forwarded.  Terminal `response.completed`
  // envelopes repeat the aggregate output for every target, so treat those
  // canonical events as tracked output too.
  return Boolean(
    state.responseTextStates.size
    || state.responseReasoningStates.size
    || state.responseTextState
    || state.responseReasoningState
    || state.responseMediaStates.length
    || state.responseToolStates.size
    || state.events.some((event) => event.type === "text_delta" && (Boolean(event.text) || Boolean(event.refusal)))
    || state.events.some((event) => event.type === "reasoning_delta" && (Boolean(event.text) || Boolean(event.signature) || Boolean(event.encryptedContent)))
    || state.events.some((event) => event.type === "media")
    || state.events.some((event) => event.type === "tool_call_delta" && (Boolean(event.argumentsDelta) || Boolean(event.argumentsFinal)))
    || state.events.some((event) => event.type === "tool_result"),
  );
}

function responseItemKey(itemId: string | undefined, outputIndex: number | undefined, kind: "message" | "reasoning"): string {
  return `${kind}:${itemId ?? `index:${outputIndex ?? "auto"}`}`;
}

function hasResponseTextItem(state: ResponseStreamState, itemId?: string, outputIndex?: number): boolean {
  if (state.responseTextStates.has(responseItemKey(itemId, outputIndex, "message"))) return true;
  if (state.responseTextState
    && (itemId === undefined || state.responseTextState.itemId === itemId)
    && (outputIndex === undefined || state.responseTextState.outputIndex === outputIndex)) return true;

  // For non-Responses targets the response item state is intentionally not
  // materialized. Match the terminal item against the canonical event
  // history, preserving the item id/index relationship when the upstream
  // includes either one. Without this check a complete output_item.done
  // payload is appended after the deltas that already carried the answer.
  if (state.events.some((event) => event.type === "text_delta"
    && (Boolean(event.text) || Boolean(event.refusal))
    && ((itemId !== undefined && event.itemId === itemId)
      || (outputIndex !== undefined && event.outputIndex === outputIndex)))) return true;

  // When the target is Chat/Anthropic/Gemini, the response item state is not
  // materialized (it is only needed to emit a native Responses stream). Keep
  // the same association from the canonical event history: an earlier
  // unqualified text delta proves that the later identified terminal event is
  // the completion of that one text item.
  if ((itemId !== undefined || outputIndex !== undefined)
    && state.events.some((event) => event.type === "text_delta"
      && event.itemId === undefined
      && (outputIndex === undefined || event.outputIndex === undefined || event.outputIndex === outputIndex))) return true;

  // Some Responses-compatible relays omit item_id/output_index on the delta
  // frames and only add them to the terminal `*.done` event. In that case the
  // converter creates a generated id for the single active text item. Treat a
  // later identified terminal item as the same item while there is exactly one
  // non-empty text state; otherwise a complete answer is emitted a second time.
  const states = [...state.responseTextStates.values()];
  if (states.length !== 1) return false;
  const only = states[0];
  const generatedId = only.itemId.startsWith(`msg_${state.id}_`);
  return generatedId
    && only.text.length > 0
    && (outputIndex === undefined || only.outputIndex === outputIndex);
}

function hasResponseReasoningItem(state: ResponseStreamState, itemId?: string, outputIndex?: number): boolean {
  return state.responseReasoningStates.has(responseItemKey(itemId, outputIndex, "reasoning"))
    || Boolean(state.responseReasoningState && (itemId === undefined || state.responseReasoningState.itemId === itemId) && (outputIndex === undefined || state.responseReasoningState.outputIndex === outputIndex));
}

function hasResponseMediaItem(state: ResponseStreamState, itemId?: string, outputIndex?: number): boolean {
  return state.responseMediaStates.some((item) => (itemId !== undefined && item.itemId === itemId) || (outputIndex !== undefined && item.outputIndex === outputIndex));
}

function hasSeenResponsesText(state: ResponseStreamState, body: JsonObject): boolean {
  const itemId = typeof body.item_id === "string" ? body.item_id : undefined;
  if (state.events.some((event) => event.type === "text_delta" && (!itemId || event.itemId === itemId))) return true;
  if (itemId && state.events.some((event) => event.type === "text_delta" && event.itemId === undefined)) return true;
  // See hasResponseTextItem: a relay can identify only the terminal event,
  // while all preceding deltas were unqualified. A single generated,
  // non-empty state is sufficient evidence that the done text is a replay.
  return Boolean(itemId && [...state.responseTextStates.values()].length === 1
    && [...state.responseTextStates.values()][0]?.itemId.startsWith(`msg_${state.id}_`)
    && [...state.responseTextStates.values()][0]?.text.length);
}

function hasSeenResponsesRefusal(state: ResponseStreamState, body: JsonObject): boolean {
  const itemId = typeof body.item_id === "string" ? body.item_id : undefined;
  return state.events.some((event) => event.type === "text_delta"
    && Boolean(event.refusal)
    && (!itemId || event.itemId === itemId));
}

function hasSeenResponsesReasoning(state: ResponseStreamState, body: JsonObject): boolean {
  const itemId = typeof body.item_id === "string" ? body.item_id : undefined;
  return state.events.some((event) => event.type === "reasoning_delta" && (!itemId || event.itemId === itemId));
}

function hasCompleteResponseTool(state: ResponseStreamState, callId: string): boolean {
  const tool = state.responseToolStates.get(callId);
  return Boolean(tool && tool.name && validToolArguments(tool.arguments, tool.kind));
}

function normalizeStreamEvent(state: ResponseStreamState, event: ConversionResponseEvent): ConversionResponseEvent {
  if (event.type !== "tool_call_delta") return event;
  // Chat providers commonly include the call id only in the first fragment
  // and identify later fragments by `tool_calls[].index`. Keep the first
  // provider id as the stable public call id while joining those fragments;
  // otherwise one logical call becomes a named call plus an unnamed call and
  // is rejected at stream finalization.
  if (event.index !== undefined) {
    const indexKey = `index:${event.index}`;
    const known = state.toolCallAliases.get(indexKey);
    if (known) return event.callId === known ? event : { ...event, callId: known };
    state.toolCallAliases.set(indexKey, event.callId);
    return event;
  }
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
