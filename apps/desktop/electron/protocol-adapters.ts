import type { RouteProtocol } from "./usage-routing-model.js";

export interface ProtocolCredential {
  upstreamApiKey?: string;
  authMode?: "auth" | "apikey";
  accountId?: string;
}

export function detectGatewayProtocol(routeSuffix: string): RouteProtocol {
  const normalized = routeSuffix.replace(/^\/+/, "").toLowerCase();
  if (normalized === "messages" || normalized.endsWith("/messages")) return "anthropic";
  if (normalized.includes("generatecontent") || normalized.includes("v1beta/models/")) return "gemini";
  if (normalized.includes("chat/completions")) return "chat_completions";
  return "responses";
}

export function extractProtocolModel(
  protocol: RouteProtocol,
  routeSuffix: string,
  body?: Record<string, unknown>,
): string | undefined {
  if (typeof body?.model === "string" && body.model.trim()) return body.model.trim();
  if (protocol === "gemini") {
    const match = routeSuffix.match(/models\/([^/:?]+)/i);
    return match?.[1];
  }
  return undefined;
}

export function applyProtocolCredentialHeaders(
  headers: Headers,
  protocol: RouteProtocol,
  credential: ProtocolCredential | undefined,
): Headers {
  if (!credential?.upstreamApiKey) return headers;
  headers.delete("authorization");
  headers.delete("chatgpt-account-id");
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  if (protocol === "anthropic") {
    headers.set("x-api-key", credential.upstreamApiKey);
    headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01");
  } else if (protocol === "gemini") {
    headers.set("x-goog-api-key", credential.upstreamApiKey);
  } else {
    headers.set("authorization", `Bearer ${credential.upstreamApiKey}`);
    if (credential.authMode === "auth" && credential.accountId) {
      headers.set("chatgpt-account-id", credential.accountId);
    }
  }
  return headers;
}

export function adaptResponsesRequest(
  targetProtocol: "anthropic" | "gemini",
  body: Record<string, unknown>,
  upstreamModel: string | undefined,
): Record<string, unknown> {
  const model = upstreamModel?.trim() || (typeof body.model === "string" ? body.model : undefined);
  const input = body.input;
  if (targetProtocol === "anthropic") {
    return {
      model,
      ...(body.instructions ? { system: body.instructions } : {}),
      messages: normalizeMessages(input),
      ...(body.max_output_tokens !== undefined ? { max_tokens: body.max_output_tokens } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.stream !== undefined ? { stream: body.stream } : {}),
      ...(body.tools !== undefined ? { tools: body.tools } : {}),
    };
  }
  return {
    contents: normalizeGeminiContents(input),
    ...(model ? { model } : {}),
    ...(body.system_instruction ? { systemInstruction: body.system_instruction } : body.instructions ? { systemInstruction: { parts: [{ text: String(body.instructions) }] } } : {}),
    generationConfig: {
      ...(body.max_output_tokens !== undefined ? { maxOutputTokens: body.max_output_tokens } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    },
    ...(body.tools !== undefined ? { tools: body.tools } : {}),
  };
}

/** Convert any supported ingress protocol through the canonical Responses
 * shape before projecting it to an upstream protocol. This keeps gateway
 * routes model/protocol-oriented instead of account-oriented. */
export function adaptProtocolRequest(
  sourceProtocol: RouteProtocol,
  targetProtocol: RouteProtocol,
  body: Record<string, unknown>,
  upstreamModel?: string,
): Record<string, unknown> {
  if (sourceProtocol === targetProtocol) return upstreamModel ? { ...body, model: upstreamModel } : body;
  const normalized = sourceToResponses(sourceProtocol, body, upstreamModel);
  if (targetProtocol === "responses") return normalized;
  if (targetProtocol === "anthropic" || targetProtocol === "gemini") return adaptResponsesRequest(targetProtocol, normalized, upstreamModel);
  return {
    model: upstreamModel ?? normalized.model,
    messages: normalizeMessages(normalized.input),
    ...(normalized.stream !== undefined ? { stream: normalized.stream } : {}),
    ...(normalized.tools !== undefined ? { tools: normalized.tools } : {}),
    ...(normalized.reasoning !== undefined ? { reasoning: normalized.reasoning } : {}),
  };
}

export function adaptProtocolResponse(
  sourceProtocol: RouteProtocol,
  targetProtocol: RouteProtocol,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (sourceProtocol === targetProtocol) return body;
  const normalized = responseToCanonical(sourceProtocol, body);
  const usage = normalized.usage && typeof normalized.usage === "object"
    ? normalized.usage as { input_tokens: number; output_tokens: number }
    : undefined;
  if (targetProtocol === "responses") return {
    id: normalized.id,
    object: "response",
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: normalized.text ?? "" }] }],
    ...(normalized.reasoning ? { reasoning: normalized.reasoning } : {}),
    ...(usage ? { usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens } } : {}),
  };
  if (targetProtocol === "chat_completions") return {
    id: normalized.id,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: normalized.text || null, ...(normalized.reasoning ? { reasoning_content: normalized.reasoning } : {}) }, finish_reason: "stop" }],
    ...(usage ? { usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens } } : {}),
  };
  if (targetProtocol === "anthropic") return {
    id: normalized.id,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: normalized.text }, ...(normalized.reasoning ? [{ type: "thinking", thinking: normalized.reasoning }] : [])],
    stop_reason: "end_turn",
    ...(usage ? { usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } } : {}),
  };
  return {
    candidates: [{ content: { role: "model", parts: [{ text: normalized.text }] }, finishReason: "STOP" }],
    ...(usage ? { usageMetadata: { promptTokenCount: usage.input_tokens, candidatesTokenCount: usage.output_tokens, totalTokenCount: usage.input_tokens + usage.output_tokens } } : {}),
  };
}

export function adaptProtocolSseChunk(
  sourceProtocol: RouteProtocol,
  targetProtocol: RouteProtocol,
  chunk: string,
): string {
  if (sourceProtocol === targetProtocol) return chunk;
  return chunk.split(/\r?\n/).map((line) => {
    if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") return line;
    try {
      const body = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      return `data: ${JSON.stringify(adaptProtocolResponse(sourceProtocol, targetProtocol, body))}`;
    } catch { return line; }
  }).join("\n");
}

function sourceToResponses(protocol: RouteProtocol, body: Record<string, unknown>, upstreamModel?: string): Record<string, unknown> {
  if (protocol === "responses") return { ...body, ...(upstreamModel ? { model: upstreamModel } : {}) };
  if (protocol === "chat_completions") return {
    model: upstreamModel ?? body.model,
    input: body.messages,
    ...(body.stream !== undefined ? { stream: body.stream } : {}),
    ...(body.tools !== undefined ? { tools: body.tools } : {}),
    ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
  };
  if (protocol === "anthropic") {
    return {
      model: upstreamModel ?? body.model,
      input: body.messages,
      ...(typeof body.system === "string" ? { instructions: body.system } : {}),
      ...(body.stream !== undefined ? { stream: body.stream } : {}),
      ...(body.tools !== undefined ? { tools: body.tools } : {}),
      ...(body.thinking !== undefined ? { reasoning: body.thinking } : {}),
    };
  }
  return { model: upstreamModel ?? body.model, input: body.contents, ...(body.tools !== undefined ? { tools: body.tools } : {}) };
}

function responseToCanonical(protocol: RouteProtocol, body: Record<string, unknown>): Record<string, unknown> {
  if (protocol === "responses") {
    const output = Array.isArray(body.output) ? body.output : [];
    const text = output.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : []).map((item) => item && typeof item === "object" && !Array.isArray(item) ? String((item as Record<string, unknown>).text ?? "") : "").join("");
    return { id: typeof body.id === "string" ? body.id : "response", text, ...(body.usage && typeof body.usage === "object" ? { usage: body.usage } : {}) };
  }
  if (protocol === "chat_completions") {
    const choice = Array.isArray(body.choices) && body.choices[0] && typeof body.choices[0] === "object" ? body.choices[0] as Record<string, unknown> : {};
    const message = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : choice.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
    return { id: typeof body.id === "string" ? body.id : "chat", text: typeof message.content === "string" ? message.content : "", ...(typeof message.reasoning_content === "string" ? { reasoning: message.reasoning_content } : {}), ...(body.usage && typeof body.usage === "object" ? { usage: { input_tokens: Number((body.usage as Record<string, unknown>).prompt_tokens ?? 0), output_tokens: Number((body.usage as Record<string, unknown>).completion_tokens ?? 0) } } : {}) };
  }
  if (protocol === "anthropic") {
    const text = Array.isArray(body.content) ? body.content.filter((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).type === "text").map((item) => String((item as Record<string, unknown>).text ?? "")).join("") : "";
    return { id: typeof body.id === "string" ? body.id : "anthropic", text, ...(body.usage && typeof body.usage === "object" ? { usage: { input_tokens: Number((body.usage as Record<string, unknown>).input_tokens ?? 0), output_tokens: Number((body.usage as Record<string, unknown>).output_tokens ?? 0) } } : {}) };
  }
  const candidate = Array.isArray(body.candidates) && body.candidates[0] && typeof body.candidates[0] === "object" ? body.candidates[0] as Record<string, unknown> : {};
  const content = candidate.content && typeof candidate.content === "object" ? candidate.content as Record<string, unknown> : {};
  const text = Array.isArray(content.parts) ? content.parts.map((part) => part && typeof part === "object" ? String((part as Record<string, unknown>).text ?? "") : "").join("") : "";
  return { id: "gemini", text, ...(body.usageMetadata && typeof body.usageMetadata === "object" ? { usage: { input_tokens: Number((body.usageMetadata as Record<string, unknown>).promptTokenCount ?? 0), output_tokens: Number((body.usageMetadata as Record<string, unknown>).candidatesTokenCount ?? 0) } } : {}) };
}

function normalizeMessages(input: unknown): Array<{ role: string; content: unknown }> {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [{ role: "user", content: String(input ?? "") }];
  return input.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      return { role: typeof record.role === "string" ? record.role : "user", content: record.content ?? record.text ?? record.parts ?? "" };
    }
    return { role: "user", content: String(item) };
  });
}

function normalizeGeminiContents(input: unknown): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  return normalizeMessages(input).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: typeof message.content === "string" ? [{ text: message.content }] : [{ text: JSON.stringify(message.content) }],
  }));
}
