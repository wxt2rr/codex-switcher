import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import {
  type GatewayMessage,
  type GatewayMessagePart,
  type GatewayRequestContext,
  type GatewayRequestParameters,
  type GatewayRequestIR,
  type GatewayToolDefinition,
} from "../request/request-ir.js";
import type { GatewayResponseEvent } from "../response/response-ir.js";
import { decodeTools, encodeTools, type CanonicalTool } from "../conversion/tool-converter.js";
import { normalizeGeminiWire } from "../conversion/gemini-normalizer.js";
import { decodeReasoning, encodeReasoning } from "../conversion/reasoning-converter.js";
import { decodeResponseEvents as decodeCanonicalResponseEvents, encodeResponseEvents as encodeCanonicalResponseEvents, type ConversionResponseEvent } from "../conversion/response-converter.js";

export interface GatewayProtocolCodec {
  readonly protocol: GatewayProtocol;
  decodeRequest(body: JsonObject, context: GatewayRequestContext): GatewayRequestIR;
  encodeRequest(request: GatewayRequestIR, upstreamModel?: string): JsonObject;
  decodeResponse(body: JsonObject): GatewayResponseEvent[];
  encodeResponse(events: GatewayResponseEvent[]): JsonObject;
}

export function decodeGatewayRequest(
  protocol: GatewayProtocol,
  body: JsonObject,
  context: GatewayRequestContext,
): GatewayRequestIR {
  return codecFor(protocol).decodeRequest(body, context);
}

export function encodeGatewayRequest(
  protocol: GatewayProtocol,
  request: GatewayRequestIR,
  upstreamModel?: string,
): JsonObject {
  return codecFor(protocol).encodeRequest(request, upstreamModel);
}

export function decodeGatewayResponse(protocol: GatewayProtocol, body: JsonObject): GatewayResponseEvent[] {
  return codecFor(protocol).decodeResponse(body);
}

export function encodeGatewayResponse(protocol: GatewayProtocol, events: GatewayResponseEvent[]): JsonObject {
  return codecFor(protocol).encodeResponse(events);
}

export function parseSseData(protocol: GatewayProtocol, data: string): GatewayResponseEvent[] {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return [{ type: "message_end", reason: "stop" }];
  try { return decodeGatewayResponse(protocol, JSON.parse(trimmed) as JsonObject); } catch {
    return [{ type: "error", code: "INVALID_STREAM_CHUNK", message: "Upstream returned invalid JSON", retryable: false }];
  }
}

function codecFor(protocol: GatewayProtocol): GatewayProtocolCodec {
  return new Codec(protocol);
}

class Codec implements GatewayProtocolCodec {
  constructor(public readonly protocol: GatewayProtocol) {}

  decodeRequest(body: JsonObject, context: GatewayRequestContext): GatewayRequestIR {
    const wireBody = this.protocol === "gemini" ? normalizeGeminiWire(body) : body;
    const messages = this.protocol === "responses"
      ? messagesFromResponses(wireBody)
      : this.protocol === "chat_completions"
        ? messagesFromChat(wireBody)
        : this.protocol === "anthropic"
          ? messagesFromAnthropic(wireBody)
          : messagesFromGemini(wireBody);
    const tools = [
      ...decodeTools(this.protocol, wireBody.tools),
      ...(this.protocol === "chat_completions" && isRecord(wireBody.web_search_options)
        ? [{ kind: "web_search" as const, name: "web_search", raw: { type: "web_search_options", web_search_options: wireBody.web_search_options } }]
        : []),
    ].map(toGatewayTool);
    const decodedReasoning = decodeReasoning(this.protocol, wireBody);
    const reasoning = decodedReasoning ? { ...decodedReasoning } as JsonObject : undefined;
    const parameters = decodeRequestParameters(this.protocol, wireBody);
    return {
      context,
      messages,
      tools,
      stream: body.stream === true,
      ...(wireBody.tool_choice !== undefined ? { toolChoice: wireBody.tool_choice } : wireBody.toolConfig !== undefined ? { toolChoice: wireBody.toolConfig } : {}),
      ...(typeof wireBody.parallel_tool_calls === "boolean" ? { parallelToolCalls: wireBody.parallel_tool_calls } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(Object.keys(parameters).length ? { parameters } : {}),
      metadata: compactObject({
        ...(typeof wireBody.user === "string" ? { user: wireBody.user } : {}),
        ...(typeof wireBody.previous_response_id === "string" ? { previousResponseId: wireBody.previous_response_id } : {}),
      }),
    };
  }

  encodeRequest(request: GatewayRequestIR, upstreamModel = request.context.logicalModelId): JsonObject {
    const encodedReasoning = request.reasoning ? encodeReasoning(this.protocol, request.reasoning as never) : undefined;
    if (this.protocol === "responses") {
      return compactObject({
        model: upstreamModel,
        input: request.messages.flatMap(messageToResponses),
        stream: request.stream,
        ...(request.tools.length ? { tools: encodeTools(this.protocol, request.tools.map(toCanonicalTool)) } : {}),
        ...(request.toolChoice !== undefined ? { tool_choice: encodeCodecToolChoice(this.protocol, request.toolChoice) } : {}),
        ...(request.parallelToolCalls !== undefined ? { parallel_tool_calls: request.parallelToolCalls } : {}),
        ...(encodedReasoning ? { reasoning: encodedReasoning } : {}),
        ...encodeResponsesParameters(request.parameters),
        ...(typeof request.metadata.previousResponseId === "string" ? { previous_response_id: request.metadata.previousResponseId } : {}),
      });
    }
    if (this.protocol === "chat_completions") {
      return compactObject({
        model: upstreamModel,
        messages: request.messages.flatMap(messageToChat),
        stream: request.stream,
        ...(request.tools.length ? { tools: encodeTools(this.protocol, request.tools.filter((tool) => tool.kind !== "web_search").map(toCanonicalTool)) } : {}),
        ...(request.parameters?.webSearchOptions ? { web_search_options: request.parameters.webSearchOptions } : request.tools.some((tool) => tool.kind === "web_search") ? { web_search_options: {} } : {}),
        ...(request.toolChoice !== undefined ? { tool_choice: encodeCodecToolChoice(this.protocol, request.toolChoice) } : {}),
        ...(request.parallelToolCalls !== undefined ? { parallel_tool_calls: request.parallelToolCalls } : {}),
        ...(encodedReasoning?.effort ? { reasoning_effort: encodedReasoning.effort } : {}),
        ...encodeChatParameters(request.parameters),
      });
    }
    if (this.protocol === "anthropic") {
      const system = request.messages.filter((message) => message.role === "system" || message.role === "developer");
      return compactObject({
        model: upstreamModel,
        system: system.length ? system.map((message) => messageText(message)).join("\n") : undefined,
        messages: request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map(messageToAnthropic),
        max_tokens: request.parameters?.maxTokens ?? request.parameters?.maxCompletionTokens ?? 4096,
        stream: request.stream,
        ...(request.tools.length ? { tools: encodeTools(this.protocol, request.tools.map(toCanonicalTool)) } : {}),
        ...(request.toolChoice !== undefined ? { tool_choice: encodeCodecToolChoice(this.protocol, request.toolChoice, request.parallelToolCalls) } : request.parallelToolCalls === false ? { tool_choice: { type: "auto", disable_parallel_tool_use: true } } : {}),
        ...(encodedReasoning ? { thinking: encodedReasoning } : {}),
        ...encodeAnthropicParameters(request.parameters),
      });
    }
    const system = request.messages.filter((message) => message.role === "system" || message.role === "developer");
    return compactObject({
      model: upstreamModel,
      systemInstruction: system.length ? { parts: [{ text: system.map(messageText).join("\n") }] } : undefined,
      contents: request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map(messageToGemini),
      ...(request.tools.length ? { tools: encodeTools(this.protocol, request.tools.map(toCanonicalTool)) } : {}),
      ...(request.toolChoice !== undefined ? { toolConfig: encodeCodecToolChoice(this.protocol, request.toolChoice) } : {}),
      generationConfig: { ...encodeGeminiGenerationConfig(request.parameters), ...(encodedReasoning ?? {}) },
      ...(request.parameters?.safetySettings !== undefined ? { safetySettings: request.parameters.safetySettings } : {}),
      ...(request.parameters?.cachedContent !== undefined ? { cachedContent: request.parameters.cachedContent } : {}),
    });
  }

  decodeResponse(body: JsonObject): GatewayResponseEvent[] {
    return decodeCanonicalResponseEvents(this.protocol, body).map(toGatewayResponseEvent);
  }

  encodeResponse(events: GatewayResponseEvent[]): JsonObject {
    return encodeCanonicalResponseEvents(this.protocol, events.map(toConversionResponseEvent));
  }
}

function messagesFromResponses(body: JsonObject): GatewayMessage[] {
  const instructions = body.instructions !== undefined ? [{ role: "system" as const, parts: partsFromUnknown(body.instructions) }] : [];
  const input = body.input;
  if (typeof input === "string") return [...instructions, { role: "user", parts: [{ type: "text", value: input }] }];
  if (!Array.isArray(input)) return instructions;
  return [...instructions, ...input.flatMap((item) => messageFromUnknown(item))];
}

function messagesFromChat(body: JsonObject): GatewayMessage[] {
  return Array.isArray(body.messages) ? body.messages.flatMap((item) => messageFromUnknown(item)) : [];
}

function messagesFromAnthropic(body: JsonObject): GatewayMessage[] {
  const system = body.system !== undefined ? [{ role: "system" as const, parts: partsFromUnknown(body.system) }] : [];
  const messages = Array.isArray(body.messages) ? body.messages.flatMap((item) => messageFromUnknown(item)) : [];
  return [...system, ...messages];
}

function messagesFromGemini(body: JsonObject): GatewayMessage[] {
  const system = isRecord(body.systemInstruction) ? [{ role: "system" as const, parts: partsFromUnknown(body.systemInstruction.parts) }] : [];
  const messages = Array.isArray(body.contents) ? body.contents.flatMap((item) => messageFromUnknown({ ...(isRecord(item) ? item : {}), role: isRecord(item) && item.role === "model" ? "assistant" : isRecord(item) ? item.role : "user" })) : [];
  return [...system, ...messages];
}

function messageFromUnknown(value: unknown): GatewayMessage[] {
  if (typeof value === "string") return [{ role: "user", parts: [{ type: "text", value }] }];
  if (!isRecord(value)) return [];
  const type = typeof value.type === "string" ? value.type : "";
  const inferredRole = type === "function_call" || type === "custom_tool_call" || type === "tool_search_call"
    ? "assistant"
    : type.endsWith("_call_output") || type === "tool_result" ? "tool" : undefined;
  const role = inferredRole ?? normalizeRole(value.role);
  if (type === "function_call" || type === "custom_tool_call" || type === "tool_search_call") {
    return [{ role: "assistant", parts: [{ type: "tool_use", value: toJsonObject(value) }] }];
  }
  if (type === "function_call_output" || type === "custom_tool_call_output" || type === "tool_search_call_output" || type === "tool_search_output") {
    return [{ role: "tool", parts: [{ type: "tool_result", value: toJsonObject(value) }] }];
  }
  const rawContent = value.content ?? value.parts ?? value.input;
  const parts = partsFromUnknown(rawContent);
  if (Array.isArray(value.tool_calls)) {
    for (const call of value.tool_calls) if (isRecord(call)) parts.push({ type: "tool_use", value: toJsonObject(call) });
  }
  if (isRecord(value.function_call)) parts.push({ type: "tool_use", value: toJsonObject(value.function_call) });
  if (role === "tool" && (typeof value.tool_call_id === "string" || typeof value.call_id === "string")) {
    parts.splice(0, parts.length, { type: "tool_result", value: compactObject({
      type: "function_call_output",
      call_id: value.tool_call_id ?? value.call_id,
      output: value.content ?? value.output ?? "",
      ...(value.is_error !== undefined ? { is_error: value.is_error } : {}),
    }) });
  }
  return [{ role, parts, ...(value.phase === "commentary" || value.phase === "final_answer" ? { phase: value.phase } : {}) }];
}

function partsFromUnknown(value: unknown): GatewayMessagePart[] {
  if (typeof value === "string") return [{ type: "text", value }];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [{ type: "unknown", value: { value: toJsonValue(value) } }];
  return value.map((part): GatewayMessagePart => {
    if (typeof part === "string") return { type: "text", value: part };
    if (!isRecord(part)) return { type: "unknown", value: { value: toJsonValue(part) } };
    if (isRecord(part.inlineData)) return { type: "image", value: toJsonObject(part.inlineData) };
    if (isRecord(part.fileData)) return { type: "file", value: toJsonObject(part.fileData) };
    if (isRecord(part.functionCall)) return { type: "tool_use", value: toJsonObject({ ...part.functionCall, ...(typeof part.thoughtSignature === "string" ? { thoughtSignature: part.thoughtSignature } : {}) }) };
    if (isRecord(part.functionResponse)) return { type: "tool_result", value: toJsonObject(part.functionResponse) };
    const type = typeof part.type === "string" ? part.type : "text";
    if (type === "text" || type === "input_text" || type === "output_text") return { type: "text", value: String(part.text ?? ""), ...(typeof part.signature === "string" ? { signature: part.signature } : typeof part.thoughtSignature === "string" ? { signature: part.thoughtSignature } : {}) };
  if (type.includes("image")) return { type: "image", value: compactObject({ url: part.image_url ?? part.source ?? part.data }) };
  if (type.includes("file") || type === "document") return { type: "file", value: toJsonObject(part.file ?? part) };
    if (type === "tool_use" || type === "function_call") return { type: "tool_use", value: toJsonObject(part) };
    if (type === "tool_result" || type === "function_response") return { type: "tool_result", value: toJsonObject(part) };
    if (type === "thinking" || type === "reasoning") return { type: "reasoning", value: String(part.thinking ?? part.text ?? ""), ...(typeof part.signature === "string" ? { signature: part.signature } : typeof part.thoughtSignature === "string" ? { signature: part.thoughtSignature } : {}) };
    return { type: "unknown", value: toJsonObject(part) };
  });
}

function messageText(message: GatewayMessage): string {
  return message.parts.filter((part) => part.type === "text" || part.type === "reasoning").map((part) => typeof part.value === "string" ? part.value : JSON.stringify(part.value)).join("");
}

function messageToResponses(message: GatewayMessage): JsonObject[] {
  const result: JsonObject[] = [];
  const contentParts = message.parts.filter((part) => part.type === "text" || part.type === "image" || part.type === "file" || part.type === "unknown");
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning");
  if (reasoningParts.length) {
    result.push({
      type: "reasoning",
      summary: reasoningParts.map((part) => ({
        type: "summary_text",
        text: typeof part.value === "string" ? part.value : JSON.stringify(part.value),
        ...(part.signature ? { signature: part.signature } : {}),
      })),
    });
  }
  if (contentParts.length) {
    result.push(compactObject({
      role: message.role,
      content: contentParts.map((part) => partToOpenAI(part, message.role)),
      ...(message.phase ? { phase: message.phase } : {}),
    }));
  }
  for (const part of message.parts) {
    if (part.type !== "tool_use" && part.type !== "tool_result") continue;
    const value = toJsonObject(part.value);
    const fallbackType = part.type === "tool_use" ? "function_call" : "function_call_output";
    const type = typeof value.type === "string" ? value.type : fallbackType;
    result.push({ ...value, type, ...(part.signature && value.thought_signature === undefined ? { thought_signature: part.signature } : {}) });
  }
  if (!result.length) result.push(compactObject({ role: message.role, content: [] }));
  return result;
}

function messageToChat(message: GatewayMessage): JsonObject[] {
  // Chat Completions providers commonly accept `system` but reject the newer
  // `developer` role. The shared codec has no provider-specific role setting,
  // so keep its default wire contract broadly compatible.
  const results = message.parts.filter((part) => part.type === "tool_result");
  if (message.role === "tool" || (results.length && !message.parts.some((part) => part.type === "text" || part.type === "image" || part.type === "file"))) {
    return results.map((part) => {
      const value = toJsonObject(part.value);
      return compactObject({
        role: "tool",
        tool_call_id: value.tool_call_id ?? value.call_id,
        content: value.content ?? value.output ?? "",
        ...(value.is_error !== undefined ? { is_error: value.is_error } : {}),
      });
    });
  }
  const role = message.role === "developer" ? "system" : message.role;
  const toolCalls = message.parts.filter((part) => part.type === "tool_use").map((part) => {
    const value = toJsonObject(part.value);
    const fn = isRecord(value.function) ? value.function : value;
    return compactObject({
      id: value.call_id ?? value.id,
      type: "function",
      function: compactObject({
        name: fn.name,
        arguments: fn.arguments ?? (fn.input && typeof fn.input === "string" ? fn.input : JSON.stringify(fn.input ?? {})),
      }),
    });
  });
  const reasoning = message.parts.filter((part) => part.type === "reasoning").map((part) => typeof part.value === "string" ? part.value : JSON.stringify(part.value)).join("");
  const contentParts = message.parts.filter((part) => part.type !== "tool_use" && part.type !== "tool_result" && part.type !== "reasoning");
  return [compactObject({
    role,
    content: contentParts.length === 1 && contentParts[0]?.type === "text"
      ? messageText({ ...message, parts: contentParts })
      : contentParts.map((part) => partToOpenAI(part, message.role)),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  })];
}

function messageToAnthropic(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role === "tool" ? "user" : message.role, content: message.parts.map(partToAnthropicPart) });
}

function messageToGemini(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role === "assistant" ? "model" : "user", parts: message.parts.map(partToGeminiPart) });
}

function partToOpenAI(part: GatewayMessagePart, role: GatewayMessage["role"] = "user"): JsonObject {
  if (part.type === "text") return { type: role === "assistant" ? "output_text" : "input_text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
  if (part.type === "image") return compactObject({ type: "input_image", image_url: isRecord(part.value) ? part.value.url : part.value });
  if (part.type === "file") return compactObject({ type: "input_file", ...(isRecord(part.value) ? part.value : { file_url: part.value }) });
  if (part.type === "tool_use") return compactObject({ type: "function_call", ...toJsonObject(part.value) });
  if (part.type === "tool_result") return compactObject({ type: "function_call_output", ...toJsonObject(part.value) });
  return { type: "input_text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
}

function partToAnthropicPart(part: GatewayMessagePart): JsonObject {
  if (part.type === "reasoning") return { type: "thinking", thinking: typeof part.value === "string" ? part.value : JSON.stringify(part.value), ...(part.signature ? { signature: part.signature } : {}) };
  if (part.type === "text") return { type: "text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
  if (part.type === "image") return compactObject({ type: "image", source: isRecord(part.value) ? part.value : { type: "url", url: part.value } });
  if (part.type === "file") return compactObject({ type: "document", source: isRecord(part.value) ? part.value : { type: "url", url: part.value } });
  if (part.type === "tool_use") return compactObject({ type: "tool_use", ...toJsonObject(part.value) });
  if (part.type === "tool_result") return compactObject({ type: "tool_result", ...toJsonObject(part.value) });
  return { type: "text", text: JSON.stringify(part.value) };
}

function partToGeminiPart(part: GatewayMessagePart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { text: typeof part.value === "string" ? part.value : JSON.stringify(part.value), ...(part.type === "reasoning" ? { thought: true } : {}), ...(part.signature ? { thoughtSignature: part.signature } : {}) };
  if (part.type === "image") return compactObject({ inlineData: isRecord(part.value) ? part.value : { data: part.value } });
  if (part.type === "file") return compactObject({ fileData: isRecord(part.value) ? part.value : { fileUri: part.value } });
  if (part.type === "tool_use") return { functionCall: toJsonObject(part.value), ...(isRecord(part.value) && typeof part.value.thoughtSignature === "string" ? { thoughtSignature: part.value.thoughtSignature } : {}) };
  if (part.type === "tool_result") return { functionResponse: toJsonObject(part.value) };
  return { text: JSON.stringify(part.value) };
}

function toGatewayTool(tool: CanonicalTool): GatewayToolDefinition {
  return {
    kind: tool.kind,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema ?? {},
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    ...(tool.namespaceDescription ? { namespaceDescription: tool.namespaceDescription } : {}),
    ...(tool.namespaceDeferLoading !== undefined ? { namespaceDeferLoading: tool.namespaceDeferLoading } : {}),
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    ...(tool.deferLoading !== undefined ? { deferLoading: tool.deferLoading } : {}),
    ...(tool.inputFormat ? { inputFormat: tool.inputFormat } : {}),
    ...(tool.raw ? { raw: tool.raw } : {}),
  };
}

function toCanonicalTool(tool: GatewayToolDefinition): CanonicalTool {
  return {
    kind: tool.kind ?? "function",
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    ...(tool.namespaceDescription ? { namespaceDescription: tool.namespaceDescription } : {}),
    ...(tool.namespaceDeferLoading !== undefined ? { namespaceDeferLoading: tool.namespaceDeferLoading } : {}),
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    ...(tool.deferLoading !== undefined ? { deferLoading: tool.deferLoading } : {}),
    ...(tool.inputFormat ? { inputFormat: tool.inputFormat } : {}),
    ...(tool.raw ? { raw: tool.raw } : {}),
  };
}

/**
 * The public gateway IR intentionally keeps response-start and usage events
 * smaller than the conversion IR.  Keep this adapter explicit so protocol
 * codecs cannot accidentally leak conversion-only fields (for example the
 * assistant role on `message_start`) into the runtime event contract.
 */
function toGatewayResponseEvent(event: ConversionResponseEvent): GatewayResponseEvent {
  if (event.type === "message_start") {
    return {
      type: "message_start",
      responseId: event.responseId,
      ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
      ...(event.model !== undefined ? { model: event.model } : {}),
      ...(event.status !== undefined ? { status: event.status } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    };
  }
  if (event.type === "usage") {
    return {
      type: "usage",
      inputTokens: event.usage.inputTokens,
      outputTokens: event.usage.outputTokens,
      ...(event.usage.reasoningTokens !== undefined ? { reasoningTokens: event.usage.reasoningTokens } : {}),
      ...(event.usage.cacheReadTokens !== undefined ? { cacheReadTokens: event.usage.cacheReadTokens } : {}),
      ...(event.usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: event.usage.cacheWriteTokens } : {}),
    };
  }
  if (event.type === "tool_call_delta") {
    return {
      type: "tool_call_delta",
      callId: event.callId,
      ...(event.name !== undefined ? { name: event.name } : {}),
      ...(event.namespace !== undefined ? { namespace: event.namespace } : {}),
      ...(event.argumentsDelta !== undefined ? { argumentsDelta: event.argumentsDelta } : {}),
      ...(event.signature !== undefined ? { signature: event.signature } : {}),
      ...(event.index !== undefined ? { index: event.index } : {}),
      ...(event.kind !== undefined ? { kind: event.kind } : {}),
      ...(event.raw !== undefined ? { raw: event.raw } : {}),
      ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
      ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}),
    };
  }
  if (event.type === "text_delta") return {
    type: "text_delta", text: event.text,
    ...(event.annotations !== undefined ? { annotations: event.annotations } : {}),
    ...(event.annotationIndex !== undefined ? { annotationIndex: event.annotationIndex } : {}),
    ...(event.refusal !== undefined ? { refusal: event.refusal } : {}),
    ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
    ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}),
    ...(event.contentIndex !== undefined ? { contentIndex: event.contentIndex } : {}),
  };
  if (event.type === "reasoning_delta") return {
    type: "reasoning_delta", text: event.text,
    ...(event.signature !== undefined ? { signature: event.signature } : {}),
    ...(event.encryptedContent !== undefined ? { encryptedContent: event.encryptedContent } : {}),
    ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
    ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}),
    ...(event.summaryIndex !== undefined ? { summaryIndex: event.summaryIndex } : {}),
  };
  if (event.type === "media") return {
    type: "media", mediaType: event.mediaType, media: event.media,
    ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
    ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}),
  };
  if (event.type === "tool_result") {
    return {
      type: "tool_result",
      callId: event.callId,
      ...(event.name !== undefined ? { name: event.name } : {}),
      output: event.output,
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      ...(event.kind !== undefined ? { kind: event.kind } : {}),
      ...(event.raw !== undefined ? { raw: event.raw } : {}),
      ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
      ...(event.outputIndex !== undefined ? { outputIndex: event.outputIndex } : {}),
    };
  }
  if (event.type === "error") {
    return { type: "error", code: event.code, message: event.message, retryable: event.retryable, ...(event.details ? { details: event.details } : {}) };
  }
  return event;
}

function toConversionResponseEvent(event: GatewayResponseEvent): ConversionResponseEvent {
  if (event.type === "message_start") {
    return { type: "message_start", responseId: event.responseId, role: "assistant", ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}), ...(event.model !== undefined ? { model: event.model } : {}), ...(event.status !== undefined ? { status: event.status } : {}), ...(event.metadata !== undefined ? { metadata: event.metadata } : {}) };
  }
  if (event.type === "usage") {
    return {
      type: "usage",
      usage: {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        reasoningTokens: event.reasoningTokens ?? 0,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
      },
    };
  }
  if (event.type === "tool_result") return event;
  return event;
}

function encodeCodecToolChoice(protocol: GatewayProtocol, value: JsonValue, parallel?: boolean): JsonValue {
  if (protocol === "responses") return value;
  if (protocol === "chat_completions") {
    if (typeof value === "string") return value;
    if (isRecord(value) && value.type === "function" && typeof value.name === "string") return { type: "function", function: { name: value.name } };
    return value;
  }
  if (protocol === "anthropic") {
    if (typeof value === "string") return compactObject({ type: value === "required" ? "any" : value, ...(parallel === false ? { disable_parallel_tool_use: true } : {}) });
    if (isRecord(value)) {
      const name = typeof value.name === "string" ? value.name : isRecord(value.function) && typeof value.function.name === "string" ? value.function.name : undefined;
      return compactObject({ type: value.type === "function" || value.type === "tool" ? "tool" : value.type === "required" ? "any" : value.type, ...(name ? { name } : {}), ...(parallel === false ? { disable_parallel_tool_use: true } : {}) });
    }
    return value;
  }
  if (isRecord(value) && isRecord(value.functionCallingConfig)) return { functionCallingConfig: value.functionCallingConfig };
  const mode = typeof value === "string" ? value : isRecord(value) && typeof value.type === "string" ? value.type : "auto";
  const name = isRecord(value) ? (typeof value.name === "string" ? value.name : isRecord(value.function) && typeof value.function.name === "string" ? value.function.name : undefined) : undefined;
  return { functionCallingConfig: compactObject({ mode: mode === "none" ? "NONE" : mode === "required" || mode === "any" ? "ANY" : "AUTO", ...(name ? { allowedFunctionNames: [name] } : {}) }) };
}

function decodeRequestParameters(protocol: GatewayProtocol, body: JsonObject): GatewayRequestParameters {
  if (protocol === "responses") return compactParameters({
    maxTokens: numberOf(body.max_output_tokens),
    temperature: numberOf(body.temperature),
    topP: numberOf(body.top_p),
    stop: body.stop,
    serviceTier: stringOf(body.service_tier),
    promptCacheKey: stringOf(body.prompt_cache_key),
    include: body.include,
    streamOptions: isRecord(body.stream_options) ? body.stream_options : undefined,
    textFormat: isRecord(body.text) ? body.text : undefined,
    clientMetadata: isRecord(body.client_metadata) ? body.client_metadata : undefined,
    providerMetadata: isRecord(body.metadata) ? body.metadata : undefined,
    modalities: body.modalities,
    prediction: body.prediction,
    store: typeof body.store === "boolean" ? body.store : undefined,
    background: typeof body.background === "boolean" ? body.background : undefined,
    truncation: stringOf(body.truncation),
    safetyIdentifier: stringOf(body.safety_identifier),
    maxToolCalls: numberOf(body.max_tool_calls),
    promptCacheRetention: stringOf(body.prompt_cache_retention),
    topLogprobs: numberOf(body.top_logprobs),
  });
  if (protocol === "chat_completions") return compactParameters({
    maxTokens: numberOf(body.max_tokens),
    maxCompletionTokens: numberOf(body.max_completion_tokens),
    temperature: numberOf(body.temperature),
    topP: numberOf(body.top_p),
    stop: body.stop,
    serviceTier: stringOf(body.service_tier),
    promptCacheKey: stringOf(body.prompt_cache_key),
    responseFormat: body.response_format,
    webSearchOptions: isRecord(body.web_search_options) ? body.web_search_options : undefined,
    streamOptions: isRecord(body.stream_options) ? body.stream_options : undefined,
    clientMetadata: isRecord(body.metadata) ? body.metadata : undefined,
    frequencyPenalty: numberOf(body.frequency_penalty),
    presencePenalty: numberOf(body.presence_penalty),
    topLogprobs: numberOf(body.top_logprobs),
    logprobs: body.logprobs,
    seed: numberOf(body.seed),
    n: numberOf(body.n),
    user: stringOf(body.user),
    modalities: body.modalities,
    prediction: body.prediction,
    logitBias: body.logit_bias,
    audio: body.audio,
  });
  if (protocol === "anthropic") return compactParameters({
    maxTokens: numberOf(body.max_tokens),
    temperature: numberOf(body.temperature),
    topP: numberOf(body.top_p),
    stopSequences: body.stop_sequences,
    providerMetadata: isRecord(body.metadata) ? body.metadata : undefined,
    outputConfig: isRecord(body.output_config) ? body.output_config : undefined,
    responseFormat: isRecord(body.output_config) && isRecord(body.output_config.format) ? body.output_config.format : undefined,
    speed: stringOf(body.speed),
    safeguards: body.safeguards,
    topK: numberOf(body.top_k),
    contextManagement: isRecord(body.context_management) ? body.context_management : undefined,
    container: body.container,
    mcpServers: body.mcp_servers,
    betas: body.betas,
  });
  const generationConfig = isRecord(body.generationConfig) ? body.generationConfig : isRecord(body.generation_config) ? body.generation_config : undefined;
  return compactParameters({
    maxTokens: numberOf(generationConfig?.maxOutputTokens) ?? numberOf(generationConfig?.max_output_tokens),
    temperature: numberOf(generationConfig?.temperature),
    topP: numberOf(generationConfig?.topP) ?? numberOf(generationConfig?.top_p),
    stopSequences: generationConfig?.stopSequences ?? generationConfig?.stop_sequences,
    geminiGenerationConfig: generationConfig,
    topK: numberOf(generationConfig?.topK) ?? numberOf(generationConfig?.top_k),
    safetySettings: body.safetySettings ?? body.safety_settings,
    cachedContent: stringOf(body.cachedContent) ?? stringOf(body.cached_content),
    ...(isRecord(generationConfig?.responseSchema) || isRecord(generationConfig?.responseJsonSchema)
      ? { responseFormat: { type: "json_schema", schema: generationConfig.responseSchema ?? generationConfig.responseJsonSchema } }
      : stringOf(generationConfig?.responseMimeType) === "application/json" ? { responseFormat: { type: "json_object" } } : {}),
  });
}

function encodeResponsesParameters(parameters: GatewayRequestParameters | undefined): JsonObject {
  const value = parameters ?? {};
  const text = value.textFormat ?? responseFormatToResponsesText(value.responseFormat);
  const maxTokens = value.maxTokens ?? value.maxCompletionTokens;
  return compactObject({
    ...(maxTokens !== undefined ? { max_output_tokens: maxTokens } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
    ...(value.topP !== undefined ? { top_p: value.topP } : {}),
    ...(value.stop !== undefined ? { stop: value.stop } : {}),
    ...(value.serviceTier !== undefined ? { service_tier: value.serviceTier } : {}),
    ...(value.promptCacheKey !== undefined ? { prompt_cache_key: value.promptCacheKey } : {}),
    ...(value.include !== undefined ? { include: value.include } : {}),
    ...(value.streamOptions !== undefined ? { stream_options: value.streamOptions } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(value.clientMetadata !== undefined ? { client_metadata: value.clientMetadata } : {}),
    ...(value.providerMetadata !== undefined ? { metadata: value.providerMetadata } : {}),
    ...(value.modalities !== undefined ? { modalities: value.modalities } : {}),
    ...(value.prediction !== undefined ? { prediction: value.prediction } : {}),
    ...(value.store !== undefined ? { store: value.store } : {}),
    ...(value.background !== undefined ? { background: value.background } : {}),
    ...(value.truncation !== undefined ? { truncation: value.truncation } : {}),
    ...(value.safetyIdentifier !== undefined ? { safety_identifier: value.safetyIdentifier } : {}),
    ...(value.maxToolCalls !== undefined ? { max_tool_calls: value.maxToolCalls } : {}),
    ...(value.promptCacheRetention !== undefined ? { prompt_cache_retention: value.promptCacheRetention } : {}),
    ...(value.topLogprobs !== undefined ? { top_logprobs: value.topLogprobs } : {}),
  });
}

function encodeChatParameters(parameters: GatewayRequestParameters | undefined): JsonObject {
  const value = parameters ?? {};
  const tokens = value.maxCompletionTokens ?? value.maxTokens;
  const responseFormat = value.responseFormat ?? responsesTextToChatFormat(value.textFormat);
  return compactObject({
    ...(tokens !== undefined ? { [value.maxCompletionTokens !== undefined ? "max_completion_tokens" : "max_tokens"]: tokens } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
    ...(value.topP !== undefined ? { top_p: value.topP } : {}),
    ...(value.stop !== undefined ? { stop: value.stop } : {}),
    ...(value.serviceTier !== undefined ? { service_tier: value.serviceTier } : {}),
    ...(value.promptCacheKey !== undefined ? { prompt_cache_key: value.promptCacheKey } : {}),
    ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    ...(value.streamOptions !== undefined ? { stream_options: value.streamOptions } : {}),
    ...(value.webSearchOptions !== undefined ? { web_search_options: value.webSearchOptions } : {}),
    ...(value.clientMetadata !== undefined ? { metadata: value.clientMetadata } : {}),
    ...(value.frequencyPenalty !== undefined ? { frequency_penalty: value.frequencyPenalty } : {}),
    ...(value.presencePenalty !== undefined ? { presence_penalty: value.presencePenalty } : {}),
    ...(value.topLogprobs !== undefined ? { top_logprobs: value.topLogprobs } : {}),
    ...(value.logprobs !== undefined ? { logprobs: value.logprobs } : {}),
    ...(value.seed !== undefined ? { seed: value.seed } : {}),
    ...(value.n !== undefined ? { n: value.n } : {}),
    ...(value.user !== undefined ? { user: value.user } : {}),
    ...(value.modalities !== undefined ? { modalities: value.modalities } : {}),
    ...(value.prediction !== undefined ? { prediction: value.prediction } : {}),
    ...(value.logitBias !== undefined ? { logit_bias: value.logitBias } : {}),
    ...(value.audio !== undefined ? { audio: value.audio } : {}),
  });
}

function encodeAnthropicParameters(parameters: GatewayRequestParameters | undefined): JsonObject {
  const value = parameters ?? {};
  const outputConfig = value.outputConfig || value.responseFormat ? { ...(value.outputConfig ?? {}), ...(value.responseFormat !== undefined ? { format: value.responseFormat } : {}) } : undefined;
  return compactObject({
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
    ...(value.topP !== undefined ? { top_p: value.topP } : {}),
    ...(value.stopSequences !== undefined ? { stop_sequences: value.stopSequences } : value.stop !== undefined ? { stop_sequences: value.stop } : {}),
    ...(value.providerMetadata !== undefined ? { metadata: value.providerMetadata } : {}),
    ...(outputConfig !== undefined ? { output_config: outputConfig } : {}),
    ...(value.speed !== undefined ? { speed: value.speed } : {}),
    ...(value.safeguards !== undefined ? { safeguards: value.safeguards } : {}),
    ...(value.topK !== undefined ? { top_k: value.topK } : {}),
    ...(value.contextManagement !== undefined ? { context_management: value.contextManagement } : {}),
    ...(value.container !== undefined ? { container: value.container } : {}),
    ...(value.mcpServers !== undefined ? { mcp_servers: value.mcpServers } : {}),
    ...(value.betas !== undefined ? { betas: value.betas } : {}),
  });
}

function encodeGeminiGenerationConfig(parameters: GatewayRequestParameters | undefined): JsonObject {
  const value = parameters ?? {};
  const raw = value.geminiGenerationConfig ?? {};
  const responseFormat = value.responseFormat ?? responsesTextToGeminiFormat(value.textFormat);
  const responseSchema = isRecord(responseFormat) && responseFormat.type === "json_schema"
    ? isRecord(responseFormat.schema)
      ? responseFormat.schema
      : isRecord(responseFormat.json_schema)
        ? (isRecord(responseFormat.json_schema.schema) ? responseFormat.json_schema.schema : responseFormat.json_schema)
        : undefined
    : undefined;
  const responseMimeType = stringOf(raw.responseMimeType) ?? stringOf(raw.response_mime_type) ?? (isRecord(responseFormat) && responseFormat.type === "json_object" ? "application/json" : undefined);
  return compactObject({
    ...raw,
    ...(responseMimeType !== undefined ? { responseMimeType } : {}),
    ...(value.maxTokens !== undefined ? { maxOutputTokens: value.maxTokens } : {}),
    ...(value.temperature !== undefined ? { temperature: value.temperature } : {}),
    ...(value.topP !== undefined ? { topP: value.topP } : {}),
    ...(value.stopSequences !== undefined ? { stopSequences: value.stopSequences } : {}),
    ...(value.topK !== undefined ? { topK: value.topK } : {}),
    ...(responseSchema ? { responseSchema } : {}),
  });
}

function responseFormatToResponsesText(value: JsonValue | undefined): JsonObject | undefined {
  return isRecord(value) ? { format: value } : undefined;
}

function responsesTextToChatFormat(value: JsonObject | undefined): JsonObject | undefined {
  return isRecord(value?.format) ? value.format : undefined;
}

function responsesTextToGeminiFormat(value: JsonObject | undefined): JsonObject | undefined {
  const format = isRecord(value?.format) ? value.format : undefined;
  if (!format) return undefined;
  if (format.type === "json_schema") {
    const schema = isRecord(format.json_schema) ? format.json_schema.schema : undefined;
    return compactObject({ type: "json_schema", ...(schema !== undefined ? { schema } : {}) });
  }
  if (format.type === "json_object") return { type: "json_object" };
  return undefined;
}

function compactParameters(parameters: GatewayRequestParameters): GatewayRequestParameters {
  return Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined)) as GatewayRequestParameters;
}

function numberOf(value: JsonValue | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function stringOf(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }

function normalizeRole(value: JsonValue | undefined): GatewayMessage["role"] { return value === "system" || value === "developer" || value === "assistant" || value === "tool" ? value : "user"; }
function compactObject(value: Record<string, unknown>): JsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject; }
function toJsonValue(value: unknown): JsonValue { if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value; if (Array.isArray(value)) return value.map(toJsonValue); return toJsonObject(value); }
function toJsonObject(value: unknown): JsonObject { return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])) as JsonObject : { value: toJsonValue(value) }; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
