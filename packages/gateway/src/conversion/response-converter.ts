import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { planConversion } from "./formats.js";
import { decodeUsage, encodeUsage, type ConversionUsage } from "./usage.js";
import { enforceToolLossPolicy, type ConversionDiagnostic } from "./diagnostics.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";

export type ConversionResponseEvent =
  | { type: "message_start"; responseId: string; role: "assistant"; createdAt?: number; model?: string; status?: string; metadata?: JsonObject }
  | { type: "text_delta"; text: string; annotations?: JsonValue[]; annotationIndex?: number; refusal?: string; itemId?: string; outputIndex?: number; contentIndex?: number }
  | { type: "reasoning_delta"; text: string; signature?: string; encryptedContent?: string; itemId?: string; outputIndex?: number; summaryIndex?: number }
  | { type: "media"; mediaType: "image" | "file"; media: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "tool_call_delta"; callId: string; name?: string; namespace?: string; argumentsDelta?: string; argumentsFinal?: boolean; index?: number; signature?: string; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "tool_result"; callId: string; name?: string; output: JsonValue; isError?: boolean; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "usage"; usage: ConversionUsage }
  | { type: "error"; code: string; message: string; retryable: boolean; details?: JsonObject }
  | { type: "message_end"; reason?: string; incompleteReason?: string; status?: string; metadata?: JsonObject; incompleteDetails?: JsonObject };

export interface ConvertedResponse {
  responseId: string;
  text: string;
  textItemId?: string;
  textOutputIndex?: number;
  textContentIndex?: number;
  textAnnotations?: JsonValue[];
  refusal?: string;
  reasoning: string;
  reasoningItemId?: string;
  reasoningOutputIndex?: number;
  reasoningSummaryIndex?: number;
  reasoningSignature?: string;
  reasoningEncryptedContent?: string;
  /** Distinct Responses reasoning items, including ordered summary parts. */
  reasoningItems: Array<{ itemId?: string; outputIndex?: number; parts: JsonValue[]; encryptedContent?: string }>;
  media: Array<{ mediaType: "image" | "file"; media: JsonObject; itemId?: string; outputIndex?: number }>;
  /** Message output items kept separate for Responses item-boundary fidelity. */
  messageItems: Array<{ itemId?: string; outputIndex?: number; parts: JsonValue[] }>;
  toolCalls: Array<{ callId: string; name?: string; namespace?: string; arguments: string; signature?: string; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }>;
  toolResults: Array<{ callId: string; name?: string; output: JsonValue; isError?: boolean; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }>;
  /** First-seen output order, used to keep mixed text/media/tool turns stable. */
  outputOrder: Array<{ kind: "message" | "reasoning" | "media" | "tool_call" | "tool_result"; id?: string; index?: number }>;
  invalidToolCalls: number;
  usage: ConversionUsage;
  endReason?: string;
  incompleteReason?: string;
  incompleteDetails?: JsonObject;
  createdAt?: number;
  status?: string;
}

/**
 * Chat-compatible providers are allowed to stream tool arguments in arbitrary
 * fragments.  Never expose an empty or malformed argument string to a
 * Responses consumer: Codex parses this field as a JSON value and reports
 * `EOF while parsing a value` for an empty string.
 */
function normalizeToolArguments(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return isObject(parsed as JsonValue) ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
  return isObject(value) ? JSON.stringify(value) : undefined;
}

export function decodeResponseEvents(protocol: GatewayProtocol, body: JsonObject, metadata: ConversionMetadata = {}): ConversionResponseEvent[] {
  const response = isObject(body.response) ? body.response : body;
  const events: ConversionResponseEvent[] = [{
    type: "message_start",
    responseId: responseId(protocol, body),
    role: "assistant",
    ...(typeof response.created_at === "number" ? { createdAt: response.created_at } : {}),
    ...(asString(response.model) ? { model: asString(response.model) } : {}),
    ...(asString(response.status) ? { status: asString(response.status) } : {}),
    ...(isObject(response.metadata) ? { metadata: response.metadata } : {}),
  }];
  const rawError = isObject(body.error)
    ? body.error
    : isObject(response.error)
      ? response.error
      : undefined;
  if (rawError) {
    events.push({ type: "error", code: asString(rawError.code) ?? asString(rawError.type) ?? "upstream_error", message: asString(rawError.message) ?? "The upstream request failed", retryable: isRetryableError(rawError), details: rawError });
  } else if (protocol === "responses") decodeResponses(body, events, metadata);
  else if (protocol === "chat_completions") decodeChat(body, events, metadata);
  else if (protocol === "anthropic") decodeAnthropic(body, events, metadata);
  else decodeGemini(body, events, metadata);
  const usage = decodeUsage(protocol, body) ?? (isObject(body.response) ? decodeUsage(protocol, body.response) : undefined);
  if (usage) {
    // Usage belongs to the terminal response and must be emitted before the
    // terminal event on a stream. Codex treats response.completed as terminal
    // and may ignore frames that arrive after it.
    const terminalIndex = events.findIndex((event) => event.type === "message_end" || event.type === "error");
    const usageEvent: ConversionResponseEvent = { type: "usage", usage };
    if (terminalIndex >= 0) events.splice(terminalIndex, 0, usageEvent);
    else events.push(usageEvent);
  }
  // A stream lifecycle frame (created/in_progress/usage/message_start) is not
  // a terminal response. Emitting a synthetic end here causes non-stream
  // callers to close the turn early and makes stream adapters depend on a
  // later filter to recover.
  const lifecycleOnly = isNonTerminalStreamFrame(protocol, body)
    || (protocol === "anthropic" && asString(body.type) === "message_start");
  if (!lifecycleOnly && !events.some((event) => event.type === "message_end" || event.type === "error")) events.push({ type: "message_end" });
  return events;
}

function isNonTerminalStreamFrame(protocol: GatewayProtocol, body: JsonObject): boolean {
  if (protocol === "responses") return ["response.created", "response.queued", "response.in_progress", "response.usage"].includes(asString(body.type) ?? "");
  if (protocol === "chat_completions") {
    const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : undefined;
    return choice !== undefined && choice.finish_reason === null;
  }
  if (protocol === "gemini") {
    const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : undefined;
    return candidate !== undefined && candidate.finishReason === undefined;
  }
  return asString(body.type) === "content_block_start" || asString(body.type) === "content_block_delta" || asString(body.type) === "content_block_stop";
}

export function encodeResponseEvents(protocol: GatewayProtocol, events: readonly ConversionResponseEvent[], metadata: ConversionMetadata = {}): JsonObject {
  const error = events.find((event): event is Extract<ConversionResponseEvent, { type: "error" }> => event.type === "error");
  if (error) return encodeError(protocol, error);
  const response = collectResponse(events, metadata);
  const model = metadata.upstreamModelName ?? metadata.originModelName;
  if (response.invalidToolCalls > 0 && response.toolCalls.length === 0) {
    return encodeError(protocol, {
      type: "error",
      code: "upstream_invalid_tool_call",
      message: `Upstream finished with '${response.endReason ?? "unknown"}' but returned no valid tool call arguments (${response.invalidToolCalls} invalid call${response.invalidToolCalls === 1 ? "" : "s"})`,
      retryable: false,
    });
  }
  if (protocol === "responses") {
    const output = encodeResponsesOutput(response);
    const incomplete = Boolean(response.incompleteReason || (response.endReason && response.endReason !== "stop" && response.endReason !== "completed"));
    const incompleteDetails = incomplete ? (response.incompleteDetails ?? { reason: response.incompleteReason ?? response.endReason ?? "incomplete" }) : null;
    return { id: response.responseId, object: "response", ...(model ? { model } : {}), ...(response.createdAt !== undefined ? { created_at: response.createdAt } : {}), ...(firstResponseMetadata(events) ? { metadata: firstResponseMetadata(events) } : {}), status: incomplete ? "incomplete" : response.status ?? "completed", output, error: null, incomplete_details: incompleteDetails, usage: encodeUsage(protocol, response.usage) };
  }
  if (response.toolCalls.some((call) => call.kind === "hosted")) {
    return encodeError(protocol, {
      type: "error",
      code: "unsupported_hosted_tool_response",
      message: `The upstream returned a hosted tool call that cannot be represented by '${protocol}'`,
      retryable: false,
    });
  }
  if (protocol === "chat_completions") {
    const responseContent: JsonValue[] = [];
    // Chat refusals are a sibling field, not ordinary assistant content.
    // Keeping them out of `content` avoids duplicate rendering by clients.
    const emittedMessage = new Set<string>();
    const appendChatMessage = (): void => {
      if (emittedMessage.has("text")) return;
      emittedMessage.add("text");
      if (response.text) responseContent.push({ type: "text", text: response.text });
    };
    const appendChatMedia = (index: number): void => {
      const media = response.media[index];
      if (!media || emittedMessage.has(`media:${index}`)) return;
      emittedMessage.add(`media:${index}`);
      responseContent.push(media.mediaType === "image"
        ? { type: "image_url", image_url: media.media.image_url ?? media.media.url ?? media.media }
        : { type: "file", file: media.media });
    };
    for (const entry of response.outputOrder) {
      if (entry.kind === "message") appendChatMessage();
      else if (entry.kind === "media" && entry.index !== undefined) appendChatMedia(entry.index);
    }
    appendChatMessage();
    for (let index = 0; index < response.media.length; index += 1) appendChatMedia(index);
    const message: JsonObject = { role: "assistant", content: responseContent.length === 0
      ? null
      : responseContent.length === 1 && (response.text || response.refusal)
        ? response.text
        : responseContent };
    if (response.reasoning) message.reasoning_content = response.reasoning;
    if (response.refusal) message.refusal = response.refusal;
    if (response.textAnnotations?.length) message.annotations = response.textAnnotations;
    if (response.toolCalls.length) message.tool_calls = response.toolCalls.map((call) => ({ id: call.callId, type: "function", function: { name: call.name ?? "tool", arguments: call.kind === "custom" ? JSON.stringify({ input: call.arguments }) : call.arguments } }));
    // Tool results normally travel in the next client request, but some
    // provider bridges return them as response parts. Preserve them as
    // explicit `tool` messages instead of silently dropping `is_error` and
    // making a round-trip appear successful.
    if (response.toolResults.length) {
      message.tool_results = response.toolResults.map((result) => ({
        role: "tool",
        tool_call_id: result.callId,
        content: result.output,
        ...(result.isError !== undefined ? { is_error: result.isError } : {}),
      }));
    }
    return { id: response.responseId, object: "chat.completion", ...(model ? { model } : {}), choices: [{ index: 0, message, finish_reason: response.toolCalls.length ? "tool_calls" : response.endReason ?? "stop" }], usage: encodeUsage(protocol, response.usage) };
  }
  if (protocol === "anthropic") {
    const content: JsonValue[] = [];
    const seen = new Set<string>();
    const calls = new Map(response.toolCalls.map((call) => [call.callId, call]));
    const results = new Map(response.toolResults.map((result) => [result.callId, result]));
    const appendReasoning = (): void => {
      if (response.reasoning && !seen.has("reasoning")) {
        seen.add("reasoning");
        content.push({ type: "thinking", thinking: response.reasoning, ...(response.reasoningSignature ? { signature: response.reasoningSignature } : {}) });
      }
      if (response.reasoningEncryptedContent && !seen.has("encrypted-reasoning")) {
        seen.add("encrypted-reasoning");
        content.push({ type: "redacted_thinking", data: response.reasoningEncryptedContent });
      }
    };
    const appendText = (): void => { if ((response.text || response.refusal) && !seen.has("message")) { seen.add("message"); content.push({ type: "text", text: response.text || response.refusal || "" }); } };
    const appendMedia = (index: number): void => { const media = response.media[index]; if (!media || seen.has(`media:${index}`)) return; seen.add(`media:${index}`); content.push(media.mediaType === "image" ? { type: "image", source: media.media.source ?? media.media } : { type: "document", source: media.media.source ?? media.media }); };
    const appendCall = (id: string): void => { const call = calls.get(id); if (!call || seen.has(`call:${id}`)) return; seen.add(`call:${id}`); content.push({ type: "tool_use", id: call.callId, name: call.name ?? "tool", input: call.kind === "custom" ? { input: call.arguments } : parseJsonObject(call.arguments) }); };
    const appendResult = (id: string): void => { const result = results.get(id); if (!result || seen.has(`result:${id}`)) return; seen.add(`result:${id}`); content.push({ type: "tool_result", tool_use_id: result.callId, content: result.output, ...(result.isError !== undefined ? { is_error: result.isError } : {}) }); };
    for (const entry of response.outputOrder) {
      if (entry.kind === "reasoning") appendReasoning();
      else if (entry.kind === "message") appendText();
      else if (entry.kind === "media" && entry.index !== undefined) appendMedia(entry.index);
      else if (entry.kind === "tool_call" && entry.id) appendCall(entry.id);
      else if (entry.kind === "tool_result" && entry.id) appendResult(entry.id);
    }
    appendReasoning(); appendText();
    for (let index = 0; index < response.media.length; index += 1) appendMedia(index);
    for (const call of response.toolCalls) appendCall(call.callId);
    for (const result of response.toolResults) appendResult(result.callId);
    return { id: response.responseId, type: "message", role: "assistant", ...(model ? { model } : {}), content, stop_reason: response.toolCalls.length ? "tool_use" : response.endReason ?? "end_turn", usage: encodeUsage(protocol, response.usage) };
  }
  const parts: JsonValue[] = [];
  const seen = new Set<string>();
  const calls = new Map(response.toolCalls.map((call) => [call.callId, call]));
  const results = new Map(response.toolResults.map((result) => [result.callId, result]));
  const appendReasoning = (): void => { if (response.reasoning && !seen.has("reasoning")) { seen.add("reasoning"); parts.push({ text: response.reasoning, thought: true, ...(response.reasoningSignature ? { thoughtSignature: response.reasoningSignature } : {}) }); } };
  const appendText = (): void => { if ((response.text || response.refusal) && !seen.has("message")) { seen.add("message"); parts.push({ text: response.text || response.refusal || "" }); } };
  const appendMedia = (index: number): void => { const media = response.media[index]; if (!media || seen.has(`media:${index}`)) return; seen.add(`media:${index}`); parts.push(media.mediaType === "image" ? { inlineData: media.media } : { fileData: media.media }); };
  const appendCall = (call: ConvertedResponse["toolCalls"][number]): void => {
    if (seen.has(`call:${call.callId}`)) return;
    seen.add(`call:${call.callId}`);
    const raw = call.raw;
    const functionCall = isObject(raw?.functionCall) ? raw.functionCall : undefined;
    parts.push({
      functionCall: functionCall
        ? { ...functionCall, args: call.kind === "custom" ? { input: call.arguments } : parseJsonObject(call.arguments) }
        : { name: call.name ?? "tool", args: call.kind === "custom" ? { input: call.arguments } : parseJsonObject(call.arguments) },
      ...(call.signature ? { thoughtSignature: call.signature } : typeof raw?.thoughtSignature === "string" ? { thoughtSignature: raw.thoughtSignature } : {}),
    });
  };
  const appendResult = (id: string): void => {
    const result = results.get(id);
    if (!result || seen.has(`result:${id}`)) return;
    seen.add(`result:${id}`);
    const rawResponse = isObject(result.raw?.functionResponse) ? result.raw.functionResponse : undefined;
    parts.push({ functionResponse: {
      name: result.name ?? asString(rawResponse?.name) ?? result.callId,
      response: result.output,
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
      ...(asString(rawResponse?.call_id) ? { call_id: asString(rawResponse?.call_id) } : {}),
    } });
  };
  for (const entry of response.outputOrder) {
    if (entry.kind === "reasoning") appendReasoning();
    else if (entry.kind === "message") appendText();
    else if (entry.kind === "media" && entry.index !== undefined) appendMedia(entry.index);
    else if (entry.kind === "tool_call" && entry.id) { const call = calls.get(entry.id); if (call) appendCall(call); }
    else if (entry.kind === "tool_result" && entry.id) appendResult(entry.id);
  }
  appendReasoning(); appendText();
  for (let index = 0; index < response.media.length; index += 1) appendMedia(index);
  for (const call of response.toolCalls) appendCall(call);
  for (const result of response.toolResults) appendResult(result.callId);
  return { responseId: response.responseId, ...(model ? { model } : {}), candidates: [{ content: { role: "model", parts }, finishReason: response.toolCalls.length ? "STOP" : response.endReason ?? "STOP" }], usageMetadata: encodeUsage(protocol, response.usage) };
}

/**
 * Build a Responses `output` array from the canonical first-seen order.
 * Keeping this in one place is important: providers are allowed to interleave
 * reasoning, message content, media and tool exchanges, while the old
 * implementation silently grouped them as message -> reasoning -> tools.
 */
function encodeResponsesOutput(response: ConvertedResponse): JsonValue[] {
  const messageParts: JsonValue[] = [];
  const textPart: JsonObject | undefined = response.text || response.refusal
    ? (response.refusal
      ? { type: "refusal", refusal: response.refusal }
      : { type: "output_text", text: response.text, annotations: response.textAnnotations ?? [] })
    : undefined;
  const messageEntries = response.outputOrder.filter((entry) => entry.kind === "message" || entry.kind === "media");
  if (response.messageItems.length > 1) {
    const messages = response.messageItems.map((item) => ({
      type: "message",
      ...(item.itemId ? { id: item.itemId } : {}),
      ...(item.outputIndex !== undefined ? { output_index: item.outputIndex } : {}),
      role: "assistant",
      content: item.parts,
    }));
    const reasoningItems = response.reasoningItems.map((item) => ({
      type: "reasoning",
      ...(item.itemId ? { id: item.itemId } : {}),
      ...(item.outputIndex !== undefined ? { output_index: item.outputIndex } : {}),
      summary: item.parts,
      ...(item.encryptedContent ? { encrypted_content: item.encryptedContent } : {}),
    }));
    const calls = new Map(response.toolCalls.map((call) => [call.callId, call]));
    const results = new Map(response.toolResults.map((result) => [result.callId, result]));
    const callLocation = (call: ConvertedResponse["toolCalls"][number]): JsonObject => ({ ...(call.itemId ? { id: call.itemId } : {}), ...(call.outputIndex !== undefined ? { output_index: call.outputIndex } : {}) });
    const resultLocation = (result: ConvertedResponse["toolResults"][number]): JsonObject => ({ ...(result.itemId ? { id: result.itemId } : {}), ...(result.outputIndex !== undefined ? { output_index: result.outputIndex } : {}) });
    const callItem = (call: ConvertedResponse["toolCalls"][number]): JsonObject => call.kind === "custom"
      ? { ...(call.raw ?? {}), type: "custom_tool_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool", input: customResponseInput(call.arguments) }
      : call.kind === "tool_search"
        ? { ...(call.raw ?? {}), type: "tool_search_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool_search", input: parseJsonObject(call.arguments) }
        : call.kind === "hosted" && call.raw ? { ...call.raw, ...callLocation(call), call_id: call.callId }
          : { ...(call.raw ?? {}), type: "function_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool", ...(call.namespace ? { namespace: call.namespace } : {}), arguments: call.arguments };
    const resultItem = (result: ConvertedResponse["toolResults"][number]): JsonObject => ({ ...(result.raw ?? {}), type: result.kind === "custom" ? "custom_tool_call_output" : result.kind === "tool_search" && (result.raw?.type === "tool_search_output" || result.raw?.type === "tool_search_call_output") ? result.raw.type : result.kind === "tool_search" ? "tool_search_call_output" : "function_call_output", ...resultLocation(result), call_id: result.callId, output: result.output, ...(result.isError !== undefined ? { is_error: result.isError } : {}) });
    const output: JsonValue[] = [];
    const usedMessages = new Set<number>();
    const usedReasoning = new Set<number>();
    const usedCalls = new Set<string>();
    const usedResults = new Set<string>();
    for (const entry of response.outputOrder) {
      if (entry.kind === "message" || entry.kind === "media") {
        const index = response.messageItems.findIndex((candidate, candidateIndex) => !usedMessages.has(candidateIndex)
          && ((entry.id !== undefined && candidate.itemId === entry.id) || (entry.index !== undefined && candidate.outputIndex === entry.index) || (entry.id === undefined && entry.index === undefined && candidateIndex === 0)));
        if (index >= 0) { output.push(messages[index]!); usedMessages.add(index); }
      } else if (entry.kind === "reasoning") {
        const index = response.reasoningItems.findIndex((candidate, candidateIndex) => !usedReasoning.has(candidateIndex)
          && ((entry.id !== undefined && candidate.itemId === entry.id) || (entry.index !== undefined && candidate.outputIndex === entry.index) || (entry.id === undefined && entry.index === undefined && candidateIndex === 0)));
        if (index >= 0) { output.push(reasoningItems[index]!); usedReasoning.add(index); }
      } else if (entry.kind === "tool_call" && entry.id && calls.has(entry.id) && !usedCalls.has(entry.id)) {
        output.push(callItem(calls.get(entry.id)!)); usedCalls.add(entry.id);
      } else if (entry.kind === "tool_result" && entry.id && results.has(entry.id) && !usedResults.has(entry.id)) {
        output.push(resultItem(results.get(entry.id)!)); usedResults.add(entry.id);
      }
    }
    for (let index = 0; index < messages.length; index += 1) if (!usedMessages.has(index)) output.push(messages[index]!);
    for (let index = 0; index < reasoningItems.length; index += 1) if (!usedReasoning.has(index)) output.push(reasoningItems[index]!);
    for (const call of response.toolCalls) if (!usedCalls.has(call.callId)) output.push(callItem(call));
    for (const result of response.toolResults) if (!usedResults.has(result.callId)) output.push(resultItem(result));
    return output;
  }
  if (messageEntries.length) {
    for (const entry of messageEntries) {
      if (entry.kind === "message" && textPart) messageParts.push(textPart);
      if (entry.kind === "media" && entry.index !== undefined && response.media[entry.index]) {
        const media = response.media[entry.index]!;
        messageParts.push({ ...media.media, type: media.mediaType === "image" ? "output_image" : "output_file" });
      }
    }
  } else {
    if (textPart) messageParts.push(textPart);
    for (const media of response.media) messageParts.push({ ...media.media, type: media.mediaType === "image" ? "output_image" : "output_file" });
  }
  const firstMedia = response.media[0];
  const message = messageParts.length ? {
    type: "message",
    ...((response.textItemId ?? firstMedia?.itemId) ? { id: response.textItemId ?? firstMedia?.itemId } : {}),
    ...((response.textOutputIndex ?? firstMedia?.outputIndex) !== undefined ? { output_index: response.textOutputIndex ?? firstMedia?.outputIndex } : {}),
    role: "assistant",
    content: messageParts,
  } : undefined;
  const reasoningItems = response.reasoningItems.length
    ? response.reasoningItems.map((item) => ({ type: "reasoning", ...(item.itemId ? { id: item.itemId } : {}), ...(item.outputIndex !== undefined ? { output_index: item.outputIndex } : {}), summary: item.parts, ...(item.encryptedContent ? { encrypted_content: item.encryptedContent } : {}) }))
    : response.reasoning || response.reasoningEncryptedContent
      ? [{ type: "reasoning", ...(response.reasoningItemId ? { id: response.reasoningItemId } : {}), ...(response.reasoningOutputIndex !== undefined ? { output_index: response.reasoningOutputIndex } : {}), summary: response.reasoning ? [{ type: "summary_text", text: response.reasoning, ...(response.reasoningSignature ? { signature: response.reasoningSignature } : {}) }] : [], ...(response.reasoningEncryptedContent ? { encrypted_content: response.reasoningEncryptedContent } : {}) }]
      : [];
  const reasoning = reasoningItems[0];
  const calls = new Map(response.toolCalls.map((call) => [call.callId, call]));
  const results = new Map(response.toolResults.map((result) => [result.callId, result]));
  const callLocation = (call: ConvertedResponse["toolCalls"][number]): JsonObject => ({ ...(call.itemId ? { id: call.itemId } : {}), ...(call.outputIndex !== undefined ? { output_index: call.outputIndex } : {}) });
  const resultLocation = (result: ConvertedResponse["toolResults"][number]): JsonObject => ({ ...(result.itemId ? { id: result.itemId } : {}), ...(result.outputIndex !== undefined ? { output_index: result.outputIndex } : {}) });
  const callItem = (call: ConvertedResponse["toolCalls"][number]): JsonObject => call.kind === "custom"
    ? { ...(call.raw ?? {}), type: "custom_tool_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool", input: customResponseInput(call.arguments) }
    : call.kind === "tool_search"
      ? { ...(call.raw ?? {}), type: "tool_search_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool_search", input: parseJsonObject(call.arguments) }
      : call.kind === "hosted" && call.raw ? { ...call.raw, ...callLocation(call), call_id: call.callId }
      : { ...(call.raw ?? {}), type: "function_call", ...callLocation(call), call_id: call.callId, name: call.name ?? "tool", ...(call.namespace ? { namespace: call.namespace } : {}), arguments: call.arguments };
  const resultItem = (result: ConvertedResponse["toolResults"][number]): JsonObject => ({
    ...(result.raw ?? {}),
    type: result.kind === "custom"
      ? "custom_tool_call_output"
      : result.kind === "tool_search" && (result.raw?.type === "tool_search_output" || result.raw?.type === "tool_search_call_output")
        ? result.raw.type
        : result.kind === "tool_search" ? "tool_search_call_output" : "function_call_output",
    ...resultLocation(result),
    call_id: result.callId,
    output: result.output,
    ...(result.isError !== undefined ? { is_error: result.isError } : {}),
  });
  if (!response.outputOrder.length) return [
    ...(message ? [message] : []),
    ...reasoningItems,
    ...response.toolCalls.map(callItem),
    ...response.toolResults.map(resultItem),
  ];
  const output: JsonValue[] = [];
  let messageInserted = false;
  const seenCalls = new Set<string>();
  const seenResults = new Set<string>();
  for (const entry of response.outputOrder) {
    if ((entry.kind === "message" || entry.kind === "media") && message && !messageInserted) {
      output.push(message);
      messageInserted = true;
    } else if (entry.kind === "reasoning") {
      const matching = reasoningItems.find((item, index) => (entry.id !== undefined && item.id === entry.id) || (entry.index !== undefined && item.output_index === entry.index) || (entry.id === undefined && entry.index === undefined && index === 0));
      if (matching && !output.includes(matching)) output.push(matching);
    } else if (entry.kind === "tool_call" && entry.id && calls.has(entry.id) && !seenCalls.has(entry.id)) {
      output.push(callItem(calls.get(entry.id)!));
      seenCalls.add(entry.id);
    } else if (entry.kind === "tool_result" && entry.id && results.has(entry.id) && !seenResults.has(entry.id)) {
      output.push(resultItem(results.get(entry.id)!));
      seenResults.add(entry.id);
    }
  }
  if (message && !messageInserted) output.push(message);
  for (const item of reasoningItems) if (!output.includes(item)) output.push(item);
  for (const call of response.toolCalls) if (!seenCalls.has(call.callId)) output.push(callItem(call));
  for (const result of response.toolResults) if (!seenResults.has(result.callId)) output.push(resultItem(result));
  return output;
}

export async function convertGatewayResponse(
  source: GatewayProtocol,
  target: GatewayProtocol,
  body: JsonObject,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<ConversionResult<JsonObject>> {
  const path = planConversion(source, target);
  const events = decodeResponseEvents(source, body, metadata);
  const diagnostics = diagnoseResponse(source, target, body);
  enforceToolLossPolicy(diagnostics, options.toolLossPolicy ?? "allow");
  // Compatibility routes may have to omit opaque/unsupported history items.
  // Keep that diagnostic visible in the same response envelope for both
  // streaming and non-streaming callers; injecting it as a canonical text
  // event avoids a second, legacy response formatter.
  if (options.warning) {
    const messageStart = events.findIndex((event) => event.type === "message_start");
    events.splice(Math.max(0, messageStart + 1), 0, { type: "text_delta", text: options.warning });
  }
  const value = encodeResponseEvents(target, events, metadata);
  const usage = decodeUsage(source, body) ?? (isObject(body.response) ? decodeUsage(source, body.response) : undefined);
  return { value, from: source, to: target, converterId: path.steps.map((step) => step.id).join("/"), quality: path.quality, steps: path.steps, diagnostics, ...(usage ? { usage: encodeUsage(target, usage) } : {}) };
}

function diagnoseResponse(source: GatewayProtocol, target: GatewayProtocol, body: JsonObject): ConversionDiagnostic[] {
  const diagnostics: ConversionDiagnostic[] = [];
  const eventType = asString(body.type);
  if (eventType && isUnknownResponseEvent(source, eventType)) {
    diagnostics.push({ code: "unknown_response_event", level: "warning", message: `Response event '${eventType}' has no canonical representation and was ignored`, source, target, path: "type" });
  }
  if (source === "chat_completions" && Array.isArray(body.choices) && body.choices.length > 1) {
    diagnostics.push({ code: "multiple_chat_choices_dropped", level: "warning", message: `The response contains ${body.choices.length} choices; the canonical response IR currently exposes the first choice only`, source, target, path: "choices" });
  }
  if (source === "gemini" && Array.isArray(body.candidates) && body.candidates.length > 1) {
    diagnostics.push({ code: "multiple_gemini_candidates_dropped", level: "warning", message: `The response contains ${body.candidates.length} candidates; the canonical response IR currently exposes the first candidate only`, source, target, path: "candidates" });
  }
  if (source === "responses") {
    const envelope = isObject(body.response) ? body.response : body;
    if (Array.isArray(envelope.output)) {
      const supported = new Set(["message", "reasoning", "function_call", "custom_tool_call", "tool_search_call", "function_call_output", "custom_tool_call_output", "tool_search_call_output", "tool_search_output"]);
      for (const item of envelope.output) {
        if (!isObject(item) || typeof item.type !== "string" || supported.has(item.type) || item.type.endsWith("_call")) continue;
        diagnostics.push({ code: "unknown_responses_output_item", level: "warning", message: `Responses output item '${String(item.type)}' has no canonical representation and was omitted`, source, target, path: "output" });
      }
    }
  }
  if (source === "anthropic" && Array.isArray(body.content)) {
    const supported = new Set(["text", "thinking", "redacted_thinking", "encrypted_thinking", "tool_use", "tool_result", "image", "document"]);
    for (const item of body.content) if (isObject(item) && typeof item.type === "string" && !supported.has(item.type)) {
      diagnostics.push({ code: "unknown_anthropic_content_block", level: "warning", message: `Anthropic content block '${item.type}' has no canonical representation and was omitted`, source, target, path: "content" });
    }
  }
  return diagnostics;
}

function isUnknownResponseEvent(source: GatewayProtocol, type: string): boolean {
  if (source === "responses") return !new Set([
    "response.created", "response.queued", "response.in_progress", "response.completed", "response.incomplete", "response.failed", "response.usage",
    "response.output_item.added", "response.output_item.done", "response.output_text.delta", "response.output_text.done", "response.output_text.annotation.added",
    "response.refusal.delta", "response.refusal.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_summary.done", "response.reasoning.done",
    "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.function_call_arguments.delta", "response.function_call_arguments.done",
    "response.custom_tool_call_input.delta", "response.custom_tool_call_input.done", "response.tool_search_call.delta", "response.tool_search_call.done",
    "response.tool_search_call_input.delta", "response.tool_search_call_input.done",
  ]).has(type);
  if (source === "anthropic") return !new Set(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]).has(type);
  return false;
}

function decodeResponses(body: JsonObject, events: ConversionResponseEvent[], metadata: ConversionMetadata): void {
  const envelope = isObject(body.response) ? body.response : body;
  const eventType = asString(body.type);
  if (eventType === "response.created" || eventType === "response.queued" || eventType === "response.in_progress" || eventType === "response.usage") return;
  if (eventType === "response.output_text.delta") {
    events.push({ type: "text_delta", text: asString(body.delta) ?? "", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.output_text.done") {
    events.push({ type: "text_delta", text: asString(body.text) ?? "", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.output_text.annotation.added") {
    const annotation = isObject(body.annotation) ? body.annotation : isObject(body.annotation_added) ? body.annotation_added : undefined;
    if (annotation) events.push({ type: "text_delta", text: "", annotations: [annotation], ...eventLocation(body), ...(typeof body.annotation_index === "number" ? { annotationIndex: body.annotation_index } : {}) });
    return;
  }
  if (eventType === "response.refusal.delta" || eventType === "response.refusal.done") {
    events.push({ type: "text_delta", text: "", refusal: asString(body.delta) ?? asString(body.refusal) ?? "", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.reasoning_summary_text.delta" || eventType === "response.reasoning_text.delta") {
    events.push({ type: "reasoning_delta", text: asString(body.delta) ?? "", ...(asString(body.signature) ? { signature: asString(body.signature) } : {}), ...(typeof body.summary_index === "number" ? { summaryIndex: body.summary_index } : {}), ...eventLocation(body) });
    return;
  }
  if (eventType === "response.reasoning_summary_text.done" || eventType === "response.reasoning_summary.done" || eventType === "response.reasoning.done") {
    events.push({ type: "reasoning_delta", text: asString(body.text) ?? "", ...(typeof body.summary_index === "number" ? { summaryIndex: body.summary_index } : {}), ...eventLocation(body) });
    return;
  }
  if (eventType === "response.reasoning_summary_part.added" || eventType === "response.reasoning_summary_part.done") {
    const part = isObject(body.part) ? body.part : undefined;
    events.push({ type: "reasoning_delta", text: asString(part?.text) ?? "", ...(asString(part?.data) ? { encryptedContent: asString(part?.data) } : asString(part?.encrypted_content) ? { encryptedContent: asString(part?.encrypted_content) } : {}), ...(typeof body.summary_index === "number" ? { summaryIndex: body.summary_index } : {}), ...eventLocation(body) });
    return;
  }
  if (eventType === "response.function_call_arguments.delta") {
    const name = restoreToolName(asString(body.name), metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: asString(body.delta) ?? "", kind: "function", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.function_call_arguments.done") {
    const name = restoreToolName(asString(body.name), metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: asString(body.arguments) ?? "", argumentsFinal: true, kind: "function", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.custom_tool_call_input.delta") {
    const name = restoreToolName(asString(body.name), metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: asString(body.delta) ?? "", kind: "custom", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.custom_tool_call_input.done") {
    const name = restoreToolName(asString(body.name), metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: customToolInput(body.input), argumentsFinal: true, kind: "custom", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.tool_search_call.delta" || eventType === "response.tool_search_call_input.delta") {
    const name = restoreToolName(asString(body.name) ?? "tool_search", metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: customToolInput(body.delta), kind: "tool_search", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.tool_search_call.done" || eventType === "response.tool_search_call_input.done") {
    const name = restoreToolName(asString(body.name) ?? "tool_search", metadata);
    events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? (name ? `name:${name}` : "call"), name, argumentsDelta: customToolInput(body.input ?? body.arguments), argumentsFinal: true, kind: "tool_search", ...eventLocation(body) });
    return;
  }
  if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
    const item = isObject(body.item) ? body.item : undefined;
    if (item) decodeResponsesToolItem(item, events, metadata, eventType === "response.output_item.done", typeof body.output_index === "number" ? body.output_index : undefined);
    return;
  }
  if (eventType === "response.completed" || eventType === "response.incomplete") {
    const response = isObject(body.response) ? body.response : undefined;
    const responseError = response && isObject(response.error) ? response.error : undefined;
    if (responseError) {
      events.push({ type: "error", code: asString(responseError.code) ?? "upstream_error", message: asString(responseError.message) ?? "The Responses upstream failed", retryable: isRetryableError(responseError), details: responseError });
      return;
    }
    if (response && Array.isArray(response.output)) decodeResponsesOutput(response.output, events, metadata, true);
    const incompleteDetails = response && isObject(response.incomplete_details) ? response.incomplete_details : isObject(body.incomplete_details) ? body.incomplete_details : undefined;
    const incompleteReason = asString(incompleteDetails?.reason);
    events.push({ type: "message_end", reason: eventType === "response.incomplete" ? incompleteReason ?? "incomplete" : "stop", ...(incompleteReason ? { incompleteReason } : {}), ...(isObject(incompleteDetails) ? { incompleteDetails } : {}), ...(response && asString(response.status) ? { status: asString(response.status) } : {}), ...(response && isObject(response.metadata) ? { metadata: response.metadata } : {}) });
    return;
  }
  if (eventType === "response.failed") {
    const error = isObject(body.error) ? body.error : isObject(body.response) && isObject(body.response.error) ? body.response.error : {};
    events.push({ type: "error", code: asString(error.code) ?? "upstream_error", message: asString(error.message) ?? "The Responses upstream failed", retryable: isRetryableError(error), details: error });
    return;
  }
  const output = Array.isArray(envelope.output) ? envelope.output : [];
  if (isObject(envelope.error)) {
    events.push({ type: "error", code: asString(envelope.error.code) ?? "upstream_error", message: asString(envelope.error.message) ?? "The Responses upstream failed", retryable: isRetryableError(envelope.error), details: envelope.error });
    return;
  }
  decodeResponsesOutput(output, events, metadata);
  const incompleteDetails = isObject(envelope.incomplete_details) ? envelope.incomplete_details : undefined;
  const incompleteReason = asString(incompleteDetails?.reason);
  events.push({ type: "message_end", ...(asString(envelope.status) === "incomplete" ? { reason: incompleteReason ?? "incomplete", ...(incompleteReason ? { incompleteReason } : {}), ...(isObject(incompleteDetails) ? { incompleteDetails } : {}) } : { reason: asString(envelope.status) === "completed" ? "stop" : undefined }), ...(asString(envelope.status) ? { status: asString(envelope.status) } : {}), ...(isObject(envelope.metadata) ? { metadata: envelope.metadata } : {}) });
}

function decodeResponsesOutput(output: JsonValue[], events: ConversionResponseEvent[], metadata: ConversionMetadata, final = false): void {
  for (const [outputIndex, item] of output.entries()) {
    if (!isObject(item)) continue;
    const type = asString(item.type);
    if (type === "message") {
      for (const part of array(item.content)) decodeContentPart(part, events, undefined, undefined, itemLocation(item));
    } else if (type === "reasoning") {
      const reasoningParts = array(item.summary).length ? array(item.summary) : array(item.content);
      for (const part of reasoningParts) {
        if (isObject(part) && asString(part.text ?? part.reasoning_text)) events.push({ type: "reasoning_delta", text: asString(part.text ?? part.reasoning_text) ?? "", ...(asString(part.signature) ? { signature: asString(part.signature) } : {}), ...itemLocation(item) });
      }
      if (asString(item.encrypted_content)) events.push({ type: "reasoning_delta", text: "", encryptedContent: asString(item.encrypted_content), ...itemLocation(item) });
    } else if (type === "function_call") {
      const wireName = asString(item.name);
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, item, metadata);
      events.push({ type: "tool_call_delta", callId: asString(item.call_id) ?? asString(item.id) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: normalizeToolArguments(item.arguments) ?? "", argumentsFinal: true, kind: restoreToolKind(wireName, "function", metadata), raw: item, ...itemLocation(item) });
    } else if (type === "custom_tool_call") {
      const wireName = asString(item.name);
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, item, metadata);
      events.push({ type: "tool_call_delta", callId: asString(item.call_id) ?? asString(item.id) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item.input), ...(final ? { argumentsFinal: true } : {}), kind: "custom", raw: item, ...itemLocation(item) });
    } else if (type === "tool_search_call") {
      const wireName = asString(item.name);
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, item, metadata);
      events.push({ type: "tool_call_delta", callId: asString(item.call_id) ?? asString(item.id) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item.input ?? item.arguments), ...(final ? { argumentsFinal: true } : {}), kind: "tool_search", raw: item, ...itemLocation(item) });
    } else if (type === "function_call_output" || type === "custom_tool_call_output" || type === "tool_search_call_output" || type === "tool_search_output") {
      const callId = asString(item.call_id) ?? asString(item.id) ?? "call";
      events.push({ type: "tool_result", callId, ...(asString(item.name) ? { name: asString(item.name) } : {}), output: item.output ?? item.content ?? "", ...(typeof item.is_error === "boolean" ? { isError: item.is_error } : {}), kind: type === "custom_tool_call_output" ? "custom" : type.startsWith("tool_search") ? "tool_search" : "function", raw: item, ...itemLocation(item) });
    } else if (type?.endsWith("_call") && type !== "function_call") {
      const wireName = asString(item.name) ?? type;
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, item, metadata);
      events.push({ type: "tool_call_delta", callId: asString(item.call_id) ?? asString(item.id) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item), ...(final ? { argumentsFinal: true } : {}), kind: restoreToolKind(wireName, "hosted", metadata), raw: item, ...itemLocation(item) });
    }
  }
}

function decodeResponsesToolItem(item: JsonObject, events: ConversionResponseEvent[], metadata: ConversionMetadata, final: boolean, eventOutputIndex?: number): void {
  const type = asString(item.type);
  const location = itemLocation(item, eventOutputIndex);
  if (type === "message") {
    for (const part of array(item.content)) decodeContentPart(part, events, undefined, undefined, location);
    return;
  }
  if (type === "reasoning") {
    const reasoningParts = array(item.summary).length ? array(item.summary) : array(item.content);
    for (const part of reasoningParts) {
      if (isObject(part)) {
        const text = asString(part.text ?? part.reasoning_text);
        const signature = asString(part.signature);
        if (text !== undefined || signature) events.push({ type: "reasoning_delta", text: text ?? "", ...(signature ? { signature } : {}), ...location });
      }
    }
    if (asString(item.encrypted_content)) events.push({ type: "reasoning_delta", text: "", encryptedContent: asString(item.encrypted_content), ...location });
    return;
  }
  const wireName = asString(item.name) ?? (type?.endsWith("_call") ? type : undefined);
  const name = restoreToolName(wireName, metadata);
  const callId = asString(item.call_id) ?? asString(item.id) ?? (name ? `name:${name}` : "call");
  if (type === "function_call") {
    const namespace = restoreToolNamespace(wireName, item, metadata);
      events.push({ type: "tool_call_delta", callId, name, ...(namespace ? { namespace } : {}), argumentsDelta: asString(item.arguments) ?? "", ...(final ? { argumentsFinal: true } : {}), kind: restoreToolKind(wireName, "function", metadata), raw: item, ...location });
  } else if (type === "custom_tool_call") {
    const namespace = restoreToolNamespace(wireName, item, metadata);
    events.push({ type: "tool_call_delta", callId, name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item.input), ...(final ? { argumentsFinal: true } : {}), kind: "custom", raw: item, ...location });
  } else if (type === "tool_search_call") {
    const namespace = restoreToolNamespace(wireName, item, metadata);
    events.push({ type: "tool_call_delta", callId, name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item.input ?? item.arguments), ...(final ? { argumentsFinal: true } : {}), kind: "tool_search", raw: item, ...location });
  } else if (type === "function_call_output" || type === "custom_tool_call_output" || type === "tool_search_call_output" || type === "tool_search_output") {
    events.push({ type: "tool_result", callId: asString(item.call_id) ?? asString(item.id) ?? "call", ...(asString(item.name) ? { name: asString(item.name) } : {}), output: item.output ?? item.content ?? "", ...(typeof item.is_error === "boolean" ? { isError: item.is_error } : {}), kind: type === "custom_tool_call_output" ? "custom" : type.startsWith("tool_search") ? "tool_search" : "function", raw: item, ...location });
  } else if (type?.endsWith("_call")) {
    const namespace = restoreToolNamespace(wireName, item, metadata);
    events.push({ type: "tool_call_delta", callId, name, ...(namespace ? { namespace } : {}), argumentsDelta: customToolInput(item), ...(final ? { argumentsFinal: true } : {}), kind: restoreToolKind(wireName, "hosted", metadata), raw: item, ...location });
  }
}

function decodeChat(body: JsonObject, events: ConversionResponseEvent[], metadata: ConversionMetadata): void {
  const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : undefined;
  const message = choice && isObject(choice.message) ? choice.message : choice && isObject(choice.delta) ? choice.delta : undefined;
  if (message) {
    const refusal = asString(message.refusal);
    decodeContentPart(message.content, events, Array.isArray(message.annotations) ? message.annotations : undefined, refusal);
    // Chat Completions represents a refusal as a sibling of `content`, and
    // many providers set content to null. `decodeContentPart(undefined, …)`
    // intentionally emits nothing, so preserve the refusal explicitly.
    if (refusal && (message.content === undefined || message.content === null)) events.push({ type: "text_delta", text: "", refusal });
    if (asString(message.reasoning_content)) events.push({ type: "reasoning_delta", text: asString(message.reasoning_content) ?? "", ...(asString(message.reasoning_signature) ? { signature: asString(message.reasoning_signature) } : {}) });
    if (asString(message.reasoning)) events.push({ type: "reasoning_delta", text: asString(message.reasoning) ?? "", ...(asString(message.reasoning_signature) ? { signature: asString(message.reasoning_signature) } : {}) });
    for (const call of array(message.tool_calls)) if (isObject(call)) {
      // Standard Chat nests these fields under `function`, while some
      // OpenAI-compatible providers put `name`/`arguments` on the call itself.
      const fn = isObject(call.function) ? call.function : call;
      const wireName = asString(fn.name);
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, call, metadata);
      const index = typeof call.index === "number" && Number.isFinite(call.index) ? call.index : undefined;
      events.push({ type: "tool_call_delta", callId: asString(call.id) ?? (index !== undefined ? `index:${index}` : undefined) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: argumentDelta(fn.arguments), kind: restoreToolKind(wireName, "function", metadata), ...(index !== undefined ? { index } : {}) });
    }
    for (const rawResult of array(message.tool_results)) if (isObject(rawResult)) {
      const callId = asString(rawResult.tool_call_id) ?? asString(rawResult.call_id);
      if (callId) events.push({ type: "tool_result", callId, ...(asString(rawResult.name) ? { name: asString(rawResult.name) } : {}), output: rawResult.content ?? rawResult.output ?? "", ...(typeof rawResult.is_error === "boolean" ? { isError: rawResult.is_error } : {}), kind: "function", raw: rawResult });
    }
    if (isObject(message.function_call)) {
      const wireName = asString(message.function_call.name);
      const name = restoreToolName(wireName, metadata);
      const namespace = restoreToolNamespace(wireName, message.function_call, metadata);
      events.push({ type: "tool_call_delta", callId: asString(message.function_call.id) ?? (name ? `name:${name}` : "call"), name, ...(namespace ? { namespace } : {}), argumentsDelta: argumentDelta(message.function_call.arguments), kind: restoreToolKind(wireName, "function", metadata) });
    }
  }
  const finish = choice ? asString(choice.finish_reason) : undefined;
  if (finish) events.push({ type: "message_end", reason: finish, ...(isIncompleteReason(finish) ? { incompleteReason: finish } : {}) });
}

function decodeAnthropic(body: JsonObject, events: ConversionResponseEvent[], metadata: ConversionMetadata): void {
  const eventType = asString(body.type);
  if (eventType === "message_start") {
    const message = isObject(body.message) ? body.message : {};
    events.push({
      type: "message_start",
      responseId: asString(message.id) ?? asString(body.id) ?? "response",
      role: "assistant",
      ...(asString(message.model) ? { model: asString(message.model) } : {}),
      ...(asString(message.stop_reason) ? { status: asString(message.stop_reason) } : {}),
    });
    return;
  }
  if (eventType === "content_block_delta" && isObject(body.delta)) {
    const deltaType = asString(body.delta.type);
    if (deltaType === "text_delta") events.push({ type: "text_delta", text: asString(body.delta.text) ?? "" });
    else if (deltaType === "citations_delta" && body.delta.citation !== undefined) events.push({ type: "text_delta", text: "", annotations: [isObject(body.delta.citation) ? body.delta.citation : { type: "citation", value: body.delta.citation }] });
    else if (deltaType === "thinking_delta") events.push({ type: "reasoning_delta", text: asString(body.delta.thinking) ?? "", ...(asString(body.delta.signature) ? { signature: asString(body.delta.signature) } : {}) });
    else if (deltaType === "signature_delta") events.push({ type: "reasoning_delta", text: "", ...(asString(body.delta.signature) ? { signature: asString(body.delta.signature) } : {}) });
    else if (deltaType === "input_json_delta") events.push({ type: "tool_call_delta", callId: typeof body.index === "number" ? String(body.index) : asString(body.index) ?? "call", argumentsDelta: asString(body.delta.partial_json) ?? "", ...(typeof body.index === "number" ? { index: body.index } : {}) });
    return;
  }
  if (eventType === "content_block_start" && isObject(body.content_block)) {
    const block = body.content_block;
    if (asString(block.type) === "tool_use") events.push({ type: "tool_call_delta", callId: asString(block.id) ?? "call", name: restoreToolName(asString(block.name), metadata), argumentsDelta: "", kind: "function", ...(typeof body.index === "number" ? { index: body.index } : {}) });
    else if (asString(block.type) === "tool_result") events.push({ type: "tool_result", callId: asString(block.tool_use_id) ?? "call", output: block.content ?? "", ...(typeof block.is_error === "boolean" ? { isError: block.is_error } : {}), kind: "function", raw: block });
    else if (asString(block.type) === "thinking" && (asString(block.thinking) || asString(block.signature))) events.push({ type: "reasoning_delta", text: asString(block.thinking) ?? "", ...(asString(block.signature) ? { signature: asString(block.signature) } : {}) });
    else if (asString(block.type) === "redacted_thinking" || asString(block.type) === "encrypted_thinking") events.push({ type: "reasoning_delta", text: "", encryptedContent: asString(block.data) ?? asString(block.encrypted_content) ?? "" });
    return;
  }
  if (eventType === "content_block_stop" && asString(body.signature)) {
    events.push({ type: "reasoning_delta", text: "", signature: asString(body.signature) });
    return;
  }
  if (eventType === "message_delta") {
    const delta = isObject(body.delta) ? body.delta : {};
    const stopReason = asString(delta.stop_reason) ?? asString(body.stop_reason);
    if (stopReason) events.push({ type: "message_end", reason: stopReason, ...(isIncompleteReason(stopReason) ? { incompleteReason: stopReason } : {}) });
    return;
  }
  if (eventType === "message_stop") {
    events.push({ type: "message_end", reason: "stop" });
    return;
  }
  for (const part of array(body.content)) {
    if (!isObject(part)) continue;
    const type = asString(part.type);
    if (type === "thinking") events.push({ type: "reasoning_delta", text: asString(part.thinking) ?? "", ...(asString(part.signature) ? { signature: asString(part.signature) } : {}) });
    else if (type === "redacted_thinking" || type === "encrypted_thinking") events.push({ type: "reasoning_delta", text: "", encryptedContent: asString(part.data) ?? asString(part.encrypted_content) ?? asString(part.thinking) ?? "" });
    else if (type === "tool_use") events.push({ type: "tool_call_delta", callId: asString(part.id) ?? "call", name: restoreToolName(asString(part.name), metadata), argumentsDelta: normalizeToolArguments(part.input) ?? "", kind: "function" });
    else if (type === "tool_result") events.push({ type: "tool_result", callId: asString(part.tool_use_id) ?? "call", output: part.content ?? "", ...(typeof part.is_error === "boolean" ? { isError: part.is_error } : {}), kind: "function", raw: part });
    else decodeContentPart(part, events);
  }
  const stopReason = asString(body.stop_reason);
  if (stopReason) events.push({ type: "message_end", reason: stopReason, ...(isIncompleteReason(stopReason) ? { incompleteReason: stopReason } : {}) });
}

function decodeGemini(body: JsonObject, events: ConversionResponseEvent[], metadata: ConversionMetadata): void {
  const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : undefined;
  const content = candidate && isObject(candidate.content) ? candidate.content : undefined;
  const functionCallIds = new Map<string, number>();
  // Gemini's functionResponse normally identifies a call by function name,
  // while newer providers may add an opaque id. Keep a FIFO queue per name so
  // parallel calls with the same name are paired in first-seen order instead
  // of all responses being attached to the last call.
  const functionCallByName = new Map<string, string[]>();
  for (const part of content ? array(content.parts) : []) {
    if (!isObject(part)) continue;
    if (part.thought === true) events.push({ type: "reasoning_delta", text: asString(part.text) ?? "", ...(asString(part.thoughtSignature) ? { signature: asString(part.thoughtSignature) } : {}) });
    else if (isObject(part.functionCall)) {
      const name = restoreToolName(asString(part.functionCall.name), metadata);
      const baseId = asString(part.functionCall.id) ?? (name ? `name:${name}` : "call");
      const occurrence = functionCallIds.get(baseId) ?? 0;
      functionCallIds.set(baseId, occurrence + 1);
      const callId = occurrence === 0 ? baseId : `${baseId}:${occurrence}`;
      const queue = functionCallByName.get(asString(part.functionCall.name) ?? "tool") ?? [];
      queue.push(callId);
      functionCallByName.set(asString(part.functionCall.name) ?? "tool", queue);
      events.push({ type: "tool_call_delta", callId, name, argumentsDelta: normalizeToolArguments(part.functionCall.args) ?? "", ...(asString(part.thoughtSignature) ? { signature: asString(part.thoughtSignature) } : {}), kind: "function", raw: part });
    } else if (isObject(part.functionResponse)) {
      const functionName = asString(part.functionResponse.name);
      const explicitCallId = asString(part.functionResponse.call_id) ?? asString(part.functionResponse.id);
      const queue = functionName ? functionCallByName.get(functionName) ?? [] : [];
      const pairedCallId = explicitCallId ?? queue.shift() ?? (functionName ? `name:${functionName}` : "call");
      if (functionName) functionCallByName.set(functionName, queue);
      events.push({ type: "tool_result", callId: pairedCallId, ...(functionName ? { name: functionName } : {}), output: part.functionResponse.response ?? {}, ...(typeof part.functionResponse.isError === "boolean" ? { isError: part.functionResponse.isError } : {}), kind: "function", raw: part });
    }
    else decodeContentPart(part, events);
  }
  const finishReason = candidate ? asString(candidate.finishReason) : undefined;
  if (finishReason) events.push({ type: "message_end", reason: finishReason, ...(isIncompleteReason(finishReason) ? { incompleteReason: finishReason } : {}) });
}

function decodeContentPart(value: JsonValue | undefined, events: ConversionResponseEvent[], annotations?: JsonValue[], refusal?: string, location?: { itemId?: string; outputIndex?: number }): void {
  if (typeof value === "string") { events.push({ type: "text_delta", text: value, ...(annotations?.length ? { annotations } : {}), ...(refusal ? { refusal } : {}), ...(location ?? {}) }); return; }
  if (Array.isArray(value)) { for (const part of value) decodeContentPart(part, events, annotations, refusal, location); return; }
  if (!isObject(value)) return;
  const type = asString(value.type);
  const text = asString(value.text ?? value.output_text ?? value.input_text);
  // Anthropic calls inline citations `citations`, while Responses/Chat use
  // `annotations`. Normalize the container without rewriting the citation
  // payload so a downstream protocol can still inspect provider metadata.
  const citationAnnotations = Array.isArray(value.citations)
    ? value.citations.map((citation) => isObject(citation) ? (typeof citation.type === "string" ? citation : { type: "citation", ...citation }) : { type: "citation", value: citation })
    : [];
  const partAnnotations = Array.isArray(value.annotations)
    ? value.annotations
    : citationAnnotations.length ? citationAnnotations : annotations;
  const partRefusal = asString(value.refusal) ?? refusal;
  if (text !== undefined || partRefusal) events.push({ type: "text_delta", text: text ?? "", ...(partAnnotations?.length ? { annotations: partAnnotations } : {}), ...(partRefusal ? { refusal: partRefusal } : {}), ...(location ?? {}) });
  if (type === "output_image" || type === "image" || type === "image_url" || isObject(value.image_url) || isObject(value.inlineData) || isObject(value.source) && asString(value.source.type) === "url") events.push({ type: "media", mediaType: "image", media: value, ...(location ?? {}) });
  else if (type === "output_file" || type === "file" || type === "document" || isObject(value.file) || isObject(value.fileData) || isObject(value.source) && asString(value.source.media_type)) events.push({ type: "media", mediaType: "file", media: value, ...(location ?? {}) });
}

function collectResponse(events: readonly ConversionResponseEvent[], metadata: ConversionMetadata): ConvertedResponse {
  const first = events.find((event): event is Extract<ConversionResponseEvent, { type: "message_start" }> => event.type === "message_start");
  const result: ConvertedResponse = { responseId: first?.responseId ?? metadata.requestId ?? "response", text: "", reasoning: "", media: [], messageItems: [], reasoningItems: [], toolCalls: [], toolResults: [], outputOrder: [], invalidToolCalls: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ...(first?.createdAt !== undefined ? { createdAt: first.createdAt } : {}), ...(first?.status ? { status: first.status } : {}) };
  const seenOrder = new Set<string>();
  const remember = (entry: { kind: "message" | "reasoning" | "media" | "tool_call" | "tool_result"; id?: string; index?: number }): void => {
    const key = `${entry.kind}:${entry.id ?? entry.index ?? "single"}`;
    if (!seenOrder.has(key)) { seenOrder.add(key); result.outputOrder.push(entry); }
  };
  const calls = new Map<string, { callId: string; name?: string; namespace?: string; arguments: string; signature?: string; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }>();
  const messageBuckets = new Map<string, { itemId?: string; outputIndex?: number; parts: JsonValue[] }>();
  const reasoningBuckets = new Map<string, { itemId?: string; outputIndex?: number; parts: JsonValue[]; encryptedContent?: string }>();
  const bucketFor = (itemId?: string, outputIndex?: number): { itemId?: string; outputIndex?: number; parts: JsonValue[] } => {
    const key = `${itemId ?? "default"}:${outputIndex ?? ""}`;
    const existing = messageBuckets.get(key);
    if (existing) return existing;
    const created = { ...(itemId ? { itemId } : {}), ...(outputIndex !== undefined ? { outputIndex } : {}), parts: [] as JsonValue[] };
    messageBuckets.set(key, created);
    return created;
  };
  const reasoningBucketFor = (itemId?: string, outputIndex?: number): { itemId?: string; outputIndex?: number; parts: JsonValue[]; encryptedContent?: string } => {
    const key = `${itemId ?? "default"}:${outputIndex ?? ""}`;
    const existing = reasoningBuckets.get(key);
    if (existing) return existing;
    const created = { ...(itemId ? { itemId } : {}), ...(outputIndex !== undefined ? { outputIndex } : {}), parts: [] as JsonValue[] };
    reasoningBuckets.set(key, created);
    return created;
  };
  for (const event of events) {
    if (event.type === "text_delta") {
      result.text += event.text;
      result.textItemId ??= event.itemId;
      result.textOutputIndex ??= event.outputIndex;
      result.textContentIndex ??= event.contentIndex;
      if (event.annotations?.length) result.textAnnotations = [...(result.textAnnotations ?? []), ...event.annotations];
      if (event.refusal) result.refusal = result.refusal ? `${result.refusal}${event.refusal}` : event.refusal;
      if (event.text || event.refusal || event.annotations?.length) {
        const bucket = bucketFor(event.itemId, event.outputIndex);
        const part: JsonObject = event.refusal
          ? { type: "refusal", refusal: event.refusal }
          : { type: "output_text", text: event.text, annotations: event.annotations ?? [] };
        bucket.parts.push(part);
      }
      if (event.text || event.refusal) remember({ kind: "message", id: event.itemId });
    } else if (event.type === "reasoning_delta") {
      result.reasoning += event.text;
      result.reasoningItemId ??= event.itemId;
      result.reasoningOutputIndex ??= event.outputIndex;
      result.reasoningSummaryIndex ??= event.summaryIndex;
      if (event.signature) result.reasoningSignature = event.signature;
      if (event.encryptedContent) result.reasoningEncryptedContent = event.encryptedContent;
      if (event.text || event.signature || event.encryptedContent) {
        const bucket = reasoningBucketFor(event.itemId, event.outputIndex);
        if (event.text || event.signature) bucket.parts.push({ type: "summary_text", text: event.text, ...(event.signature ? { signature: event.signature } : {}) });
        if (event.encryptedContent) bucket.encryptedContent = event.encryptedContent;
        remember({ kind: "reasoning", id: event.itemId, index: event.outputIndex });
      }
    } else if (event.type === "media") {
      const index = result.media.length;
      result.media.push({ mediaType: event.mediaType, media: event.media, ...(event.itemId ? { itemId: event.itemId } : {}), ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}) });
      const bucket = bucketFor(event.itemId, event.outputIndex);
      bucket.parts.push({ ...event.media, type: event.mediaType === "image" ? "output_image" : "output_file" });
      remember({ kind: "media", id: event.itemId, index });
    } else if (event.type === "tool_call_delta") {
      const call = calls.get(event.callId) ?? { callId: event.callId, name: event.name, namespace: event.namespace, arguments: "", kind: event.kind, raw: event.raw, itemId: event.itemId, outputIndex: event.outputIndex };
      call.name ??= event.name; call.namespace ??= event.namespace; call.kind ??= event.kind; call.signature ??= event.signature; call.raw ??= event.raw; call.itemId ??= event.itemId; call.outputIndex ??= event.outputIndex;
      call.arguments = event.argumentsFinal ? event.argumentsDelta ?? "" : call.arguments + (event.argumentsDelta ?? ""); calls.set(event.callId, call); remember({ kind: "tool_call", id: event.callId });
    } else if (event.type === "tool_result") {
      result.toolResults.push({ callId: event.callId, ...(event.name ? { name: event.name } : {}), output: event.output, ...(event.isError !== undefined ? { isError: event.isError } : {}), kind: event.kind, raw: event.raw, ...(event.itemId ? { itemId: event.itemId } : {}), ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}) });
      remember({ kind: "tool_result", id: event.callId });
    }
    else if (event.type === "usage") result.usage = event.usage;
    else if (event.type === "message_end") { result.endReason = event.reason; result.incompleteReason = event.incompleteReason; result.incompleteDetails ??= event.incompleteDetails; result.status ??= event.status; }
  }
  result.toolCalls = [...calls.values()].flatMap((call) => {
    const argumentsText = validToolArguments(call.arguments, call.kind);
    if (!call.name || !argumentsText) {
      result.invalidToolCalls += 1;
      return [];
    }
    return [{ ...call, arguments: argumentsText }];
  });
  result.messageItems = [...messageBuckets.values()];
  result.reasoningItems = [...reasoningBuckets.values()];
  return result;
}

function firstResponseMetadata(events: readonly ConversionResponseEvent[]): JsonObject | undefined {
  return events.find((event): event is Extract<ConversionResponseEvent, { type: "message_start" }> => event.type === "message_start")?.metadata;
}

function encodeError(protocol: GatewayProtocol, error: Extract<ConversionResponseEvent, { type: "error" }>): JsonObject {
  const detailType = asString(error.details?.type);
  const common = { ...(error.details ?? {}), code: error.code, message: error.message, retryable: error.retryable };
  if (protocol === "anthropic") return { type: "error", error: { ...common, type: detailType ?? error.code } };
  if (protocol === "gemini") return { error: { ...common, status: "FAILED" } };
  return { error: { ...common, type: detailType ?? "gateway_error" } };
}

function isRetryableError(error: JsonObject): boolean {
  const status = typeof error.status === "number" ? error.status : typeof error.status_code === "number" ? error.status_code : undefined;
  if (status !== undefined) return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  const code = `${asString(error.code) ?? ""} ${asString(error.type) ?? ""}`.toLowerCase();
  return /rate|timeout|temporar|overload|unavailable|capacity|server_error|internal/.test(code);
}

function isIncompleteReason(reason: string): boolean {
  return ["length", "max_tokens", "max_output_tokens", "max_tokens_exceeded", "content_filter", "safety", "MAX_TOKENS", "SAFETY"].includes(reason);
}

function parseJsonObject(value: string): JsonObject { try { const parsed: unknown = JSON.parse(value); return isObject(parsed as JsonValue) ? parsed as JsonObject : {}; } catch { return {}; } }
function argumentDelta(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  return isObject(value) ? JSON.stringify(value) : "";
}
function customToolInput(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}
function customResponseInput(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    const object = isObject(parsed as JsonValue) ? parsed as JsonObject : undefined;
    if (object && typeof object.input === "string") return object.input;
  } catch { /* keep the original free-form value */ }
  return value;
}
function eventLocation(body: JsonObject): { itemId?: string; outputIndex?: number } {
  return {
    ...(asString(body.item_id) ? { itemId: asString(body.item_id) } : {}),
    ...(typeof body.output_index === "number" ? { outputIndex: body.output_index } : {}),
  };
}
function itemLocation(item: JsonObject, fallbackOutputIndex?: number): { itemId?: string; outputIndex?: number } {
  return {
    ...(asString(item.id) ? { itemId: asString(item.id) } : {}),
    ...(typeof item.output_index === "number" ? { outputIndex: item.output_index } : fallbackOutputIndex !== undefined ? { outputIndex: fallbackOutputIndex } : {}),
  };
}
function validToolArguments(value: string, kind: "function" | "custom" | "tool_search" | "hosted" | undefined): string | undefined {
  if (!value.trim()) return undefined;
  if (kind === "custom") return value;
  return normalizeToolArguments(value);
}
function isJsonObjectText(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed as JsonValue);
  } catch {
    return false;
  }
}
function responseId(protocol: GatewayProtocol, body: JsonObject): string {
  if (isObject(body.response)) return asString(body.response.id) ?? asString(body.id) ?? `${protocol}-response`;
  return asString(body.id) ?? asString(body.responseId) ?? `${protocol}-response`;
}
function restoreToolName(name: string | undefined, metadata: ConversionMetadata): string | undefined {
  return name === undefined ? undefined : metadata.toolNameMap?.[name] ?? name;
}
function restoreToolNamespace(name: string | undefined, item: JsonObject | undefined, metadata: ConversionMetadata): string | undefined {
  if (name === undefined) return undefined;
  return metadata.toolNamespaceMap?.[name] ?? (item && asString(item.namespace));
}
function restoreToolKind(name: string | undefined, fallback: "function" | "custom" | "tool_search" | "hosted", metadata: ConversionMetadata): "function" | "custom" | "tool_search" | "hosted" {
  const kind = name ? metadata.toolKindMap?.[name] : undefined;
  return kind === "custom" || kind === "tool_search" || kind === "hosted" ? kind : fallback;
}
function array(value: JsonValue | undefined): JsonValue[] { return Array.isArray(value) ? value : []; }
function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
