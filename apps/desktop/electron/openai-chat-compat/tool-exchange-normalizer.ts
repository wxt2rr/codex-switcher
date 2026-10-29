import type { ChatMessage, ChatToolCall, ToolExchangeDiagnostics } from "./types.js";

export interface ToolExchangeNormalizerOptions {
  /** Include the original function name on Chat tool messages when known. */
  includeToolName?: boolean;
  /** Keep tool results as user context when no valid preceding call exists. */
  orphanPrefix?: string;
}

export interface ToolExchangeNormalizationResult {
  messages: ChatMessage[];
  diagnostics: ToolExchangeDiagnostics;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call) => ({ ...call, function: { ...call.function } })) } : {}),
    ...(Array.isArray(message.content) ? { content: message.content.map((part) => ({ ...part })) } : {}),
  };
}

function hasVisibleContent(message: ChatMessage): boolean {
  if (typeof message.content === "string") return message.content.trim().length > 0;
  return Array.isArray(message.content) && message.content.length > 0;
}

function callList(message: ChatMessage): ChatToolCall[] {
  return Array.isArray(message.tool_calls) ? message.tool_calls : [];
}

function validArguments(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function toolResultAsUser(message: ChatMessage, prefix: string): ChatMessage {
  const content = message.content ?? "";
  if (Array.isArray(content)) {
    return { role: "user", content: [{ type: "text", text: prefix }, ...content] };
  }
  return { role: "user", content: `${prefix}\n${content || "(empty result)"}` };
}

function addAction(diagnostics: ToolExchangeDiagnostics, action: string): void {
  diagnostics.actions.push(action);
}

/**
 * Enforces the Chat Completions tool exchange invariant:
 * assistant(tool_calls) -> one tool message per call, in call order.
 *
 * This intentionally repairs malformed history instead of rejecting the whole
 * request. Tool results that cannot be safely paired are preserved as user
 * context so strict providers such as Kimi do not reject the request.
 */
export function normalizeToolExchange(
  input: readonly ChatMessage[],
  options: ToolExchangeNormalizerOptions = {},
): ToolExchangeNormalizationResult {
  const diagnostics: ToolExchangeDiagnostics = {
    orphanToolResults: 0,
    duplicateToolResults: 0,
    syntheticToolResults: 0,
    mergedAssistantMessages: 0,
    invalidToolCalls: 0,
    actions: [],
  };
  const orphanPrefix = options.orphanPrefix ?? "Tool result received without a resolvable preceding call:";
  const messages = input.map(cloneMessage);
  const output: ChatMessage[] = [];

  for (let index = 0; index < messages.length;) {
    const current = messages[index];

    if (current.role === "assistant") {
      let assistant = current;
      let calls = callList(assistant).filter((call) => {
        if (validArguments(call.function.arguments)) return true;
        diagnostics.invalidToolCalls += 1;
        addAction(diagnostics, `dropped invalid arguments for tool call ${call.id}`);
        return false;
      });
      if (calls.length !== callList(assistant).length) {
        assistant = { ...assistant, tool_calls: calls.length ? calls : undefined };
        if (!hasVisibleContent(assistant) && !calls.length) assistant.content = "[Invalid historical tool call omitted.]";
      }

      // Responses may represent one assistant turn as commentary followed by
      // one or more tool-call items. Merge adjacent assistant tool messages so
      // the Chat provider sees one coherent turn.
      while (index + 1 < messages.length && messages[index + 1]?.role === "assistant") {
        const next = messages[index + 1]!;
        const nextCalls = callList(next);
        if (!nextCalls.length) break;
        const validNextCalls = nextCalls.filter((call) => {
          if (validArguments(call.function.arguments)) return true;
          diagnostics.invalidToolCalls += 1;
          addAction(diagnostics, `dropped invalid arguments for tool call ${call.id}`);
          return false;
        });
        if (validNextCalls.length) {
          calls = [...calls, ...validNextCalls];
          assistant = {
            ...assistant,
            content: assistant.content ?? next.content ?? null,
            tool_calls: calls,
          };
          diagnostics.mergedAssistantMessages += 1;
          addAction(diagnostics, "merged adjacent assistant tool-call messages");
        }
        index += 1;
      }

      if (!calls.length) {
        output.push(assistant);
        index += 1;
        continue;
      }

      output.push({ ...assistant, tool_calls: calls });
      const order = new Map(calls.map((call, position) => [call.id, { call, position }]));
      const answered = new Set<string>();
      const validResults: Array<{ message: ChatMessage; position: number }> = [];
      const orphanResults: ChatMessage[] = [];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]?.role === "tool") {
        const result = messages[cursor]!;
        const id = result.tool_call_id?.trim() ?? "";
        const entry = id ? order.get(id) : undefined;
        if (!entry) {
          diagnostics.orphanToolResults += 1;
          orphanResults.push(result);
          addAction(diagnostics, id ? `orphan tool result ${id} downgraded to user` : "tool result without call id downgraded to user");
        } else if (answered.has(id)) {
          diagnostics.duplicateToolResults += 1;
          addAction(diagnostics, `duplicate tool result ${id} dropped`);
        } else {
          answered.add(id);
          validResults.push({
            message: options.includeToolName && !result.name
              ? { ...result, name: entry.call.function.name }
              : result,
            position: entry.position,
          });
        }
        cursor += 1;
      }

      const validById = new Map(validResults.map(({ message }) => [message.tool_call_id ?? "", message]));
      for (const call of calls) {
        const valid = validById.get(call.id);
        if (valid) {
          output.push(valid);
        } else {
          diagnostics.syntheticToolResults += 1;
          output.push({
            role: "tool",
            tool_call_id: call.id,
            ...(options.includeToolName ? { name: call.function.name } : {}),
            content: "[The result of this tool call is unavailable: the turn was interrupted.]",
          });
          addAction(diagnostics, `synthetic tool result added for ${call.id}`);
        }
      }
      output.push(...orphanResults.map((result) => toolResultAsUser(result, orphanPrefix)));
      index = cursor;
      continue;
    }

    if (current.role === "tool") {
      diagnostics.orphanToolResults += 1;
      output.push(toolResultAsUser(current, orphanPrefix));
      addAction(diagnostics, current.tool_call_id ? `orphan tool result ${current.tool_call_id} downgraded to user` : "tool result without call id downgraded to user");
      index += 1;
      continue;
    }

    output.push(current);
    index += 1;
  }

  return { messages: output, diagnostics };
}
