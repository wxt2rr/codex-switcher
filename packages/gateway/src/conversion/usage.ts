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
  // Anthropic sends input usage in `message_start.message.usage` and output
  // usage in `message_delta.usage`; both are valid stream frames.  Accept
  // the nested start-frame shape so merging the stream does not lose input
  // tokens or cache counters.
  const nestedMessage = protocol === "anthropic" && isObject(body.message) ? body.message : undefined;
  const nestedRaw = nestedMessage && isObject(nestedMessage.usage) ? nestedMessage.usage : undefined;
  const effectiveRaw = isObject(raw) ? raw : nestedRaw;
  if (!effectiveRaw) return undefined;
  if (protocol === "responses") {
    return withRaw({
      inputTokens: number(effectiveRaw.input_tokens),
      outputTokens: number(effectiveRaw.output_tokens),
      reasoningTokens: number(effectiveRaw.reasoning_tokens) || nestedNumber(effectiveRaw.output_tokens_details, "reasoning_tokens"),
      cacheReadTokens: number(effectiveRaw.cached_tokens) + nestedNumber(effectiveRaw.input_tokens_details, "cached_tokens") + nestedNumber(effectiveRaw.input_token_details, "cached_tokens"),
      cacheWriteTokens: number(effectiveRaw.cache_creation_input_tokens) || nestedNumber(effectiveRaw.input_tokens_details, "cache_creation_input_tokens"),
    }, effectiveRaw);
  }
  if (protocol === "chat_completions") {
    return withRaw({ inputTokens: number(effectiveRaw.prompt_tokens), outputTokens: number(effectiveRaw.completion_tokens), reasoningTokens: nestedNumber(effectiveRaw.completion_tokens_details, "reasoning_tokens"), cacheReadTokens: nestedNumber(effectiveRaw.prompt_tokens_details, "cached_tokens"), cacheWriteTokens: 0 }, effectiveRaw);
  }
  if (protocol === "anthropic") {
    const cacheCreation = isObject(effectiveRaw.cache_creation) ? effectiveRaw.cache_creation : undefined;
    return withRaw({ inputTokens: number(effectiveRaw.input_tokens), outputTokens: number(effectiveRaw.output_tokens), reasoningTokens: number(effectiveRaw.reasoning_tokens), cacheReadTokens: number(effectiveRaw.cache_read_input_tokens), cacheWriteTokens: number(effectiveRaw.cache_creation_input_tokens) || number(cacheCreation?.ephemeral_5m_input_tokens) || number(cacheCreation?.ephemeral_1h_input_tokens) }, effectiveRaw);
  }
  return withRaw({ inputTokens: number(effectiveRaw.promptTokenCount), outputTokens: number(effectiveRaw.candidatesTokenCount), reasoningTokens: number(effectiveRaw.thoughtsTokenCount), cacheReadTokens: number(effectiveRaw.cachedContentTokenCount), cacheWriteTokens: 0 }, effectiveRaw);
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
  if (protocol === "responses") return { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens, output_tokens_details: { reasoning_tokens: usage.reasoningTokens }, input_tokens_details: { cached_tokens: usage.cacheReadTokens }, reasoning_tokens: usage.reasoningTokens, cached_tokens: usage.cacheReadTokens, cache_creation_input_tokens: usage.cacheWriteTokens };
  if (protocol === "chat_completions") return { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens, completion_tokens_details: { reasoning_tokens: usage.reasoningTokens }, prompt_tokens_details: { cached_tokens: usage.cacheReadTokens } };
  if (protocol === "anthropic") return { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.cacheReadTokens, cache_creation_input_tokens: usage.cacheWriteTokens, ...(usage.cacheWriteTokens > 0 ? { cache_creation: { ephemeral_5m_input_tokens: usage.cacheWriteTokens } } : {}) };
  return { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens, totalTokenCount: usage.inputTokens + usage.outputTokens, thoughtsTokenCount: usage.reasoningTokens, cachedContentTokenCount: usage.cacheReadTokens };
}

function withRaw(usage: Omit<ConversionUsage, "raw">, raw: JsonObject): ConversionUsage { return { ...usage, raw }; }
function nestedNumber(value: JsonValue | undefined, key: string): number { return isObject(value) ? number(value[key]) : 0; }
function number(value: JsonValue | undefined): number { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
