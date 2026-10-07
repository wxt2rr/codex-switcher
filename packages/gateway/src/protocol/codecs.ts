import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import {
  type GatewayMessage,
  type GatewayMessagePart,
  type GatewayRequestContext,
  type GatewayRequestIR,
  type GatewayToolDefinition,
} from "../request/request-ir.js";
import type { GatewayResponseEvent } from "../response/response-ir.js";

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
    const messages = this.protocol === "responses"
      ? messagesFromResponses(body)
      : this.protocol === "chat_completions"
        ? messagesFromChat(body)
        : this.protocol === "anthropic"
          ? messagesFromAnthropic(body)
          : messagesFromGemini(body);
    const tools = this.protocol === "anthropic"
      ? toolsFromAnthropic(body.tools)
      : this.protocol === "gemini"
        ? toolsFromGemini(body.tools)
        : toolsFromOpenAI(body.tools);
    const reasoning = isRecord(body.reasoning) ? body.reasoning : isRecord(body.thinking) ? body.thinking : undefined;
    return {
      context,
      messages,
      tools,
      stream: body.stream === true,
      ...(reasoning ? { reasoning } : {}),
      metadata: compactObject({
        ...(typeof body.user === "string" ? { user: body.user } : {}),
        ...(typeof body.previous_response_id === "string" ? { previousResponseId: body.previous_response_id } : {}),
      }),
    };
  }

  encodeRequest(request: GatewayRequestIR, upstreamModel = request.context.logicalModelId): JsonObject {
    if (this.protocol === "responses") {
      return compactObject({
        model: upstreamModel,
        input: request.messages.map(messageToResponses),
        stream: request.stream,
        ...(request.tools.length ? { tools: request.tools.map(toolToOpenAI) } : {}),
        ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      });
    }
    if (this.protocol === "chat_completions") {
      return compactObject({
        model: upstreamModel,
        messages: request.messages.map(messageToChat),
        stream: request.stream,
        ...(request.tools.length ? { tools: request.tools.map(toolToOpenAI) } : {}),
        ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      });
    }
    if (this.protocol === "anthropic") {
      const system = request.messages.filter((message) => message.role === "system" || message.role === "developer");
      return compactObject({
        model: upstreamModel,
        system: system.length ? system.map((message) => messageText(message)).join("\n") : undefined,
        messages: request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map(messageToAnthropic),
        max_tokens: 4096,
        stream: request.stream,
        ...(request.tools.length ? { tools: request.tools.map(toolToAnthropic) } : {}),
        ...(request.reasoning ? { thinking: request.reasoning } : {}),
      });
    }
    const system = request.messages.filter((message) => message.role === "system" || message.role === "developer");
    return compactObject({
      model: upstreamModel,
      systemInstruction: system.length ? { parts: [{ text: system.map(messageText).join("\n") }] } : undefined,
      contents: request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map(messageToGemini),
      ...(request.tools.length ? { tools: [{ functionDeclarations: request.tools.map(toolToGemini) }] } : {}),
      generationConfig: { responseMimeType: "text/plain" },
    });
  }

  decodeResponse(body: JsonObject): GatewayResponseEvent[] {
    if (this.protocol === "responses") return responseEventsFromResponses(body);
    if (this.protocol === "chat_completions") return responseEventsFromChat(body);
    if (this.protocol === "anthropic") return responseEventsFromAnthropic(body);
    return responseEventsFromGemini(body);
  }

  encodeResponse(events: GatewayResponseEvent[]): JsonObject {
    const text = events.filter((event): event is Extract<GatewayResponseEvent, { type: "text_delta" }> => event.type === "text_delta").map((event) => event.text).join("");
    const reasoning = events.filter((event): event is Extract<GatewayResponseEvent, { type: "reasoning_delta" }> => event.type === "reasoning_delta").map((event) => event.text).join("");
    const toolCalls = events.filter((event): event is Extract<GatewayResponseEvent, { type: "tool_call_delta" }> => event.type === "tool_call_delta");
    const usage = events.find((event): event is Extract<GatewayResponseEvent, { type: "usage" }> => event.type === "usage");
    const error = events.find((event): event is Extract<GatewayResponseEvent, { type: "error" }> => event.type === "error");
    if (error) return { error: { code: error.code, message: error.message, type: "gateway_error" } };
    if (this.protocol === "anthropic") {
      return compactObject({ id: responseId(events), type: "message", role: "assistant", content: [{ type: "text", text }, ...(reasoning ? [{ type: "thinking", thinking: reasoning }] : []), ...toolCalls.map((event) => ({ type: "tool_use", id: event.callId, name: event.name ?? "tool", input: parseArguments(event.argumentsDelta) }))], stop_reason: "end_turn", usage: usage ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } : undefined });
    }
    if (this.protocol === "gemini") {
      return compactObject({ candidates: [{ content: { role: "model", parts: [{ text }, ...toolCalls.map((event) => ({ functionCall: { name: event.name ?? "tool", args: parseArguments(event.argumentsDelta) } }))] }, finishReason: "STOP" }], usageMetadata: usage ? { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens, totalTokenCount: usage.inputTokens + usage.outputTokens, ...(usage.reasoningTokens !== undefined ? { thoughtsTokenCount: usage.reasoningTokens } : {}) } : undefined });
    }
    if (this.protocol === "chat_completions") {
      return compactObject({ id: responseId(events), object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls.map((event) => ({ id: event.callId, type: "function", function: { name: event.name ?? "tool", arguments: event.argumentsDelta ?? "{}" } })) } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: toolCalls.length ? "tool_calls" : "stop" }], usage: usage ? { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens } : undefined });
    }
    return compactObject({ id: responseId(events), object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }, ...(reasoning ? [{ type: "reasoning", summary: [{ type: "summary_text", text: reasoning }] }] : []), ...toolCalls.map((event) => ({ type: "function_call", call_id: event.callId, name: event.name ?? "tool", arguments: event.argumentsDelta ?? "{}" }))], usage: usage ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens, ...(usage.reasoningTokens !== undefined ? { reasoning_tokens: usage.reasoningTokens } : {}) } : undefined });
  }
}

function messagesFromResponses(body: JsonObject): GatewayMessage[] {
  const instructions = typeof body.instructions === "string" ? [{ role: "system" as const, parts: [{ type: "text" as const, value: body.instructions }] }] : [];
  const input = body.input;
  if (typeof input === "string") return [...instructions, { role: "user", parts: [{ type: "text", value: input }] }];
  if (!Array.isArray(input)) return instructions;
  return [...instructions, ...input.flatMap((item) => messageFromUnknown(item))];
}

function messagesFromChat(body: JsonObject): GatewayMessage[] {
  return Array.isArray(body.messages) ? body.messages.flatMap((item) => messageFromUnknown(item)) : [];
}

function messagesFromAnthropic(body: JsonObject): GatewayMessage[] {
  const system = typeof body.system === "string" ? [{ role: "system" as const, parts: [{ type: "text" as const, value: body.system }] }] : [];
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
  const role = normalizeRole(value.role);
  const rawContent = value.content ?? value.parts ?? value.input;
  return [{ role, parts: partsFromUnknown(rawContent) }];
}

function partsFromUnknown(value: unknown): GatewayMessagePart[] {
  if (typeof value === "string") return [{ type: "text", value }];
  if (!Array.isArray(value)) return value === undefined ? [] : [{ type: "unknown", value: { value: toJsonValue(value) } }];
  return value.map((part): GatewayMessagePart => {
    if (typeof part === "string") return { type: "text", value: part };
    if (!isRecord(part)) return { type: "unknown", value: { value: toJsonValue(part) } };
    if (isRecord(part.inlineData) || isRecord(part.fileData)) return { type: "image", value: toJsonObject(part.inlineData ?? part.fileData) };
    if (isRecord(part.functionCall)) return { type: "tool_use", value: toJsonObject(part.functionCall) };
    if (isRecord(part.functionResponse)) return { type: "tool_result", value: toJsonObject(part.functionResponse) };
    const type = typeof part.type === "string" ? part.type : "text";
    if (type === "text" || type === "input_text" || type === "output_text") return { type: "text", value: String(part.text ?? "") };
    if (type.includes("image")) return { type: "image", value: compactObject({ url: part.image_url ?? part.source ?? part.data }) };
    if (type === "tool_use" || type === "function_call") return { type: "tool_use", value: toJsonObject(part) };
    if (type === "tool_result" || type === "function_response") return { type: "tool_result", value: toJsonObject(part) };
    if (type === "thinking" || type === "reasoning") return { type: "reasoning", value: String(part.thinking ?? part.text ?? "") };
    return { type: "unknown", value: toJsonObject(part) };
  });
}

function messageText(message: GatewayMessage): string {
  return message.parts.filter((part) => part.type === "text" || part.type === "reasoning").map((part) => typeof part.value === "string" ? part.value : JSON.stringify(part.value)).join("");
}

function messageToResponses(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role, content: message.parts.map(partToOpenAI) });
}

function messageToChat(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role, content: message.parts.length === 1 && message.parts[0]?.type === "text" ? messageText(message) : message.parts.map(partToOpenAI) });
}

function messageToAnthropic(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role === "tool" ? "user" : message.role, content: message.parts.map(partToAnthropicPart) });
}

function messageToGemini(message: GatewayMessage): JsonObject {
  return compactObject({ role: message.role === "assistant" ? "model" : "user", parts: message.parts.map(partToGeminiPart) });
}

function partToOpenAI(part: GatewayMessagePart): JsonObject {
  if (part.type === "text") return { type: "input_text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
  if (part.type === "image") return compactObject({ type: "input_image", image_url: isRecord(part.value) ? part.value.url : part.value });
  if (part.type === "tool_use") return compactObject({ type: "function_call", ...toJsonObject(part.value) });
  if (part.type === "tool_result") return compactObject({ type: "function_call_output", ...toJsonObject(part.value) });
  return { type: "input_text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
}

function partToAnthropicPart(part: GatewayMessagePart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { type: "text", text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
  if (part.type === "image") return compactObject({ type: "image", source: isRecord(part.value) ? part.value : { type: "url", url: part.value } });
  if (part.type === "tool_use") return compactObject({ type: "tool_use", ...toJsonObject(part.value) });
  if (part.type === "tool_result") return compactObject({ type: "tool_result", ...toJsonObject(part.value) });
  return { type: "text", text: JSON.stringify(part.value) };
}

function partToGeminiPart(part: GatewayMessagePart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { text: typeof part.value === "string" ? part.value : JSON.stringify(part.value) };
  if (part.type === "image") return compactObject({ inlineData: isRecord(part.value) ? part.value : { data: part.value } });
  if (part.type === "tool_use") return { functionCall: toJsonObject(part.value) };
  if (part.type === "tool_result") return { functionResponse: toJsonObject(part.value) };
  return { text: JSON.stringify(part.value) };
}

function toolsFromOpenAI(value: JsonValue | undefined): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== "string") return [];
    return [{ name: item.function.name, ...(typeof item.function.description === "string" ? { description: item.function.description } : {}), inputSchema: isRecord(item.function.parameters) ? item.function.parameters : {} }];
  });
}

function toolsFromAnthropic(value: JsonValue | undefined): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => !isRecord(item) || typeof item.name !== "string" ? [] : [{ name: item.name, ...(typeof item.description === "string" ? { description: item.description } : {}), inputSchema: isRecord(item.input_schema) ? item.input_schema : {} }]);
}

function toolsFromGemini(value: JsonValue | undefined): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.functionDeclarations)) return [];
    return item.functionDeclarations.flatMap((declaration) => !isRecord(declaration) || typeof declaration.name !== "string" ? [] : [{ name: declaration.name, ...(typeof declaration.description === "string" ? { description: declaration.description } : {}), inputSchema: isRecord(declaration.parameters) ? declaration.parameters : {} }]);
  });
}

function toolToOpenAI(tool: GatewayToolDefinition): JsonObject { return { type: "function", function: compactObject({ name: tool.name, description: tool.description, parameters: tool.inputSchema }) }; }
function toolToAnthropic(tool: GatewayToolDefinition): JsonObject { return compactObject({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }); }
function toolToGemini(tool: GatewayToolDefinition): JsonObject { return compactObject({ name: tool.name, description: tool.description, parameters: tool.inputSchema }); }

function responseEventsFromResponses(body: JsonObject): GatewayResponseEvent[] {
  const events: GatewayResponseEvent[] = [{ type: "message_start", responseId: typeof body.id === "string" ? body.id : "response" }];
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item.content)) {
      for (const part of item.content) if (isRecord(part) && typeof part.text === "string") events.push({ type: item.type === "reasoning" ? "reasoning_delta" : "text_delta", text: part.text });
    }
    if (item.type === "function_call") events.push({ type: "tool_call_delta", callId: typeof item.call_id === "string" ? item.call_id : "call", name: typeof item.name === "string" ? item.name : undefined, argumentsDelta: typeof item.arguments === "string" ? item.arguments : undefined });
  }
  appendUsage(events, body.usage, "openai");
  events.push({ type: "message_end", reason: typeof body.status === "string" ? body.status : "stop" });
  return events;
}

function responseEventsFromChat(body: JsonObject): GatewayResponseEvent[] {
  const events: GatewayResponseEvent[] = [{ type: "message_start", responseId: typeof body.id === "string" ? body.id : "chat" }];
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : choice && isRecord(choice.delta) ? choice.delta : undefined;
  if (message && typeof message.content === "string") events.push({ type: "text_delta", text: message.content });
  if (message && typeof message.reasoning_content === "string") events.push({ type: "reasoning_delta", text: message.reasoning_content });
  if (message && Array.isArray(message.tool_calls)) for (const call of message.tool_calls) if (isRecord(call)) {
    const fn = isRecord(call.function) ? call.function : {};
    events.push({ type: "tool_call_delta", callId: typeof call.id === "string" ? call.id : "call", name: typeof fn.name === "string" ? fn.name : undefined, argumentsDelta: typeof fn.arguments === "string" ? fn.arguments : undefined });
  }
  appendUsage(events, body.usage, "openai");
  events.push({ type: "message_end", reason: choice && typeof choice.finish_reason === "string" ? choice.finish_reason : "stop" });
  return events;
}

function responseEventsFromAnthropic(body: JsonObject): GatewayResponseEvent[] {
  const events: GatewayResponseEvent[] = [{ type: "message_start", responseId: typeof body.id === "string" ? body.id : "anthropic" }];
  if (Array.isArray(body.content)) for (const part of body.content) if (isRecord(part)) {
    if (typeof part.text === "string") events.push({ type: part.type === "thinking" ? "reasoning_delta" : "text_delta", text: part.text });
    if (typeof part.thinking === "string") events.push({ type: "reasoning_delta", text: part.thinking });
    if (part.type === "tool_use") events.push({ type: "tool_call_delta", callId: typeof part.id === "string" ? part.id : "call", name: typeof part.name === "string" ? part.name : undefined, argumentsDelta: part.input !== undefined ? JSON.stringify(part.input) : undefined });
  }
  appendUsage(events, body.usage, "anthropic");
  events.push({ type: "message_end", reason: typeof body.stop_reason === "string" ? body.stop_reason : "end_turn" });
  return events;
}

function responseEventsFromGemini(body: JsonObject): GatewayResponseEvent[] {
  const events: GatewayResponseEvent[] = [{ type: "message_start", responseId: "gemini" }];
  const candidate = Array.isArray(body.candidates) && isRecord(body.candidates[0]) ? body.candidates[0] : undefined;
  if (candidate && isRecord(candidate.content) && Array.isArray(candidate.content.parts)) for (const part of candidate.content.parts) if (isRecord(part)) {
    if (typeof part.text === "string") events.push({ type: part.thought === true ? "reasoning_delta" : "text_delta", text: part.text });
    if (isRecord(part.functionCall)) events.push({ type: "tool_call_delta", callId: typeof part.functionCall.name === "string" ? part.functionCall.name : "call", name: typeof part.functionCall.name === "string" ? part.functionCall.name : undefined, argumentsDelta: part.functionCall.args !== undefined ? JSON.stringify(part.functionCall.args) : undefined });
  }
  appendUsage(events, body.usageMetadata, "gemini");
  events.push({ type: "message_end", reason: candidate && typeof candidate.finishReason === "string" ? candidate.finishReason : "STOP" });
  return events;
}

function appendUsage(events: GatewayResponseEvent[], value: JsonValue | undefined, kind: "openai" | "anthropic" | "gemini"): void {
  if (!isRecord(value)) return;
  const input = kind === "gemini" ? numberAt(value, "promptTokenCount") : kind === "anthropic" ? numberAt(value, "input_tokens") : numberAt(value, "input_tokens") ?? numberAt(value, "prompt_tokens");
  const output = kind === "gemini" ? numberAt(value, "candidatesTokenCount") : kind === "anthropic" ? numberAt(value, "output_tokens") : numberAt(value, "output_tokens") ?? numberAt(value, "completion_tokens");
  const reasoning = numberAt(value, kind === "gemini" ? "thoughtsTokenCount" : kind === "anthropic" ? "thinking_tokens" : "reasoning_tokens");
  const cacheRead = numberAt(value, kind === "anthropic" ? "cache_read_input_tokens" : "cached_tokens");
  const cacheWrite = numberAt(value, "cache_creation_input_tokens");
  if (input !== null || output !== null) events.push({ type: "usage", inputTokens: input ?? 0, outputTokens: output ?? 0, ...(reasoning !== null ? { reasoningTokens: reasoning } : {}), ...(cacheRead !== null ? { cacheReadTokens: cacheRead } : {}), ...(cacheWrite !== null ? { cacheWriteTokens: cacheWrite } : {}) });
}

function numberAt(value: Record<string, JsonValue>, key: string): number | null { return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : null; }
function responseId(events: GatewayResponseEvent[]): string { return events.find((event): event is Extract<GatewayResponseEvent, { type: "message_start" }> => event.type === "message_start")?.responseId ?? "gateway-response"; }
function normalizeRole(value: JsonValue | undefined): GatewayMessage["role"] { return value === "system" || value === "developer" || value === "assistant" || value === "tool" ? value : "user"; }
function compactObject(value: Record<string, unknown>): JsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject; }
function toJsonValue(value: unknown): JsonValue { if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value; if (Array.isArray(value)) return value.map(toJsonValue); return toJsonObject(value); }
function toJsonObject(value: unknown): JsonObject { return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])) as JsonObject : { value: toJsonValue(value) }; }
function parseArguments(value: string | undefined): JsonObject { if (!value) return {}; try { return toJsonObject(JSON.parse(value)); } catch { return { raw: value }; } }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
