export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens_details: { reasoning_tokens: number };
}

export function normalizeChatUsage(value: unknown): ResponsesUsage {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as Record<string, unknown> : {};
  const completionDetails = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as Record<string, unknown> : {};
  const input = Number(usage.prompt_tokens ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? 0) || 0;
  return {
    input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens ?? input + output) || 0,
    input_tokens_details: { cached_tokens: Number(promptDetails.cached_tokens ?? 0) || 0 },
    output_tokens_details: { reasoning_tokens: Number(completionDetails.reasoning_tokens ?? 0) || 0 },
  };
}

export function responseEnvelope(id: string, model: string, status: string, output: unknown[], usage?: ResponsesUsage) {
  return { id, object: "response", created_at: Math.floor(Date.now() / 1000), status, model, output,
    error: null, incomplete_details: null, ...(usage ? { usage } : {}) };
}

export function responseEvent(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { type, ...payload };
}

export function serializeResponseEvent(event: Record<string, unknown>): Uint8Array {
  const type = String(event.type);
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
}
