import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";

export interface ConversionUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  raw?: JsonObject;
}

export function emptyUsage(): ConversionUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function decodeUsage(protocol: GatewayProtocol, body: JsonObject): ConversionUsage | undefined {
  const envelope = protocol === "responses" && isObject(body.response) ? body.response : body;
  const raw = protocol === "gemini" ? envelope.usageMetadata : envelope.usage;
  if (!isObject(raw)) return undefined;
  if (protocol === "responses") {
    return withRaw({ inputTokens: number(raw.input_tokens), outputTokens: number(raw.output_tokens), reasoningTokens: number(raw.reasoning_tokens), cacheReadTokens: number(raw.cached_tokens) + nestedNumber(raw.input_token_details, "cached_tokens"), cacheWriteTokens: number(raw.cache_creation_input_tokens) }, raw);
  }
  if (protocol === "chat_completions") {
    return withRaw({ inputTokens: number(raw.prompt_tokens), outputTokens: number(raw.completion_tokens), reasoningTokens: nestedNumber(raw.completion_tokens_details, "reasoning_tokens"), cacheReadTokens: nestedNumber(raw.prompt_tokens_details, "cached_tokens"), cacheWriteTokens: 0 }, raw);
  }
  if (protocol === "anthropic") {
    return withRaw({ inputTokens: number(raw.input_tokens), outputTokens: number(raw.output_tokens), reasoningTokens: number(raw.reasoning_tokens), cacheReadTokens: number(raw.cache_read_input_tokens), cacheWriteTokens: number(raw.cache_creation_input_tokens) }, raw);
  }
  return withRaw({ inputTokens: number(raw.promptTokenCount), outputTokens: number(raw.candidatesTokenCount), reasoningTokens: number(raw.thoughtsTokenCount), cacheReadTokens: number(raw.cachedContentTokenCount), cacheWriteTokens: 0 }, raw);
}

export function mergeUsage(current: ConversionUsage, next: ConversionUsage | undefined): ConversionUsage {
  if (!next) return { ...current };
  return {
    inputTokens: Math.max(current.inputTokens, next.inputTokens),
    outputTokens: Math.max(current.outputTokens, next.outputTokens),
    reasoningTokens: Math.max(current.reasoningTokens, next.reasoningTokens),
    cacheReadTokens: Math.max(current.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: Math.max(current.cacheWriteTokens, next.cacheWriteTokens),
    ...(next.raw ? { raw: next.raw } : current.raw ? { raw: current.raw } : {}),
  };
}

export function addUsage(current: ConversionUsage, next: ConversionUsage | undefined): ConversionUsage {
  if (!next) return { ...current };
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    reasoningTokens: current.reasoningTokens + next.reasoningTokens,
    cacheReadTokens: current.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + next.cacheWriteTokens,
    ...(next.raw ? { raw: next.raw } : current.raw ? { raw: current.raw } : {}),
  };
}

export function encodeUsage(protocol: GatewayProtocol, usage: ConversionUsage): JsonObject {
  if (protocol === "responses") return { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens, reasoning_tokens: usage.reasoningTokens, cached_tokens: usage.cacheReadTokens, cache_creation_input_tokens: usage.cacheWriteTokens };
  if (protocol === "chat_completions") return { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens, completion_tokens_details: { reasoning_tokens: usage.reasoningTokens }, prompt_tokens_details: { cached_tokens: usage.cacheReadTokens } };
  if (protocol === "anthropic") return { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheReadTokens, cache_creation_input_tokens: usage.cacheWriteTokens };
  return { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens, totalTokenCount: usage.inputTokens + usage.outputTokens, thoughtsTokenCount: usage.reasoningTokens, cachedContentTokenCount: usage.cacheReadTokens };
}

function withRaw(usage: Omit<ConversionUsage, "raw">, raw: JsonObject): ConversionUsage { return { ...usage, raw }; }
function nestedNumber(value: JsonValue | undefined, key: string): number { return isObject(value) ? number(value[key]) : 0; }
function number(value: JsonValue | undefined): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
