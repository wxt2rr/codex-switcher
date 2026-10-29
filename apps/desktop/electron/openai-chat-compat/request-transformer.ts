import { buildToolRegistry, toChatToolName } from "./tool-registry.js";
import {
  CompatibilityError,
  type ChatMessage,
  type ChatToolCall,
  type ToolRegistry,
  type TransformResponsesRequestInput,
  type TransformedChatRequest,
} from "./types.js";
import { normalizeToolExchange } from "./tool-exchange-normalizer.js";
import { normalizeMoonshotChatTools, upstreamRequiresMoonshotSchema } from "./moonshot-schema.js";

const protectedOverrides = new Set(["model", "messages", "tools", "stream", "authorization", "base_url"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new CompatibilityError("INVALID_REQUEST", `${label} must be a string`);
  return value;
}

function chatContent(content: unknown): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new CompatibilityError("INVALID_REQUEST", "Message content must be a string or array");
  return content.map((raw) => {
    const part = record(raw);
    if (!part || typeof part.type !== "string") throw new CompatibilityError("UNSUPPORTED_ITEM", "Invalid message content item");
    if (part.type === "input_text" || part.type === "output_text" || part.type === "text") {
      return { type: "text", text: text(part.text, "Message text") };
    }
    if (part.type === "input_image" || part.type === "image_url") {
      const url = typeof part.image_url === "string"
        ? part.image_url
        : record(part.image_url) && typeof record(part.image_url)?.url === "string"
          ? String(record(part.image_url)?.url)
          : "";
      if (!url) throw new CompatibilityError("INVALID_REQUEST", "Image content requires image_url");
      return { type: "image_url", image_url: { url, ...(typeof part.detail === "string" ? { detail: part.detail } : {}) } };
    }
    throw new CompatibilityError("UNSUPPORTED_ITEM", `Unsupported message content type '${part.type}'`);
  });
}

function chatToolOutputContent(value: unknown): string | Array<Record<string, unknown>> {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return JSON.stringify(value ?? "");
  return value.map((raw) => {
    const part = record(raw);
    if (!part) return { type: "text", text: String(raw) };
    if (part.type === "output_text" || part.type === "input_text" || part.type === "text") return { type: "text", text: typeof part.text === "string" ? part.text : JSON.stringify(part.text ?? "") };
    if (part.type === "output_image" || part.type === "input_image" || part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : record(part.image_url)?.url;
      return { type: "image_url", image_url: { url: typeof url === "string" ? url : "" } };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

function reasoningSummaryText(item: Record<string, unknown>): string | undefined {
  if (!Array.isArray(item.summary)) return undefined;
  const value = item.summary
    .map((part) => record(part))
    .filter((part): part is Record<string, unknown> => part !== null)
    .map((part) => typeof part.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n\n");
  return value || undefined;
}

function toolEntry(registry: ToolRegistry, name: string) {
  const direct = registry.byOriginalName.get(name);
  if (direct) return direct;
  const chatEntry = registry.byChatName.get(name);
  if (chatEntry) return chatEntry;
  const namespaceName = name.replace("__", ".");
  return registry.byOriginalName.get(namespaceName);
}

function transformToolChoice(value: unknown, registry: ToolRegistry): unknown {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "none" || value === "required") return value;
  const choice = record(value);
  if (!choice) throw new CompatibilityError("INVALID_REQUEST", "Invalid tool_choice");
  const name = typeof choice.name === "string"
    ? choice.name
    : record(choice.function) && typeof record(choice.function)?.name === "string"
      ? String(record(choice.function)?.name)
      : "";
  const entry = toolEntry(registry, name);
  if (!entry) throw new CompatibilityError("INVALID_TOOL", `Unknown tool choice '${name}'`);
  return { type: "function", function: { name: entry.chatName } };
}

function applyOverrides(body: Record<string, unknown>, overrides: Record<string, unknown> | undefined): void {
  if (!overrides) return;
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toLowerCase();
    if (protectedOverrides.has(normalized) || normalized.includes("url") || normalized.includes("endpoint")) {
      throw new CompatibilityError("INVALID_REQUEST", `Request override '${key}' is protected`);
    }
    body[key] = value;
  }
}

export function transformResponsesRequest(input: TransformResponsesRequestInput): TransformedChatRequest {
  const { request } = input;
  const requestedModel = text(request.model, "model");
  const registry = buildToolRegistry(request);
  const messages: ChatMessage[] = [];
  if (typeof request.instructions === "string" && request.instructions) {
    const instructionRole = input.instructionRole === "developer" ? "developer" : "system";
    messages.push({ role: instructionRole, content: request.instructions });
  }

  const rawInput = request.input;
  let warning: string | undefined;
  const originalItems = typeof rawInput === "string" ? [{ type: "message", role: "user", content: rawInput }]
    : Array.isArray(rawInput) ? rawInput : [];
  if (rawInput !== undefined && typeof rawInput !== "string" && !Array.isArray(rawInput)) {
    throw new CompatibilityError("INVALID_REQUEST", "input must be a string or array");
  }
  const hasOpaqueCompaction = originalItems.some((raw) => {
    const item = record(raw);
    return item?.type === "compaction" || item?.type === "compaction_summary";
  });
  if (hasOpaqueCompaction && input.longConversationStrategy !== "continuity") {
    throw new CompatibilityError(
      "INCOMPATIBLE_COMPACTION",
      "当前会话包含无法转换的压缩历史，请新建窗口继续。",
      409,
    );
  }
  const items = hasOpaqueCompaction
    ? originalItems.filter((raw) => {
        const item = record(raw);
        return item?.type !== "compaction" && item?.type !== "compaction_summary";
      })
    : originalItems;
  if (hasOpaqueCompaction) warning = "已使用可读取的历史继续，部分早期上下文可能丢失。";

  let pendingCalls: ChatToolCall[] = [];
  let pendingReasoning: string | undefined;
  const flushCalls = () => {
    if (!pendingCalls.length) return;
    messages.push({ role: "assistant", content: null, tool_calls: pendingCalls,
      ...(pendingReasoning ? { reasoning_content: pendingReasoning } : {}) });
    pendingCalls = [];
    pendingReasoning = undefined;
  };

  items.forEach((raw, index) => {
    const item = record(raw);
    if (!item || typeof item.type !== "string") throw new CompatibilityError("UNSUPPORTED_ITEM", `Invalid input item at index ${index}`);
    if (item.type === "reasoning") {
      const summary = reasoningSummaryText(item);
      if (summary) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n\n${summary}` : summary;
      return;
    }
    if (item.type === "message") {
      flushCalls();
      const role = item.role;
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "developer") {
        throw new CompatibilityError("UNSUPPORTED_ITEM", `Unsupported message role '${String(role)}'`);
      }
      const normalizedRole = role === "developer" && input.instructionRole !== "developer" ? "system" : role;
      const message: ChatMessage = { role: normalizedRole, content: chatContent(item.content) };
      if (role === "assistant" && pendingReasoning) message.reasoning_content = pendingReasoning;
      if (role !== "assistant" || pendingReasoning) pendingReasoning = undefined;
      messages.push(message);
      return;
    }
    if (item.type === "function_call" || item.type === "custom_tool_call" || item.type === "tool_search_call") {
      const name = text(item.name, "Tool call name");
      if (!name.trim()) throw new CompatibilityError("INVALID_TOOL", "Historical tool call requires a name");
      const entry = toolEntry(registry, name);
      const callId = typeof item.call_id === "string" ? item.call_id : text(item.id, "Tool call ID");
      let argumentsText: string;
      if (item.type === "function_call") argumentsText = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
      else argumentsText = JSON.stringify({ input: text(item.input ?? item.arguments, "Custom tool input") });
      // Codex can replay a completed call after its dynamic tool is no longer advertised.
      // Keep the historical assistant/tool pair without exposing that tool to the model again.
      const historicalName = toChatToolName(name);
      const fallbackName = registry.byChatName.has(historicalName)
        ? toChatToolName(`historical_${callId}`)
        : historicalName;
      pendingCalls.push({ id: callId, type: "function", function: {
        name: entry?.chatName ?? fallbackName,
        arguments: argumentsText,
      } });
      return;
    }
    if (item.type === "function_call_output" || item.type === "custom_tool_call_output" || item.type === "tool_search_call_output") {
      flushCalls();
      messages.push({ role: "tool", tool_call_id: text(item.call_id, "Tool output call_id"), content: chatToolOutputContent(item.output) });
      return;
    }
    throw new CompatibilityError("UNSUPPORTED_ITEM", `Unsupported input item type '${item.type}'`);
  });
  flushCalls();

  const normalized = normalizeToolExchange(messages, { includeToolName: true });
  messages.splice(0, messages.length, ...normalized.messages);
  if (normalized.diagnostics.orphanToolResults || normalized.diagnostics.syntheticToolResults || normalized.diagnostics.invalidToolCalls) {
    const repairWarning = `工具历史已自动修复（孤立结果 ${normalized.diagnostics.orphanToolResults}、补全结果 ${normalized.diagnostics.syntheticToolResults}、非法调用 ${normalized.diagnostics.invalidToolCalls}）。`;
    warning = warning ? `${warning} ${repairWarning}` : repairWarning;
  }

  const stream = request.stream === true;
  const body: Record<string, unknown> = {
    model: input.upstreamModel || requestedModel,
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(registry.chatTools.length ? { tools: registry.chatTools } : {}),
  };
  const toolChoice = transformToolChoice(request.tool_choice, registry);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  if (typeof request.parallel_tool_calls === "boolean") body.parallel_tool_calls = request.parallel_tool_calls;
  if (typeof request.max_output_tokens === "number") {
    const legacyMaxTokens = /(?:moonshot\.cn|moonshot\.ai|kimi\.com|dashscope\.aliyuncs\.com)/i.test(input.upstreamEndpoint ?? "");
    body[legacyMaxTokens ? "max_tokens" : "max_completion_tokens"] = request.max_output_tokens;
  }
  if (typeof request.temperature === "number") body.temperature = request.temperature;
  const reasoning = record(request.reasoning);
  if (reasoning && typeof reasoning.effort === "string") body.reasoning_effort = reasoning.effort;
  if (input.reasoningProfile === "reasoning_content") body.reasoning_format = "reasoning_content";
  if (input.reasoningProfile === "think_tags") body.reasoning_format = "think_tags";
  applyOverrides(body, input.requestOverrides);
  if (upstreamRequiresMoonshotSchema(input.upstreamEndpoint)) {
    const rewritten = normalizeMoonshotChatTools(body);
    if (rewritten > 0) {
      const schemaWarning = `已为 Kimi/Moonshot 重写 ${rewritten} 个不兼容的 JSON Schema 引用。`;
      warning = warning ? `${warning} ${schemaWarning}` : schemaWarning;
    }
  }
  return { body, tools: registry, requestedModel, warning, diagnostics: normalized.diagnostics };
}
