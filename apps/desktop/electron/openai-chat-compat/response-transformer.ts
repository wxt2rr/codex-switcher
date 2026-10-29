import { randomUUID } from "node:crypto";

import { normalizeChatUsage } from "./responses-events.js";
import { CompatibilityError, type ChatToolCall, type ToolRegistry } from "./types.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeToolArguments(value: unknown, wrapCustomInput = false): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return trimmed;
      return wrapCustomInput && typeof parsed === "string" ? JSON.stringify({ input: parsed }) : undefined;
    } catch {
      // Custom and Hosted Tool adapters are allowed to return their input as
      // plain text instead of JSON. Do not wrap a truncated JSON-looking
      // value: that would turn a broken call into a different, executable
      // request and hide the upstream protocol error.
      return wrapCustomInput && !/^[\[{]/.test(trimmed) ? JSON.stringify({ input: value }) : undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : undefined;
}

export function transformChatResponse(payload: unknown, options: {
  model: string; registry: ToolRegistry; responseId?: string; warning?: string;
}) {
  const root = record(payload);
  if (!root) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Chat response must be an object", 502);
  if (root.error) throw new CompatibilityError("UPSTREAM_PROTOCOL", JSON.stringify(root.error), 502);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  if (!choices.length) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Chat response contains no choices", 502);
  const choice = record(choices[0]);
  const message = record(choice?.message);
  if (!choice || !message) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Chat response choice has no message", 502);
  const output: Record<string, unknown>[] = [];
  if (options.warning) {
    output.push({ id: `msg_${randomUUID().replace(/-/g, "")}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: options.warning, annotations: [] }] });
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    output.push({ id: `rs_${randomUUID().replace(/-/g, "")}`, type: "reasoning",
      summary: [{ type: "summary_text", text: message.reasoning_content }] });
  }
  if (typeof message.content === "string" && message.content) {
    output.push({ id: `msg_${randomUUID().replace(/-/g, "")}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }] });
  }
  const rawToolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : record(message.function_call) ? [{ id: `call_${randomUUID().replace(/-/g, "")}`, type: "function", function: message.function_call }] : [];
  const calls: ChatToolCall[] = [];
  let invalidToolCalls = 0;
  if (Array.isArray(rawToolCalls)) for (const raw of rawToolCalls) {
    const call = record(raw); const nested = record(call?.function);
    // OpenAI uses `tool_call.function`, but several OpenAI-compatible
    // providers serialize the same fields directly on the tool call object.
    // Normalize both shapes before validating the call.
    const fn = nested ?? call;
    if (!call || !fn || typeof fn.name !== "string") throw new CompatibilityError("UPSTREAM_PROTOCOL", "Invalid Chat tool call", 502);
    const id = typeof call.id === "string" ? call.id : `call_${randomUUID().replace(/-/g, "")}`;
    const entry = options.registry.byChatName.get(fn.name);
    const name = entry?.originalName ?? fn.name;
    const args = normalizeToolArguments(fn.arguments, entry?.originalType === "custom" || entry?.originalType === "tool_search");
    // Some OpenAI-compatible providers return a tool name with an empty or
    // malformed arguments field.  Do not turn that upstream protocol defect
    // into a Responses function_call that Codex cannot parse.
    if (!args) { invalidToolCalls += 1; continue; }
    output.push({ id: `fc_${randomUUID().replace(/-/g, "")}`, type: "function_call", status: "completed",
      call_id: id, name, arguments: args });
    calls.push({ id, type: "function", function: { name, arguments: args } });
  }
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "stop";
  if (invalidToolCalls > 0 && calls.length === 0) {
    throw new CompatibilityError(
      "UPSTREAM_PROTOCOL",
      `Upstream finished with '${finishReason}' but returned no valid tool call arguments (${invalidToolCalls} invalid call${invalidToolCalls === 1 ? "" : "s"})`,
      502,
    );
  }
  const incomplete = finishReason === "length" || finishReason === "content_filter";
  const responseId = options.responseId ?? `resp_${randomUUID().replace(/-/g, "")}`;
  return {
    response: {
      id: responseId, object: "response", created_at: Math.floor(Date.now() / 1000), model: options.model,
      status: incomplete ? "incomplete" : "completed", output,
      error: null,
      incomplete_details: incomplete ? { reason: finishReason === "length" ? "max_output_tokens" : "content_filter" } : null,
      usage: normalizeChatUsage(root.usage),
    },
    calls,
  };
}
