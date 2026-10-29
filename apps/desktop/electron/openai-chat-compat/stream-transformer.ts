import { randomUUID } from "node:crypto";

import { responseEnvelope, responseEvent, serializeResponseEvent, normalizeChatUsage, type ResponsesUsage } from "./responses-events.js";
import { SseParser } from "./sse-parser.js";
import { CompatibilityError, type ChatToolCall, type ToolRegistry } from "./types.js";

interface ToolState { index: number; id?: string; name?: string; arguments: string; announced: boolean; outputIndex?: number; itemId: string; }

export interface TransformChatStreamOptions {
  body: ReadableStream<Uint8Array>;
  model: string;
  registry: ToolRegistry;
  responseId?: string;
  signal?: AbortSignal;
  warning?: string;
  onCompleted?: (result: { responseId: string; calls: ChatToolCall[]; usage?: ResponsesUsage }) => void | Promise<void>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeToolArguments(value: string, wrapCustomInput = false): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return trimmed;
    return wrapCustomInput && typeof parsed === "string" ? JSON.stringify({ input: parsed }) : undefined;
  } catch {
    // A custom/Hosted Tool may use a plain string as its input. Only wrap
    // values that do not look like truncated JSON; otherwise report the
    // malformed upstream call instead of executing a different payload.
    return wrapCustomInput && !/^[\[{]/.test(trimmed) ? JSON.stringify({ input: value }) : undefined;
  }
}

function isToolCallFinishReason(value: string | undefined): boolean {
  return value !== undefined && ["tool_calls", "function_call", "tool_use", "tools"].includes(value);
}

export function transformChatStream(options: TransformChatStreamOptions): ReadableStream<Uint8Array> {
  const responseId = options.responseId ?? `resp_${randomUUID().replace(/-/g, "")}`;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const output: Array<{ index: number; item: Record<string, unknown> }> = [];
      const tools = new Map<number, ToolState>();
      let nextImplicitToolIndex = 0;
      let nextOutputIndex = 0;
      let textState: { itemId: string; index: number; text: string } | undefined;
      let reasoningState: { itemId: string; index: number; text: string } | undefined;
      let usage: ResponsesUsage | undefined;
      let completed = false;
      let sawDone = false;
      let historyRecorded = false;
      let finishReason: string | undefined;
      let sawToolCallIntent = false;
      const emit = (type: string, payload: Record<string, unknown>) => controller.enqueue(serializeResponseEvent(responseEvent(type, payload)));
      const response = (status: string) => responseEnvelope(responseId, options.model, status,
        output.sort((a, b) => a.index - b.index).map((entry) => entry.item), usage);
      const ensureText = () => {
        if (textState) return textState;
        textState = { itemId: `msg_${randomUUID().replace(/-/g, "")}`, index: nextOutputIndex++, text: "" };
        const item = { id: textState.itemId, type: "message", status: "in_progress", role: "assistant", content: [] as unknown[] };
        output.push({ index: textState.index, item });
        emit("response.output_item.added", { response_id: responseId, output_index: textState.index, item });
        emit("response.content_part.added", { response_id: responseId, item_id: textState.itemId,
          output_index: textState.index, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        return textState;
      };
      const ensureReasoning = () => {
        if (reasoningState) return reasoningState;
        reasoningState = { itemId: `rs_${randomUUID().replace(/-/g, "")}`, index: nextOutputIndex++, text: "" };
        const item = { id: reasoningState.itemId, type: "reasoning", summary: [] as unknown[] };
        output.push({ index: reasoningState.index, item });
        emit("response.output_item.added", { response_id: responseId, output_index: reasoningState.index, item });
        emit("response.reasoning_summary_part.added", { response_id: responseId, item_id: reasoningState.itemId,
          output_index: reasoningState.index, summary_index: 0, part: { type: "summary_text", text: "" } });
        return reasoningState;
      };
      const announceTool = (tool: ToolState, argumentsText: string) => {
        if (tool.announced || !tool.id || !tool.name) return;
        tool.announced = true;
        tool.outputIndex = nextOutputIndex++;
        const originalName = options.registry.byChatName.get(tool.name)?.originalName ?? tool.name;
        const item = { id: tool.itemId, type: "function_call", status: "in_progress", arguments: argumentsText, call_id: tool.id, name: originalName };
        output.push({ index: tool.outputIndex, item });
        emit("response.output_item.added", { response_id: responseId, output_index: tool.outputIndex, item });
      };
      const consumeChunk = (payload: Record<string, unknown>) => {
        if (completed) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Upstream emitted content after completion", 502);
        if (payload.usage) usage = normalizeChatUsage(payload.usage);
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        for (const rawChoice of choices) {
          const choice = record(rawChoice);
          if (!choice) continue;
          if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
          const delta = record(choice.delta);
          if (!delta) continue;
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            const state = ensureReasoning(); state.text += delta.reasoning_content;
            emit("response.reasoning_summary_text.delta", { response_id: responseId, item_id: state.itemId,
              output_index: state.index, summary_index: 0, delta: delta.reasoning_content });
          }
          if (typeof delta.content === "string" && delta.content) {
            const state = ensureText(); state.text += delta.content;
            emit("response.output_text.delta", { response_id: responseId, item_id: state.itemId,
              output_index: state.index, content_index: 0, delta: delta.content });
          }
          const streamedToolCalls = Array.isArray(delta.tool_calls)
            ? delta.tool_calls
            : record(delta.function_call) ? [{ index: 0, id: undefined, function: delta.function_call }] : [];
          if (streamedToolCalls.length > 0) sawToolCallIntent = true;
          if (Array.isArray(streamedToolCalls)) for (const rawTool of streamedToolCalls) {
            const toolDelta = record(rawTool); if (!toolDelta) continue;
            const explicitIndex = typeof toolDelta.index === "number" && Number.isFinite(toolDelta.index) ? toolDelta.index : undefined;
            const existingIndex = typeof toolDelta.id === "string"
              ? [...tools.entries()].find(([, candidate]) => candidate.id === toolDelta.id)?.[0]
              : undefined;
            const index = explicitIndex ?? existingIndex ?? nextImplicitToolIndex++;
            const state = tools.get(index) ?? { index, arguments: "", announced: false, itemId: `fc_${randomUUID().replace(/-/g, "")}` };
            if (typeof toolDelta.id === "string") state.id = toolDelta.id;
            // OpenAI nests name/arguments under `function`; a number of
            // compatible providers emit the same fields directly on the
            // tool-call delta. Accept both wire shapes.
            const fn = record(toolDelta.function) ?? toolDelta;
            if (fn && typeof fn.name === "string") state.name = (state.name ?? "") + fn.name;
            if (fn && typeof fn.arguments === "string") state.arguments += fn.arguments;
            else if (fn && fn.arguments && typeof fn.arguments === "object" && !Array.isArray(fn.arguments)) state.arguments += JSON.stringify(fn.arguments);
            tools.set(index, state);
          }
        }
      };
      const validCallCount = (): number => [...tools.values()].filter((state) => {
        const entry = state.name ? options.registry.byChatName.get(state.name) : undefined;
        return Boolean(state.name && normalizeToolArguments(state.arguments, entry?.originalType === "custom" || entry?.originalType === "tool_search"));
      }).length;
      const invalidToolCallMessage = (): string | undefined => {
        const hasToolIntent = sawToolCallIntent || tools.size > 0 || isToolCallFinishReason(finishReason);
        if (!hasToolIntent || validCallCount() > 0) return undefined;
        const attempted = [...tools.values()]
          .map((state) => `${state.name ?? "<unnamed>"}(arguments=${state.arguments.length ? `${state.arguments.length} chars` : "empty"})`)
          .join(", ");
        return `Upstream finished with '${finishReason ?? "unknown"}' but returned no valid tool call arguments; the provider likely emitted an empty or malformed tool call${attempted ? `: ${attempted}` : ""}`;
      };
      const collectCalls = (emitFinalEvents: boolean): ChatToolCall[] => {
        const calls: ChatToolCall[] = [];
        for (const state of [...tools.values()].sort((a, b) => a.index - b.index)) {
          const entry = state.name ? options.registry.byChatName.get(state.name) : undefined;
          const argumentsText = normalizeToolArguments(state.arguments, entry?.originalType === "custom" || entry?.originalType === "tool_search");
          if (!argumentsText || !state.name) continue;
          state.id ??= `call_${randomUUID().replace(/-/g, "")}`;
          announceTool(state, argumentsText);
          const originalName = options.registry.byChatName.get(state.name)?.originalName ?? state.name;
          const item = { id: state.itemId, type: "function_call", status: emitFinalEvents ? "completed" : "incomplete", arguments: argumentsText,
            call_id: state.id, name: originalName };
          const outputEntry = output.find((value) => value.index === state.outputIndex); if (outputEntry) outputEntry.item = item;
          if (emitFinalEvents) {
            emit("response.function_call_arguments.done", { response_id: responseId, item_id: state.itemId,
              output_index: state.outputIndex, arguments: argumentsText });
            emit("response.output_item.done", { response_id: responseId, output_index: state.outputIndex, item });
          }
          calls.push({ id: state.id, type: "function", function: { name: originalName, arguments: argumentsText } });
        }
        return calls;
      };
      const finish = async () => {
        if (completed) return;
        const invalidToolCall = invalidToolCallMessage();
        if (invalidToolCall) throw new CompatibilityError("UPSTREAM_PROTOCOL", invalidToolCall, 502);
        completed = true;
        if (reasoningState) {
          const entry = output.find((item) => item.index === reasoningState?.index);
          if (entry) entry.item = { id: reasoningState.itemId, type: "reasoning", summary: [{ type: "summary_text", text: reasoningState.text }] };
          emit("response.reasoning_summary_text.done", { response_id: responseId, item_id: reasoningState.itemId,
            output_index: reasoningState.index, summary_index: 0, text: reasoningState.text });
          emit("response.output_item.done", { response_id: responseId, output_index: reasoningState.index, item: entry?.item });
        }
        if (textState) {
          const item = { id: textState.itemId, type: "message", status: "completed", role: "assistant",
            content: [{ type: "output_text", text: textState.text, annotations: [] }] };
          const entry = output.find((value) => value.index === textState?.index); if (entry) entry.item = item;
          emit("response.output_text.done", { response_id: responseId, item_id: textState.itemId,
            output_index: textState.index, content_index: 0, text: textState.text });
          emit("response.content_part.done", { response_id: responseId, item_id: textState.itemId,
            output_index: textState.index, content_index: 0, part: item.content[0] });
          emit("response.output_item.done", { response_id: responseId, output_index: textState.index, item });
        }
        const calls = collectCalls(true);
        // Persist before notifying Codex that the response is complete. The
        // next function_call_output request may arrive immediately after this
        // event, so a post-completed write creates a history race.
        try {
          await options.onCompleted?.({ responseId, calls, usage });
          historyRecorded = true;
        } catch {
          // History persistence must not strand an otherwise valid upstream
          // response. The next request can still be repaired by call id.
        }
        emit("response.completed", { response: response("completed") });
      };

      try {
        emit("response.created", { response: response("queued") });
        emit("response.in_progress", { response: response("in_progress") });
        if (options.warning) {
          const state = ensureText();
          const warningText = `${options.warning}\n\n`;
          state.text += warningText;
          emit("response.output_text.delta", { response_id: responseId, item_id: state.itemId,
            output_index: state.index, content_index: 0, delta: warningText });
        }
        const parser = new SseParser();
        const reader = options.body.getReader();
        while (true) {
          if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          const events = done ? parser.finish() : parser.push(value);
          for (const event of events) {
            if (event.data === "[DONE]") { sawDone = true; continue; }
            try { consumeChunk(JSON.parse(event.data) as Record<string, unknown>); }
            catch (error) {
              if (error instanceof SyntaxError) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Malformed upstream SSE JSON", 502);
              throw error;
            }
          }
          if (done) break;
        }
        if (!sawDone) {
          // Some OpenAI-compatible providers close the stream without a sentinel.
        }
        await finish();
        controller.close();
      } catch (error) {
        if (!historyRecorded && tools.size) {
          const partialCalls = collectCalls(false);
          try {
            await options.onCompleted?.({ responseId, calls: partialCalls, usage });
            historyRecorded = true;
          } catch {
            // Preserve the upstream failure; diagnostics are emitted by the
            // compatibility handler when the persistent store is unavailable.
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!completed) emit("response.failed", { response: { ...response("failed"), error: {
          code: error instanceof CompatibilityError ? error.code.toLowerCase() : "upstream_error", message,
        } } });
        controller.close();
      }
    },
  });
}
