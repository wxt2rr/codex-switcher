import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { enforceToolLossPolicy, type ConversionDiagnostic } from "./diagnostics.js";
import { planConversion } from "./formats.js";
import { asMediaPart, resolveMediaPart, type CanonicalMediaPart } from "./media-resolver.js";
import { decodeReasoning, encodeReasoning } from "./reasoning-converter.js";
import { decodeTools, encodeTools, type CanonicalTool } from "./tool-converter.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult, ReasoningConversionState } from "./types.js";

type CanonicalRole = "system" | "developer" | "user" | "assistant" | "tool";
interface CanonicalPart { type: "text" | "image" | "file" | "tool_use" | "tool_result" | "reasoning" | "unknown"; value: JsonValue; media?: CanonicalMediaPart; }
interface CanonicalMessage { role: CanonicalRole; parts: CanonicalPart[]; name?: string; }
interface CanonicalRequest { model: string; messages: CanonicalMessage[]; tools: CanonicalTool[]; stream: boolean; reasoning?: ReasoningConversionState; maxTokens?: number; metadata: JsonObject; }

export async function convertGatewayRequest(
  source: GatewayProtocol,
  target: GatewayProtocol,
  body: JsonObject,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<ConversionResult<JsonObject>> {
  const path = planConversion(source, target);
  const canonical = decodeCanonicalRequest(source, body);
  const diagnostics: ConversionDiagnostic[] = diagnoseCanonicalRequest(source, target, canonical);
  const messages = await resolveMessages(source, target, canonical.messages, options.mediaResolver, diagnostics);
  const value = encodeProtocolRequest(target, { ...canonical, messages, model: metadata.upstreamModelName ?? canonical.model });
  if (target === "anthropic" && canonical.maxTokens === undefined) {
    diagnostics.push({ code: "anthropic_default_max_tokens", level: "warning", message: "Anthropic requires max_tokens; the converter supplied a safe default", source, target, path: "max_tokens" });
  }
  enforceToolLossPolicy(diagnostics, options.toolLossPolicy ?? "allow");
  return { value, from: source, to: target, converterId: path.steps.map((step) => step.id).join("/"), quality: path.quality, steps: path.steps, diagnostics };
}

function decodeCanonicalRequest(protocol: GatewayProtocol, body: JsonObject): CanonicalRequest {
  if (protocol === "responses") {
    return {
      model: asString(body.model) ?? "",
      messages: [...decodeMessages("system", body.instructions), ...decodeMessagesFromInput(body.input)],
      tools: decodeTools(protocol, body.tools),
      stream: body.stream === true,
      reasoning: decodeReasoning(protocol, body),
      metadata: pickMetadata(body),
    };
  }
  if (protocol === "chat_completions") {
    return {
      model: asString(body.model) ?? "",
      messages: decodeMessagesArray(body.messages),
      tools: decodeTools(protocol, body.tools),
      stream: body.stream === true,
      reasoning: decodeReasoning(protocol, body),
      maxTokens: asNumber(body.max_tokens),
      metadata: pickMetadata(body),
    };
  }
  if (protocol === "anthropic") {
    return {
      model: asString(body.model) ?? "",
      messages: [...decodeMessages("system", body.system), ...decodeMessagesArray(body.messages)],
      tools: decodeTools(protocol, body.tools),
      stream: body.stream === true,
      reasoning: decodeReasoning(protocol, body),
      maxTokens: asNumber(body.max_tokens),
      metadata: pickMetadata(body),
    };
  }
  return {
    model: asString(body.model) ?? "",
    messages: [...decodeMessages("system", body.systemInstruction), ...decodeMessagesArray(body.contents)],
    tools: decodeTools(protocol, body.tools),
    stream: body.stream === true,
    reasoning: decodeReasoning(protocol, body),
    maxTokens: isObject(body.generationConfig) ? asNumber(body.generationConfig.maxOutputTokens) : undefined,
    metadata: pickMetadata(body),
  };
}

function encodeProtocolRequest(protocol: GatewayProtocol, request: CanonicalRequest): JsonObject {
  const reasoning = encodeReasoning(protocol, request.reasoning);
  if (protocol === "responses") {
    return {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, ...(message.name ? { name: message.name } : {}), content: message.parts.map((part) => encodeResponsesPart(part)) })),
      stream: request.stream,
      ...(encodeTools(protocol, request.tools) ? { tools: encodeTools(protocol, request.tools) } : {}),
      ...(reasoning ? { reasoning: reasoning } : {}),
      ...request.metadata,
    };
  }
  if (protocol === "chat_completions") {
    return {
      model: request.model,
      messages: request.messages.map(encodeChatMessage),
      stream: request.stream,
      ...(encodeTools(protocol, request.tools) ? { tools: encodeTools(protocol, request.tools) } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...request.metadata,
    };
  }
  if (protocol === "anthropic") {
    const system = request.messages.filter((message) => message.role === "system" || message.role === "developer").flatMap((message) => message.parts).map((part) => encodeText(part.value)).filter(Boolean).join("\n") || undefined;
    const messages = request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: encodeAnthropicContent(message.parts) }));
    return {
      model: request.model,
      ...(system ? { system } : {}),
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: request.stream,
      ...(encodeTools(protocol, request.tools) ? { tools: encodeTools(protocol, request.tools) } : {}),
      ...(reasoning ? { thinking: reasoning } : {}),
      ...request.metadata,
    };
  }
  const system = request.messages.filter((message) => message.role === "system" || message.role === "developer").flatMap((message) => message.parts).map((part) => encodeText(part.value)).filter(Boolean).join("\n") || undefined;
  return {
    model: request.model,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: message.parts.map((part) => encodeGeminiPart(part)) })),
    ...(encodeTools(protocol, request.tools) ? { tools: encodeTools(protocol, request.tools) } : {}),
    generationConfig: { responseMimeType: "text/plain", ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}), ...(reasoning ?? {}) },
    ...request.metadata,
  };
}

async function resolveMessages(source: GatewayProtocol, target: GatewayProtocol, messages: CanonicalMessage[], resolver: ConversionOptions["mediaResolver"], diagnostics: ConversionDiagnostic[]): Promise<CanonicalMessage[]> {
  return Promise.all(messages.map(async (message) => ({
    ...message,
    parts: await Promise.all(message.parts.map(async (part) => {
      if (!part.media) return part;
      const resolved = await resolveMediaPart(source, target, part.media, resolver);
      diagnostics.push(...resolved.diagnostics);
      return { ...part, media: resolved.part };
    })),
  })));
}

function decodeMessagesFromInput(value: JsonValue | undefined): CanonicalMessage[] {
  if (typeof value === "string") return [{ role: "user", parts: [{ type: "text", value }] }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    const type = asString(item.type);
    if (type === "function_call") return [{ role: "assistant" as const, parts: [{ type: "tool_use" as const, value: item }] }];
    if (type === "function_call_output") return [{ role: "tool" as const, parts: [{ type: "tool_result" as const, value: item }] }];
    return decodeMessagesArray([item]);
  });
}

function decodeMessagesArray(value: JsonValue | undefined): CanonicalMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    const role = normalizeRole(asString(item.role));
    if (!role) return [];
    const contentValue = item.content ?? item.parts ?? item.text;
    const parts = role === "tool" && asString(item.tool_call_id)
      ? [{ type: "tool_result" as const, value: { tool_call_id: asString(item.tool_call_id) ?? "call", content: item.content ?? "" } }]
      : contentValue !== undefined ? decodeParts(contentValue) : [];
    const toolCalls = Array.isArray(item.tool_calls) ? item.tool_calls.flatMap((call) => isObject(call) ? [{ type: "tool_use" as const, value: call }] : []) : [];
    return [{ role, parts: [...parts, ...toolCalls], ...(asString(item.name) ? { name: asString(item.name) } : {}) }];
  });
}

function decodeMessages(role: CanonicalRole, value: JsonValue | undefined): CanonicalMessage[] {
  if (value === undefined) return [];
  return [{ role, parts: decodeParts(value) }];
}

function decodeParts(value: JsonValue): CanonicalPart[] {
  if (typeof value === "string") return [{ type: "text", value }];
  if (Array.isArray(value)) return value.flatMap((part) => decodePart(part));
  if (isObject(value)) return decodePart(value);
  return [{ type: "unknown", value }];
}

function decodePart(value: JsonValue): CanonicalPart[] {
  if (typeof value === "string") return [{ type: "text", value }];
  if (!isObject(value)) return [{ type: "unknown", value }];
  const type = asString(value.type);
  const text = asString(value.text) ?? asString(value.input_text) ?? asString(value.output_text) ?? asString(value.thinking) ?? asString(value.reasoning_text);
  if (text !== undefined) return [{ type: type?.includes("reason") || type === "thinking" ? "reasoning" : "text", value: text }];
  const media = asMediaPart(value);
  if (media) return [{ type: media.type, value, media }];
  if (type === "tool_use" || type === "function_call" || type === "toolCall") return [{ type: "tool_use", value }];
  if (type === "tool_result" || type === "function_call_output" || type === "functionResponse") return [{ type: "tool_result", value }];
  return [{ type: "unknown", value }];
}

function encodeResponsesPart(part: CanonicalPart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { type: part.type === "text" ? "input_text" : "input_text", text: encodeText(part.value) };
  if (part.type === "image") return part.media?.data ? { type: "input_image", image_url: `data:${part.media.mimeType ?? "image/png"};base64,${part.media.data}` } : { type: "input_image", image_url: part.media?.url ?? "" };
  if (part.type === "file") return part.media?.data ? { type: "input_file", file_data: `data:${part.media.mimeType ?? "application/octet-stream"};base64,${part.media.data}`, ...(part.media.fileName ? { filename: part.media.fileName } : {}) } : { type: "input_file", file_url: part.media?.url ?? "" };
  if (part.type === "tool_use" && isObject(part.value)) return { type: "function_call", call_id: asString(part.value.call_id) ?? asString(part.value.id) ?? "call", name: asString(part.value.name) ?? "tool", arguments: asString(part.value.arguments) ?? JSON.stringify(part.value.input ?? {}) };
  if (part.type === "tool_result" && isObject(part.value)) return { type: "function_call_output", call_id: asString(part.value.call_id) ?? asString(part.value.tool_call_id) ?? "call", output: part.value.output ?? part.value.content ?? "" };
  return { type: part.type === "tool_use" ? "function_call" : part.type === "tool_result" ? "function_call_output" : "input_text", ...(isObject(part.value) ? part.value : { text: String(part.value) }) };
}

function encodeChatMessage(message: CanonicalMessage): JsonObject {
  const toolFields = encodeChatToolFields(message.parts);
  const hasToolCall = message.parts.some((part) => part.type === "tool_use");
  const hasVisibleContent = message.parts.some((part) => part.type === "text" || part.type === "image" || part.type === "file");
  const result: JsonObject = { role: message.role, ...(message.name ? { name: message.name } : {}), content: hasToolCall && !hasVisibleContent ? null : encodeChatContent(message.parts), ...toolFields };
  if (message.role === "tool" && isObject(message.parts[0]?.value)) {
    const value = message.parts[0].value;
    result.tool_call_id = asString(value.tool_call_id) ?? asString(value.call_id) ?? asString(value.id) ?? "call";
    result.content = encodeText(value.output ?? value.content ?? "");
  }
  return result;
}

function encodeChatContent(parts: CanonicalPart[]): JsonValue {
  if (parts.length === 1 && parts[0]?.type === "text") return encodeText(parts[0].value);
  return parts.map((part): JsonObject => {
    if (part.type === "text") return { type: "text", text: encodeText(part.value) };
    if (part.type === "image") return { type: "image_url", image_url: { url: part.media?.url ?? (part.media?.data ? `data:${part.media.mimeType ?? "image/png"};base64,${part.media.data}` : "") } };
    if (part.type === "file") return { type: "file", file: {
      ...(part.media?.data ? { file_data: `data:${part.media.mimeType ?? "application/octet-stream"};base64,${part.media.data}` } : {}),
      ...(part.media?.url ? { file_url: part.media.url } : {}),
    } };
    return encodeChatToolPart(part);
  });
}

function encodeChatToolFields(parts: CanonicalPart[]): JsonObject {
  const calls: JsonObject[] = [];
  for (const part of parts) {
    if (part.type !== "tool_use" || !isObject(part.value)) continue;
    calls.push({ id: asString(part.value.call_id) ?? asString(part.value.id) ?? "call", type: "function", function: { name: asString(part.value.name) ?? "tool", arguments: asString(part.value.arguments) ?? JSON.stringify(part.value.input ?? {}) } });
  }
  return calls.length ? { tool_calls: calls } : {};
}

function encodeChatToolPart(part: CanonicalPart): JsonObject {
  if (!isObject(part.value)) return { type: "text", text: String(part.value) };
  if (part.type === "tool_use") return { type: "text", text: "" };
  if (part.type === "tool_result") return { type: "text", text: encodeText(part.value.output ?? part.value.content ?? "") };
  return part.value;
}
function encodeAnthropicContent(parts: CanonicalPart[]): JsonValue {
  if (parts.length === 1 && parts[0]?.type === "text") return encodeText(parts[0].value);
  return parts.map((part) => encodeAnthropicPart(part));
}
function encodeAnthropicPart(part: CanonicalPart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { type: "text", text: encodeText(part.value) };
  if (part.type === "image") return part.media?.data ? { type: "image", source: { type: "base64", media_type: part.media.mimeType ?? "image/png", data: part.media.data } } : { type: "image", source: { type: "url", url: part.media?.url ?? "" } };
  if (part.type === "file") return part.media?.data ? { type: "document", source: { type: "base64", media_type: part.media.mimeType ?? "application/octet-stream", data: part.media.data } } : { type: "document", source: { type: "url", url: part.media?.url ?? "" } };
  if (part.type === "tool_use" && isObject(part.value)) return { type: "tool_use", id: asString(part.value.call_id) ?? asString(part.value.id) ?? "call", name: asString(part.value.name) ?? "tool", input: parseArguments(asString(part.value.arguments), part.value.input) };
  if (part.type === "tool_result" && isObject(part.value)) return { type: "tool_result", tool_use_id: asString(part.value.call_id) ?? asString(part.value.tool_call_id) ?? "call", content: part.value.output ?? part.value.content ?? "" };
  return isObject(part.value) ? part.value : { type: "text", text: String(part.value) };
}
function encodeGeminiPart(part: CanonicalPart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { text: encodeText(part.value), ...(part.type === "reasoning" ? { thought: true } : {}) };
  if (part.type === "image") return part.media?.data ? { inlineData: { mimeType: part.media.mimeType ?? "image/png", data: part.media.data } } : { fileData: { fileUri: part.media?.url ?? "" } };
  if (part.type === "file") return part.media?.data ? { inlineData: { mimeType: part.media.mimeType ?? "application/octet-stream", data: part.media.data } } : { fileData: { fileUri: part.media?.url ?? "" } };
  if (part.type === "tool_use" && isObject(part.value)) return { functionCall: { name: asString(part.value.name) ?? "tool", args: parseArguments(asString(part.value.arguments), part.value.input) } };
  if (part.type === "tool_result" && isObject(part.value)) return { functionResponse: { name: asString(part.value.name) ?? "tool", response: part.value.output ?? part.value.content ?? {} } };
  return isObject(part.value) ? part.value : { text: String(part.value) };
}

function parseArguments(value: string | undefined, fallback: JsonValue | undefined): JsonObject {
  if (value) {
    try { const parsed = JSON.parse(value) as unknown; if (isObject(parsed as JsonValue)) return parsed as JsonObject; } catch { /* preserve malformed tool arguments below */ }
  }
  return isObject(fallback) ? fallback : {};
}

function diagnoseCanonicalRequest(source: GatewayProtocol, target: GatewayProtocol, request: CanonicalRequest): ConversionDiagnostic[] {
  const diagnostics: ConversionDiagnostic[] = [];
  for (const message of request.messages) for (const part of message.parts) {
    if (part.type === "unknown") diagnostics.push({ code: "unknown_message_part", level: "warning", message: "An unrecognized message part was preserved as JSON text", source, target });
  }
  for (const tool of request.tools) {
    if (tool.kind === "custom" && target !== "responses") diagnostics.push({ code: "custom_tool_downgrade", level: "warning", message: "Custom tool semantics were downgraded to a function tool", source, target, path: "tools" });
    if (tool.kind === "namespace" && target !== "responses") diagnostics.push({ code: "namespace_tool_downgrade", level: "warning", message: "Namespace tool semantics were downgraded to individual function tools", source, target, path: "tools" });
    if (tool.kind === "web_search" && target !== "responses") diagnostics.push({ code: "web_search_tool_downgrade", level: "warning", message: "Provider-native web search is not protocol-equivalent and was mapped to the target tool form", source, target, path: "tools" });
  }
  return diagnostics;
}
function encodeText(value: JsonValue): string { return typeof value === "string" ? value : JSON.stringify(value); }
function pickMetadata(body: JsonObject): JsonObject { return Object.fromEntries(Object.entries(body).filter(([key]) => key === "user" || key === "previous_response_id")); }
function normalizeRole(value: string | undefined): CanonicalRole | undefined { return value === "system" || value === "developer" || value === "user" || value === "assistant" || value === "tool" ? value : undefined; }
function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function asNumber(value: JsonValue | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
