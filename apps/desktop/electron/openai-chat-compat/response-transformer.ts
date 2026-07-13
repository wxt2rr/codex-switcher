import { randomUUID } from "node:crypto";

import { normalizeChatUsage } from "./responses-events.js";
import { CompatibilityError, type ChatToolCall, type ToolRegistry } from "./types.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
  const calls: ChatToolCall[] = [];
  if (Array.isArray(message.tool_calls)) for (const raw of message.tool_calls) {
    const call = record(raw); const fn = record(call?.function);
    if (!call || !fn || typeof fn.name !== "string") throw new CompatibilityError("UPSTREAM_PROTOCOL", "Invalid Chat tool call", 502);
    const id = typeof call.id === "string" ? call.id : `call_${randomUUID().replace(/-/g, "")}`;
    const name = options.registry.byChatName.get(fn.name)?.originalName ?? fn.name;
    const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    output.push({ id: `fc_${randomUUID().replace(/-/g, "")}`, type: "function_call", status: "completed",
      call_id: id, name, arguments: args });
    calls.push({ id, type: "function", function: { name, arguments: args } });
  }
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "stop";
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
