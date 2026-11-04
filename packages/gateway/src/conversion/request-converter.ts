import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { enforceToolLossPolicy, type ConversionDiagnostic } from "./diagnostics.js";
import { planConversion } from "./formats.js";
import { asMediaPart, resolveMediaPart, type CanonicalMediaPart } from "./media-resolver.js";
import { decodeReasoning, encodeReasoning } from "./reasoning-converter.js";
import { decodeTools, encodeTools, qualifyToolsForProtocol, type CanonicalTool, type QualifiedToolSet } from "./tool-converter.js";
import { normalizeCanonicalToolExchange } from "./tool-exchange-normalizer.js";
import { normalizeMoonshotChatTools, upstreamRequiresMoonshotSchema } from "./moonshot-schema.js";
import { normalizeGeminiWire } from "./gemini-normalizer.js";
import type { CanonicalRequestParameters, ConversionMetadata, ConversionOptions, ConversionResult, ReasoningConversionState } from "./types.js";
import { isCapabilityFresh, type CapabilityProfile } from "../capability/contracts.js";

type CanonicalRole = "system" | "developer" | "user" | "assistant" | "tool";
interface CanonicalPart { type: "text" | "image" | "file" | "tool_use" | "tool_result" | "reasoning" | "unknown"; value: JsonValue; media?: CanonicalMediaPart; wireType?: string; signature?: string; }
interface CanonicalMessage { role: CanonicalRole; parts: CanonicalPart[]; name?: string; phase?: "commentary" | "final_answer"; }
interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  stream: boolean;
  reasoning?: ReasoningConversionState;
  parameters: CanonicalRequestParameters;
  toolChoice?: JsonValue;
  parallelToolCalls?: boolean;
  metadata: JsonObject;
  /** Responses history chaining is consumed by the gateway history layer. */
  previousResponseId?: string;
}

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
  const normalized = normalizeCanonicalToolExchange(canonical.messages);
  for (const diagnostic of normalized.diagnostics) {
    diagnostics.push({
      code: `tool_exchange_${diagnostic.code}`,
      level: diagnostic.code === "invalid_tool_call" ? "error" : "warning",
      message: diagnostic.message,
      source,
      target,
      ...(diagnostic.callId ? { path: `messages.tool_call_id=${diagnostic.callId}` } : {}),
    });
  }
  const messages = await resolveMessages(source, target, normalized.messages, options.mediaResolver, diagnostics);
  const effectiveOptions = target === "chat_completions" && !options.chatMaxTokensField && /(?:moonshot\.cn|moonshot\.ai|kimi\.com|dashscope\.aliyuncs\.com)/i.test(metadata.upstreamEndpoint ?? "")
    ? { ...options, chatMaxTokensField: "max_tokens" as const }
    : options;
  const requestForEncoding = {
    ...canonical,
    messages,
    model: metadata.upstreamModelName ?? canonical.model,
    parameters: filterCanonicalSamplingParameters(canonical.parameters, effectiveOptions.capabilityProfile, effectiveOptions.capabilityPolicy, target),
  };
  const encoded = encodeProtocolRequest(source, target, requestForEncoding, effectiveOptions, diagnostics, metadata.upstreamEndpoint);
  for (const [wireName, originalName] of Object.entries(encoded.toolNameMap)) {
    diagnostics.push({ code: "namespace_tool_name_qualified", level: "warning", message: `Qualified namespaced tool '${originalName}' as '${wireName}' because '${target}' has no namespace tool envelope`, source, target, path: "tools" });
  }
  if (target === "anthropic" && canonical.parameters.maxTokens === undefined) {
    diagnostics.push({ code: "anthropic_default_max_tokens", level: "warning", message: "Anthropic requires max_tokens; the converter supplied a safe default", source, target, path: "max_tokens" });
  }
  enforceToolLossPolicy(diagnostics, options.toolLossPolicy ?? "allow");
  const effectiveMetadata = {
    ...metadata,
    ...(Object.keys(encoded.toolNameMap).length ? { toolNameMap: encoded.toolNameMap } : {}),
    ...(Object.keys(encoded.toolNamespaceMap).length ? { toolNamespaceMap: encoded.toolNamespaceMap } : {}),
    ...(Object.keys(encoded.toolKindMap).length ? { toolKindMap: encoded.toolKindMap } : {}),
    ...(Object.keys(encoded.toolChoiceMap).length ? { toolChoiceMap: encoded.toolChoiceMap } : {}),
  };
  return { value: encoded.value, from: source, to: target, converterId: path.steps.map((step) => step.id).join("/"), quality: path.quality, steps: path.steps, diagnostics, metadata: effectiveMetadata };
}

/**
 * Apply explicit route capability observations before protocol encoding.
 * Keeping this at the canonical boundary is important: a parameter removed
 * from the incoming wire body must not be reintroduced by a Responses -> Chat
 * or Gemini generationConfig mapping. Unknown capabilities remain untouched
 * so legacy providers keep their existing request semantics until an upstream
 * rejection provides concrete evidence.
 */
function filterCanonicalSamplingParameters(
  parameters: CanonicalRequestParameters,
  profile: CapabilityProfile | undefined,
  policy: ConversionOptions["capabilityPolicy"],
  protocol: GatewayProtocol,
): CanonicalRequestParameters {
  if (policy !== "safe" || !profile) return parameters;
  const next: CanonicalRequestParameters = { ...parameters };
  if (isFreshUnsupported(profile["params.temperature"])) delete next.temperature;
  if (isFreshUnsupported(profile["params.top_p"])) delete next.topP;
  if (isFreshUnsupported(profile["params.top_k"])) {
    delete next.topK;
    delete next.topKAnthropic;
  }
  // Gemini keeps a raw generationConfig alongside the normalized fields. If
  // only the canonical values are deleted, the raw spread in the encoder
  // would silently put them back on the wire.
  if (protocol === "gemini" && next.geminiGenerationConfig) {
    const generationConfig = { ...next.geminiGenerationConfig };
    if (isFreshUnsupported(profile["params.temperature"])) delete generationConfig.temperature;
    if (isFreshUnsupported(profile["params.top_p"])) {
      delete generationConfig.topP;
      delete generationConfig.top_p;
    }
    if (isFreshUnsupported(profile["params.top_k"])) {
      delete generationConfig.topK;
      delete generationConfig.top_k;
    }
    next.geminiGenerationConfig = generationConfig;
  }
  return next;
}

function isFreshUnsupported(observation: CapabilityProfile[string] | undefined): boolean {
  return observation?.status === "unsupported" && isCapabilityFresh(observation);
}

function decodeCanonicalRequest(protocol: GatewayProtocol, body: JsonObject): CanonicalRequest {
  if (protocol === "gemini") body = normalizeGeminiWire(body);
  if (protocol === "responses") {
    return {
      model: asString(body.model) ?? "",
      messages: [...decodeMessages("system", body.instructions), ...decodeMessagesFromInput(body.input)],
      tools: decodeTools(protocol, body.tools),
      stream: body.stream === true,
      reasoning: decodeReasoning(protocol, body),
      parameters: decodeResponsesParameters(body),
      toolChoice: body.tool_choice,
      parallelToolCalls: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : undefined,
      metadata: pickMetadata(body),
      previousResponseId: asString(body.previous_response_id),
    };
  }
  if (protocol === "chat_completions") {
    return {
      model: asString(body.model) ?? "",
      messages: decodeMessagesArray(body.messages),
      tools: [
        ...decodeTools(protocol, body.tools),
        ...(isObject(body.web_search_options) ? [{ kind: "web_search" as const, name: "web_search", raw: { type: "web_search_options", web_search_options: body.web_search_options } }] : []),
      ],
      stream: body.stream === true,
      reasoning: decodeReasoning(protocol, body),
      parameters: decodeChatParameters(body),
      toolChoice: body.tool_choice,
      parallelToolCalls: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : undefined,
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
      parameters: decodeAnthropicParameters(body),
      toolChoice: body.tool_choice,
      parallelToolCalls: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : undefined,
      metadata: pickMetadata(body),
    };
  }
  return {
    model: asString(body.model) ?? "",
    messages: [...decodeMessages("system", body.systemInstruction), ...decodeMessagesArray(body.contents)],
    tools: decodeTools(protocol, body.tools),
    stream: body.stream === true,
    reasoning: decodeReasoning(protocol, body),
    parameters: decodeGeminiParameters(body),
    toolChoice: isObject(body.toolConfig) ? body.toolConfig : body.tool_choice,
    parallelToolCalls: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : undefined,
    metadata: pickMetadata(body),
  };
}

function encodeProtocolRequest(source: GatewayProtocol, protocol: GatewayProtocol, request: CanonicalRequest, options: ConversionOptions, diagnostics: ConversionDiagnostic[], upstreamEndpoint?: string): { value: JsonObject; toolNameMap: Record<string, string>; toolNamespaceMap: Record<string, string>; toolKindMap: NonNullable<QualifiedToolSet["toolKindMap"]>; toolChoiceMap: Record<string, string> } {
  const qualifiedTools = applyAllowedTools(qualifyToolsForProtocol(protocol, request.tools), request.toolChoice, protocol);
  const tools = qualifiedTools.tools;
  const reasoning = encodeReasoning(protocol, request.reasoning);
  const encodedTools = encodeTools(protocol, tools, options.capabilityProfile, options.capabilityPolicy ?? "allow", (tool, reason) => {
    diagnostics.push({ code: "capability_tool_omitted", level: "warning", message: `Omitted ${tool.name}: ${reason}`, source, target: protocol, path: "tools" });
  });
  // Chat Completions exposes hosted web search as a top-level member rather
  // than a `tools[]` entry.  Encode only callable function tools in the
  // array, and preserve the hosted options separately.
  const encodedChatTools = protocol === "chat_completions"
    ? encodeTools(protocol, tools.filter((tool) => tool.kind !== "web_search"), options.capabilityProfile, options.capabilityPolicy ?? "allow", (tool, reason) => {
      diagnostics.push({ code: "capability_tool_omitted", level: "warning", message: `Omitted ${tool.name}: ${reason}`, source, target: protocol, path: "tools" });
    })
    : encodedTools;
  if (protocol === "responses") {
    const toolChoice = encodeToolChoice(protocol, request.toolChoice);
    return { value: {
      model: request.model,
      input: request.messages.map((message) => ({ role: message.role, ...(message.name ? { name: message.name } : {}), ...(message.phase ? { phase: message.phase } : {}), content: message.parts.map((part) => encodeResponsesPart(part, message.role)) })),
      stream: request.stream,
      ...(encodedTools ? { tools: encodedTools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      ...(request.parallelToolCalls !== undefined ? { parallel_tool_calls: request.parallelToolCalls } : {}),
      ...(reasoning ? { reasoning: reasoning } : {}),
      ...encodeResponsesParameters(request.parameters),
      ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
      ...request.metadata,
    }, toolNameMap: qualifiedTools.toolNameMap, toolNamespaceMap: qualifiedTools.toolNamespaceMap, toolKindMap: qualifiedTools.toolKindMap, toolChoiceMap: qualifiedTools.toolChoiceMap };
  }
  if (protocol === "chat_completions") {
    const toolChoice = encodeToolChoice(protocol, request.toolChoice, undefined, qualifiedTools.toolChoiceMap);
    const webSearchOptions = request.parameters.webSearchOptions ?? webSearchOptionsFromTools(tools);
    const result: JsonObject = {
      model: request.model,
      messages: request.messages.map((message) => encodeChatMessage(message, options.instructionRole)),
      stream: request.stream,
      ...(encodedChatTools ? { tools: encodedChatTools } : {}),
      ...(reasoning?.effort ? { reasoning_effort: reasoning.effort } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      ...(request.parallelToolCalls !== undefined ? { parallel_tool_calls: request.parallelToolCalls } : {}),
      ...encodeChatParameters(request.parameters, options.chatMaxTokensField),
      ...(webSearchOptions !== undefined ? { web_search_options: webSearchOptions } : {}),
      ...request.metadata,
    };
    if (upstreamRequiresMoonshotSchema(upstreamEndpoint)) {
      const rewritten = normalizeMoonshotChatTools(result);
      if (rewritten > 0) diagnostics.push({ code: "moonshot_ref_sibling_schema_rewrite", level: "warning", message: `Rewrote ${rewritten} Moonshot JSON Schema node(s) with $ref siblings`, source, target: protocol, path: "tools" });
    }
    return { value: result, toolNameMap: qualifiedTools.toolNameMap, toolNamespaceMap: qualifiedTools.toolNamespaceMap, toolKindMap: qualifiedTools.toolKindMap, toolChoiceMap: qualifiedTools.toolChoiceMap };
  }
  if (protocol === "anthropic") {
    const system = request.messages.filter((message) => message.role === "system" || message.role === "developer").flatMap((message) => message.parts).map((part) => encodeText(part.value)).filter(Boolean).join("\n") || undefined;
    const messages = request.messages.filter((message) => message.role !== "system" && message.role !== "developer").map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: encodeAnthropicContent(message.parts) }));
    const toolChoice = encodeToolChoice(protocol, request.toolChoice, request.parallelToolCalls, qualifiedTools.toolChoiceMap);
    return { value: {
      model: request.model,
      ...(system ? { system } : {}),
      messages,
      max_tokens: request.parameters.maxTokens ?? request.parameters.maxCompletionTokens ?? 4096,
      stream: request.stream,
      ...(encodedTools ? { tools: encodedTools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      ...(reasoning ? { thinking: reasoning } : {}),
      ...encodeAnthropicParameters(request.parameters),
      ...request.metadata,
    }, toolNameMap: qualifiedTools.toolNameMap, toolNamespaceMap: qualifiedTools.toolNamespaceMap, toolKindMap: qualifiedTools.toolKindMap, toolChoiceMap: qualifiedTools.toolChoiceMap };
  }
  const system = request.messages.filter((message) => message.role === "system" || message.role === "developer").flatMap((message) => message.parts).map((part) => encodeText(part.value)).filter(Boolean).join("\n") || undefined;
  const toolChoice = encodeToolChoice(protocol, request.toolChoice, undefined, qualifiedTools.toolChoiceMap);
  return { value: {
    model: request.model,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: message.parts.map((part) => encodeGeminiPart(part)) })),
    ...(encodedTools ? { tools: encodedTools } : {}),
    ...(toolChoice !== undefined ? { toolConfig: toolChoice } : {}),
    generationConfig: encodeGeminiGenerationConfig(request.parameters, reasoning),
    ...(request.parameters.safetySettings !== undefined ? { safetySettings: request.parameters.safetySettings } : {}),
    ...(request.parameters.cachedContent !== undefined ? { cachedContent: request.parameters.cachedContent } : {}),
    ...request.metadata,
  }, toolNameMap: qualifiedTools.toolNameMap, toolNamespaceMap: qualifiedTools.toolNamespaceMap, toolKindMap: qualifiedTools.toolKindMap, toolChoiceMap: qualifiedTools.toolChoiceMap };
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
    if (["function_call", "custom_tool_call", "tool_search_call"].includes(type ?? "")) {
      return [{ role: "assistant" as const, parts: [{ type: "tool_use" as const, value: item }] }];
    }
    if (["function_call_output", "custom_tool_call_output", "tool_search_call_output", "tool_search_output"].includes(type ?? "")) {
      return [{ role: "tool" as const, parts: [{ type: "tool_result" as const, value: item }] }];
    }
    if (type === "agent_message") {
      return [{ role: "user" as const, parts: decodeParts(item.content ?? item.text ?? "") }];
    }
    if (type === "compaction" || type === "compaction_summary") {
      const summary = item.summary ?? item.content ?? item.text;
      // Encrypted compaction payloads are opaque to the gateway.  Do not
      // serialize them into a provider prompt; only replay an explicit,
      // human-readable summary.
      if (typeof summary === "string" && summary.trim()) return [{ role: "assistant" as const, parts: [{ type: "reasoning" as const, value: summary, wireType: type }] }];
      return [];
    }
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
    const parts = role === "tool" && (asString(item.tool_call_id) || asString(item.call_id))
      ? [{ type: "tool_result" as const, value: { ...item, tool_call_id: asString(item.tool_call_id) ?? asString(item.call_id) ?? "call", content: item.content ?? item.output ?? "" } }]
      : contentValue !== undefined ? decodeParts(contentValue) : [];
    const toolCalls = Array.isArray(item.tool_calls) ? item.tool_calls.flatMap((call) => isObject(call) ? [{ type: "tool_use" as const, value: call }] : []) : [];
    return [{ role, parts: [...parts, ...toolCalls], ...(asString(item.name) ? { name: asString(item.name) } : {}), ...(item.phase === "commentary" || item.phase === "final_answer" ? { phase: item.phase } : {}) }];
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
  const signature = asString(value.thoughtSignature) ?? asString(value.thought_signature) ?? asString(value.signature);
  if (text !== undefined) return [{ type: type?.includes("reason") || type === "thinking" ? "reasoning" : "text", value: text, ...(type ? { wireType: type } : {}), ...(signature ? { signature } : {}) }];
  const media = asMediaPart(value);
  if (media) return [{ type: media.type, value, media }];
  if (isObject(value.functionCall)) return [{ type: "tool_use", value: { ...value.functionCall, ...(signature ? { thoughtSignature: signature } : {}) } }];
  if (isObject(value.functionResponse)) return [{ type: "tool_result", value: value.functionResponse }];
  if (type === "redacted_thinking" || type === "encrypted_thinking") return [{ type: "reasoning", value: asString(value.data) ?? asString(value.encrypted_content) ?? "", wireType: type, ...(signature ? { signature } : {}) }];
  if (["tool_use", "function_call", "custom_tool_call", "tool_search_call", "toolCall"].includes(type ?? "")) return [{ type: "tool_use", value }];
  if (["tool_result", "function_call_output", "custom_tool_call_output", "tool_search_call_output", "functionResponse"].includes(type ?? "")) return [{ type: "tool_result", value }];
  return [{ type: "unknown", value }];
}

function encodeResponsesPart(part: CanonicalPart, role: CanonicalRole = "user"): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { type: role === "assistant" || part.wireType === "output_text" ? "output_text" : "input_text", text: encodeText(part.value) };
  if (part.type === "image") return part.media?.data ? { type: "input_image", image_url: `data:${part.media.mimeType ?? "image/png"};base64,${part.media.data}` } : { type: "input_image", image_url: part.media?.url ?? "" };
  if (part.type === "file") return part.media?.data ? { type: "input_file", file_data: `data:${part.media.mimeType ?? "application/octet-stream"};base64,${part.media.data}`, ...(part.media.fileName ? { filename: part.media.fileName } : {}) } : { type: "input_file", file_url: part.media?.url ?? "" };
  if (part.type === "tool_use" && isObject(part.value)) {
    const name = asString(part.value.name) ?? "tool";
    const originalType = asString(part.value.type);
    const callId = asString(part.value.call_id) ?? asString(part.value.id) ?? `name:${name}`;
    if (originalType === "custom_tool_call") return { type: "custom_tool_call", call_id: callId, name, input: asString(part.value.input) ?? JSON.stringify(part.value.input ?? "") };
    if (originalType === "tool_search_call") return { type: "tool_search_call", call_id: callId, name, ...(isObject(part.value.input) ? { input: part.value.input } : {}) };
    return { type: "function_call", call_id: callId, name, arguments: asString(part.value.arguments) ?? JSON.stringify(part.value.input ?? part.value.args ?? {}) };
  }
  if (part.type === "tool_result" && isObject(part.value)) {
    const name = asString(part.value.name);
    const originalType = asString(part.value.type);
    const callId = asString(part.value.call_id) ?? asString(part.value.tool_call_id) ?? asString(part.value.tool_use_id) ?? asString(part.value.id) ?? (name ? `name:${name}` : "call");
    const output = part.value.output ?? part.value.content ?? "";
    const error = part.value.is_error ?? part.value.isError;
    if (originalType === "custom_tool_call_output") return { type: "custom_tool_call_output", call_id: callId, output, ...(typeof error === "boolean" ? { is_error: error } : {}) };
    if (originalType === "tool_search_call_output" || originalType === "tool_search_output") return { type: "tool_search_call_output", call_id: callId, output, ...(typeof error === "boolean" ? { is_error: error } : {}) };
    return { type: "function_call_output", call_id: callId, output, ...(typeof error === "boolean" ? { is_error: error } : {}) };
  }
  return { type: part.type === "tool_use" ? "function_call" : part.type === "tool_result" ? "function_call_output" : "input_text", ...(isObject(part.value) ? part.value : { text: String(part.value) }) };
}

function encodeChatMessage(message: CanonicalMessage, instructionRole: ConversionOptions["instructionRole"] = "auto"): JsonObject {
  const toolFields = encodeChatToolFields(message.parts);
  const hasToolCall = message.parts.some((part) => part.type === "tool_use");
  const hasVisibleContent = message.parts.some((part) => part.type === "text" || part.type === "image" || part.type === "file");
  const role = message.role === "developer" && instructionRole !== "developer" ? "system" : message.role;
  const result: JsonObject = { role, ...(message.name ? { name: message.name } : {}), content: hasToolCall && !hasVisibleContent ? null : encodeChatContent(message.parts), ...toolFields };
  if (message.role === "tool" && isObject(message.parts[0]?.value)) {
    const value = message.parts[0].value;
    const fallbackName = asString(value.name);
    result.tool_call_id = asString(value.tool_call_id) ?? asString(value.call_id) ?? asString(value.tool_use_id) ?? asString(value.id) ?? (fallbackName ? `name:${fallbackName}` : "call");
    result.content = encodeChatToolResultContent(value.output ?? value.content ?? "");
  }
  return result;
}

function encodeChatToolResultContent(value: JsonValue): JsonValue {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return encodeText(value);
  return value.map((part): JsonObject => {
    if (!isObject(part)) return { type: "text", text: encodeText(part) };
    if (["output_text", "input_text", "text"].includes(asString(part.type) ?? "")) return { type: "text", text: encodeText(part.text ?? "") };
    if (["output_image", "input_image", "image_url"].includes(asString(part.type) ?? "")) {
      const url = asString(part.image_url) ?? (isObject(part.image_url) ? asString(part.image_url.url) : undefined) ?? "";
      return { type: "image_url", image_url: { url } };
    }
    return { type: "text", text: encodeText(part) };
  });
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
    const name = asString(part.value.name) ?? "tool";
    calls.push({ id: asString(part.value.call_id) ?? asString(part.value.id) ?? `name:${name}`, type: "function", function: { name, arguments: asString(part.value.arguments) ?? JSON.stringify(part.value.input ?? part.value.args ?? {}) } });
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
  if (part.type === "text") return { type: "text", text: encodeText(part.value) };
  if (part.type === "reasoning") return { type: "thinking", thinking: encodeText(part.value), ...(part.signature ? { signature: part.signature } : {}) };
  if (part.type === "image") return part.media?.data ? { type: "image", source: { type: "base64", media_type: part.media.mimeType ?? "image/png", data: part.media.data } } : { type: "image", source: { type: "url", url: part.media?.url ?? "" } };
  if (part.type === "file") return part.media?.data ? { type: "document", source: { type: "base64", media_type: part.media.mimeType ?? "application/octet-stream", data: part.media.data } } : { type: "document", source: { type: "url", url: part.media?.url ?? "" } };
  if (part.type === "tool_use" && isObject(part.value)) {
    const name = asString(part.value.name) ?? "tool";
    return { type: "tool_use", id: asString(part.value.call_id) ?? asString(part.value.id) ?? `name:${name}`, name, input: parseArguments(asString(part.value.arguments), part.value.input ?? part.value.args) };
  }
  if (part.type === "tool_result" && isObject(part.value)) {
    const name = asString(part.value.name);
    const isError = part.value.is_error ?? part.value.isError;
    return { type: "tool_result", tool_use_id: asString(part.value.call_id) ?? asString(part.value.tool_call_id) ?? asString(part.value.tool_use_id) ?? asString(part.value.id) ?? (name ? `name:${name}` : "call"), content: part.value.output ?? part.value.content ?? "", ...(typeof isError === "boolean" ? { is_error: isError } : {}) };
  }
  return isObject(part.value) ? part.value : { type: "text", text: String(part.value) };
}
function encodeGeminiPart(part: CanonicalPart): JsonObject {
  if (part.type === "text" || part.type === "reasoning") return { text: encodeText(part.value), ...(part.type === "reasoning" ? { thought: true } : {}), ...(part.signature ? { thoughtSignature: part.signature } : {}) };
  if (part.type === "image") return part.media?.data ? { inlineData: { mimeType: part.media.mimeType ?? "image/png", data: part.media.data } } : { fileData: { fileUri: part.media?.url ?? "" } };
  if (part.type === "file") return part.media?.data ? { inlineData: { mimeType: part.media.mimeType ?? "application/octet-stream", data: part.media.data } } : { fileData: { fileUri: part.media?.url ?? "" } };
  if (part.type === "tool_use" && isObject(part.value)) return { functionCall: { name: asString(part.value.name) ?? "tool", args: parseArguments(asString(part.value.arguments), part.value.input) }, ...(asString(part.value.thoughtSignature) ? { thoughtSignature: asString(part.value.thoughtSignature) } : {}) };
  if (part.type === "tool_result" && isObject(part.value)) {
    const isError = part.value.is_error ?? part.value.isError;
    return { functionResponse: { name: asString(part.value.name) ?? "tool", response: part.value.output ?? part.value.content ?? {}, ...(typeof isError === "boolean" ? { isError } : {}) } };
  }
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
    if (tool.kind === "web_search" && target !== "responses" && target !== source) diagnostics.push({ code: "web_search_tool_downgrade", level: "warning", message: "Provider-native web search is not protocol-equivalent and was mapped to the target tool form", source, target, path: "tools" });
    if ((tool.kind === "code_interpreter" || tool.kind === "computer_use" || tool.kind === "hosted") && target !== "responses" && target !== source) diagnostics.push({ code: "hosted_tool_downgrade", level: "warning", message: `Hosted tool '${tool.name}' has no protocol-equivalent target shape and may be omitted`, source, target, path: "tools" });
    if (tool.deferLoading && target !== "responses") diagnostics.push({ code: "deferred_tool_downgrade", level: "warning", message: `Deferred loading for '${tool.name}' is only defined by the Responses namespace contract`, source, target, path: "tools" });
    if (tool.strict && (target === "anthropic" || target === "gemini")) diagnostics.push({ code: "strict_tool_downgrade", level: "warning", message: `Strictness for '${tool.name}' is not part of the ${target} tool schema and was omitted`, source, target, path: "tools" });
  }
  if (request.parallelToolCalls === true && target === "anthropic") diagnostics.push({ code: "parallel_tool_calls_downgrade", level: "warning", message: "Anthropic represents parallel-tool policy through tool_choice and has no direct parallel_tool_calls field", source, target, path: "parallel_tool_calls" });
  return diagnostics;
}

/**
 * Responses can restrict the candidate set with `allowed_tools`. Chat,
 * Anthropic and Gemini do not have an equivalent envelope, so preserve the
 * semantic restriction by filtering the emitted definitions and mapping the
 * mode to the closest native tool-choice value.
 */
function applyAllowedTools(set: QualifiedToolSet, value: JsonValue | undefined, protocol: GatewayProtocol): QualifiedToolSet {
  if (protocol === "responses" || !isObject(value) || value.type !== "allowed_tools" || !Array.isArray(value.tools)) return set;
  const allowed = new Set(value.tools.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!isObject(item)) return [];
    const name = asString(item.name) ?? (isObject(item.function) ? asString(item.function.name) : undefined);
    return name ? [name] : [];
  }));
  if (!allowed.size) return { ...set, tools: [] };
  return {
    ...set,
    tools: set.tools.filter((tool) => allowed.has(tool.name) || allowed.has(set.toolNameMap[tool.name] ?? "")),
  };
}

/** Convert tool-choice objects between the four independently-defined APIs. */
function encodeToolChoice(protocol: GatewayProtocol, value: JsonValue | undefined, parallel?: boolean, toolChoiceMap: Record<string, string> = {}): JsonValue | undefined {
  if (value === undefined) {
    if (protocol === "anthropic" && parallel === false) return { type: "auto", disable_parallel_tool_use: true };
    return undefined;
  }
  if (protocol === "responses") return value;
  if (isObject(value) && value.type === "allowed_tools") {
    const mode = asString(value.mode) ?? "auto";
    if (protocol === "chat_completions") return mode === "required" ? "required" : "auto";
    if (protocol === "anthropic") return { type: mode === "required" ? "any" : "auto" };
    return { functionCallingConfig: { mode: mode === "required" ? "ANY" : "AUTO" } };
  }
  if (protocol === "chat_completions") {
    if (typeof value === "string") return value;
    if (!isObject(value)) return value;
    if (value.type === "function" && typeof value.name === "string") return { type: "function", function: { name: toolChoiceMap[value.name] ?? value.name } };
    return value;
  }
  if (protocol === "anthropic") {
    if (typeof value === "string") {
      const type = value === "required" ? "any" : value === "none" ? "none" : value;
      return compactObject({ type, ...(parallel === false ? { disable_parallel_tool_use: true } : {}) });
    }
    if (!isObject(value)) return value;
    const name = typeof value.name === "string" ? value.name : isObject(value.function) && typeof value.function.name === "string" ? value.function.name : undefined;
    const type = value.type === "function" || value.type === "tool" ? "tool" : value.type === "required" ? "any" : value.type;
    return compactObject({ type, ...(name ? { name: toolChoiceMap[name] ?? name } : {}), ...(parallel === false ? { disable_parallel_tool_use: true } : {}) });
  }
  if (isObject(value) && isObject(value.functionCallingConfig)) {
    const config = value.functionCallingConfig;
    const mode = typeof config.mode === "string" ? config.mode.toUpperCase() : "AUTO";
    const allowed = Array.isArray(config.allowedFunctionNames)
      ? config.allowedFunctionNames.filter((name): name is string => typeof name === "string").map((name) => toolChoiceMap[name] ?? name)
      : undefined;
    return { functionCallingConfig: compactObject({ mode, ...(allowed?.length ? { allowedFunctionNames: allowed } : {}) }) };
  }
  const mode = typeof value === "string" ? value : isObject(value) ? value.type : undefined;
  const functionName = isObject(value) ? (typeof value.name === "string" ? value.name : isObject(value.function) && typeof value.function.name === "string" ? value.function.name : undefined) : undefined;
  const normalizedMode = mode === "required" || mode === "any" ? "ANY" : mode === "none" ? "NONE" : "AUTO";
  return { functionCallingConfig: compactObject({ mode: normalizedMode, ...(functionName ? { allowedFunctionNames: [toolChoiceMap[functionName] ?? functionName] } : {}) }) };
}
function encodeText(value: JsonValue): string { return typeof value === "string" ? value : JSON.stringify(value); }

function decodeResponsesParameters(body: JsonObject): CanonicalRequestParameters {
  return compactCanonicalParameters({
    maxTokens: asNumber(body.max_output_tokens),
    maxCompletionTokens: asNumber(body.max_completion_tokens),
    temperature: asNumber(body.temperature),
    topP: asNumber(body.top_p),
    stop: body.stop,
    serviceTier: asString(body.service_tier),
    promptCacheKey: asString(body.prompt_cache_key),
    include: body.include,
    streamOptions: isObject(body.stream_options) ? body.stream_options : undefined,
    textFormat: isObject(body.text) ? body.text : undefined,
    clientMetadata: isObject(body.client_metadata) ? body.client_metadata : undefined,
    providerMetadata: isObject(body.metadata) ? body.metadata : undefined,
    modalities: body.modalities,
    prediction: body.prediction,
    store: typeof body.store === "boolean" ? body.store : undefined,
    background: typeof body.background === "boolean" ? body.background : undefined,
    truncation: asString(body.truncation),
    safetyIdentifier: asString(body.safety_identifier),
    maxToolCalls: asNumber(body.max_tool_calls),
    promptCacheRetention: asString(body.prompt_cache_retention),
    topLogprobs: asNumber(body.top_logprobs),
    user: asString(body.user),
  });
}

function decodeChatParameters(body: JsonObject): CanonicalRequestParameters {
  return compactCanonicalParameters({
    maxTokens: asNumber(body.max_tokens),
    maxCompletionTokens: asNumber(body.max_completion_tokens),
    temperature: asNumber(body.temperature),
    topP: asNumber(body.top_p),
    stop: body.stop,
    serviceTier: asString(body.service_tier),
    promptCacheKey: asString(body.prompt_cache_key),
    responseFormat: body.response_format,
    webSearchOptions: isObject(body.web_search_options) ? body.web_search_options : undefined,
    streamOptions: isObject(body.stream_options) ? body.stream_options : undefined,
    clientMetadata: isObject(body.metadata) ? body.metadata : undefined,
    frequencyPenalty: asNumber(body.frequency_penalty),
    presencePenalty: asNumber(body.presence_penalty),
    topLogprobs: asNumber(body.top_logprobs),
    logprobs: body.logprobs,
    topK: asNumber(body.top_k),
    seed: asNumber(body.seed),
    n: asNumber(body.n),
    user: asString(body.user),
    modalities: body.modalities,
    prediction: body.prediction,
    logitBias: body.logit_bias,
    audio: body.audio,
  });
}

function webSearchOptionsFromTools(tools: readonly CanonicalTool[]): JsonObject | undefined {
  const search = tools.find((tool) => tool.kind === "web_search");
  if (!search) return undefined;
  const raw = search.raw;
  return isObject(raw?.web_search_options) ? raw.web_search_options : {};
}

function decodeAnthropicParameters(body: JsonObject): CanonicalRequestParameters {
  const outputConfig = isObject(body.output_config) ? body.output_config : undefined;
  return compactCanonicalParameters({
    maxTokens: asNumber(body.max_tokens),
    temperature: asNumber(body.temperature),
    topP: asNumber(body.top_p),
    stopSequences: body.stop_sequences,
    providerMetadata: isObject(body.metadata) ? body.metadata : undefined,
    outputConfig,
    responseFormat: isObject(outputConfig?.format) ? outputConfig.format : undefined,
    speed: asString(body.speed),
    safeguards: body.safeguards,
    topK: asNumber(body.top_k),
    contextManagement: isObject(body.context_management) ? body.context_management : undefined,
    container: body.container,
    mcpServers: body.mcp_servers,
    betas: body.betas,
  });
}

function decodeGeminiParameters(body: JsonObject): CanonicalRequestParameters {
  const generationConfig = isObject(body.generationConfig)
    ? body.generationConfig
    : isObject(body.generation_config) ? body.generation_config : undefined;
  if (!generationConfig) return compactCanonicalParameters({
    safetySettings: body.safetySettings ?? body.safety_settings,
    cachedContent: asString(body.cachedContent) ?? asString(body.cached_content),
  });
  const responseSchema = generationConfig.responseSchema ?? generationConfig.responseJsonSchema;
  const responseMimeType = asString(generationConfig.responseMimeType) ?? asString(generationConfig.response_mime_type);
  return compactCanonicalParameters({
    maxTokens: asNumber(generationConfig.maxOutputTokens) ?? asNumber(generationConfig.max_output_tokens),
    temperature: asNumber(generationConfig.temperature),
    topP: asNumber(generationConfig.topP) ?? asNumber(generationConfig.top_p),
    stopSequences: generationConfig.stopSequences ?? generationConfig.stop_sequences,
    geminiGenerationConfig: generationConfig,
    topK: asNumber(generationConfig.topK) ?? asNumber(generationConfig.top_k),
    safetySettings: body.safetySettings ?? body.safety_settings,
    cachedContent: asString(body.cachedContent) ?? asString(body.cached_content),
    ...(responseSchema && isObject(responseSchema) ? { responseFormat: { type: "json_schema", schema: responseSchema } } : responseMimeType === "application/json" ? { responseFormat: { type: "json_object" } } : {}),
  });
}

function encodeResponsesParameters(parameters: CanonicalRequestParameters): JsonObject {
  const text = parameters.textFormat ?? responseFormatToResponsesText(parameters.responseFormat);
  const maxTokens = parameters.maxTokens ?? parameters.maxCompletionTokens;
  return compactObject({
    ...(maxTokens !== undefined ? { max_output_tokens: maxTokens } : {}),
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { top_p: parameters.topP } : {}),
    ...(parameters.stop !== undefined ? { stop: parameters.stop } : {}),
    ...(parameters.serviceTier !== undefined ? { service_tier: parameters.serviceTier } : {}),
    ...(parameters.promptCacheKey !== undefined ? { prompt_cache_key: parameters.promptCacheKey } : {}),
    ...(parameters.include !== undefined ? { include: parameters.include } : {}),
    ...(parameters.streamOptions !== undefined ? { stream_options: parameters.streamOptions } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(parameters.clientMetadata !== undefined ? { client_metadata: parameters.clientMetadata } : {}),
    ...(parameters.providerMetadata !== undefined ? { metadata: parameters.providerMetadata } : {}),
    ...(parameters.modalities !== undefined ? { modalities: parameters.modalities } : {}),
    ...(parameters.prediction !== undefined ? { prediction: parameters.prediction } : {}),
    ...(parameters.store !== undefined ? { store: parameters.store } : {}),
    ...(parameters.background !== undefined ? { background: parameters.background } : {}),
    ...(parameters.truncation !== undefined ? { truncation: parameters.truncation } : {}),
    ...(parameters.safetyIdentifier !== undefined ? { safety_identifier: parameters.safetyIdentifier } : {}),
    ...(parameters.maxToolCalls !== undefined ? { max_tool_calls: parameters.maxToolCalls } : {}),
    ...(parameters.promptCacheRetention !== undefined ? { prompt_cache_retention: parameters.promptCacheRetention } : {}),
    ...(parameters.topLogprobs !== undefined ? { top_logprobs: parameters.topLogprobs } : {}),
    ...(parameters.user !== undefined ? { user: parameters.user } : {}),
  });
}

function encodeChatParameters(parameters: CanonicalRequestParameters, tokenField?: "max_tokens" | "max_completion_tokens"): JsonObject {
  const selectedTokenField = tokenField ?? (parameters.maxCompletionTokens !== undefined ? "max_completion_tokens" : "max_tokens");
  const selectedTokens = parameters.maxCompletionTokens ?? parameters.maxTokens;
  const responseFormat = parameters.responseFormat ?? responsesTextToChatFormat(parameters.textFormat);
  return compactObject({
    ...(selectedTokens !== undefined ? { [selectedTokenField]: selectedTokens } : {}),
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { top_p: parameters.topP } : {}),
    ...(parameters.stop !== undefined ? { stop: parameters.stop } : {}),
    ...(parameters.serviceTier !== undefined ? { service_tier: parameters.serviceTier } : {}),
    ...(parameters.promptCacheKey !== undefined ? { prompt_cache_key: parameters.promptCacheKey } : {}),
    ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    ...(parameters.streamOptions !== undefined ? { stream_options: parameters.streamOptions } : {}),
    ...(parameters.clientMetadata !== undefined ? { metadata: parameters.clientMetadata } : {}),
    ...(parameters.frequencyPenalty !== undefined ? { frequency_penalty: parameters.frequencyPenalty } : {}),
    ...(parameters.presencePenalty !== undefined ? { presence_penalty: parameters.presencePenalty } : {}),
    ...(parameters.topLogprobs !== undefined ? { top_logprobs: parameters.topLogprobs } : {}),
    ...(parameters.logprobs !== undefined ? { logprobs: parameters.logprobs } : {}),
    ...(parameters.topK !== undefined ? { top_k: parameters.topK } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters.n !== undefined ? { n: parameters.n } : {}),
    ...(parameters.user !== undefined ? { user: parameters.user } : {}),
    ...(parameters.modalities !== undefined ? { modalities: parameters.modalities } : {}),
    ...(parameters.prediction !== undefined ? { prediction: parameters.prediction } : {}),
    ...(parameters.logitBias !== undefined ? { logit_bias: parameters.logitBias } : {}),
    ...(parameters.audio !== undefined ? { audio: parameters.audio } : {}),
  });
}

function encodeAnthropicParameters(parameters: CanonicalRequestParameters): JsonObject {
  const outputConfig = parameters.outputConfig || parameters.responseFormat ? {
    ...(parameters.outputConfig ?? {}),
    ...(parameters.responseFormat !== undefined ? { format: parameters.responseFormat } : {}),
  } : undefined;
  return compactObject({
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { top_p: parameters.topP } : {}),
    ...(parameters.stopSequences !== undefined ? { stop_sequences: parameters.stopSequences } : parameters.stop !== undefined ? { stop_sequences: parameters.stop } : {}),
    ...(parameters.providerMetadata !== undefined ? { metadata: parameters.providerMetadata } : {}),
    ...(outputConfig !== undefined ? { output_config: outputConfig } : {}),
    ...(parameters.speed !== undefined ? { speed: parameters.speed } : {}),
    ...(parameters.safeguards !== undefined ? { safeguards: parameters.safeguards } : {}),
    ...(parameters.topK !== undefined ? { top_k: parameters.topK } : {}),
    ...(parameters.contextManagement !== undefined ? { context_management: parameters.contextManagement } : {}),
    ...(parameters.container !== undefined ? { container: parameters.container } : {}),
    ...(parameters.mcpServers !== undefined ? { mcp_servers: parameters.mcpServers } : {}),
    ...(parameters.betas !== undefined ? { betas: parameters.betas } : {}),
  });
}

function encodeGeminiGenerationConfig(parameters: CanonicalRequestParameters, reasoning: JsonObject | undefined): JsonObject {
  const responseFormat = parameters.responseFormat ?? responsesTextToGeminiFormat(parameters.textFormat);
  const raw = parameters.geminiGenerationConfig ?? {};
  const responseSchema = isObject(responseFormat) && asString(responseFormat.type) === "json_schema"
    ? isObject(responseFormat.schema)
      ? responseFormat.schema
      : isObject(responseFormat.json_schema)
        ? (isObject(responseFormat.json_schema.schema) ? responseFormat.json_schema.schema : responseFormat.json_schema)
        : undefined
    : undefined;
  const responseMimeType = asString(raw.responseMimeType) ?? asString(raw.response_mime_type) ?? (isObject(responseFormat) && asString(responseFormat.type) === "json_object" ? "application/json" : undefined);
  return compactObject({
    ...raw,
    ...(responseMimeType !== undefined ? { responseMimeType } : {}),
    ...(parameters.maxTokens !== undefined ? { maxOutputTokens: parameters.maxTokens } : {}),
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { topP: parameters.topP } : {}),
    ...(parameters.stopSequences !== undefined ? { stopSequences: parameters.stopSequences } : {}),
    ...(parameters.topK !== undefined ? { topK: parameters.topK } : {}),
    ...(responseSchema ? { responseSchema } : {}),
    ...(reasoning ?? {}),
  });
}

function responseFormatToResponsesText(value: JsonValue | undefined): JsonObject | undefined {
  if (!isObject(value)) return undefined;
  if (asString(value.type) === "json_schema" && isObject(value.json_schema)) return { format: value };
  return { format: value };
}

function responsesTextToChatFormat(value: JsonObject | undefined): JsonObject | undefined {
  if (!value) return undefined;
  const format = isObject(value.format) ? value.format : value.format;
  return isObject(format) ? format : undefined;
}

function responsesTextToGeminiFormat(value: JsonObject | undefined): JsonObject | undefined {
  if (!value) return undefined;
  const format = isObject(value.format) ? value.format : undefined;
  if (!format) return undefined;
  if (asString(format.type) === "json_schema") {
    const schema = isObject(format.json_schema) ? format.json_schema.schema : undefined;
    return compactObject({ type: "json_schema", ...(schema !== undefined ? { schema } : {}) });
  }
  if (asString(format.type) === "json_object") return { type: "json_object" };
  return undefined;
}

function compactCanonicalParameters(parameters: CanonicalRequestParameters): CanonicalRequestParameters {
  return Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined)) as CanonicalRequestParameters;
}

function pickMetadata(body: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key === "user")) as JsonObject;
}
function normalizeRole(value: string | undefined): CanonicalRole | undefined {
  if (value === "model") return "assistant";
  return value === "system" || value === "developer" || value === "user" || value === "assistant" || value === "tool" ? value : undefined;
}
function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function asNumber(value: JsonValue | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function compactObject(value: Record<string, unknown>): JsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject; }
