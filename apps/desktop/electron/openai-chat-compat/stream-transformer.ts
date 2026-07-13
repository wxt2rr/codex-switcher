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

export function transformChatStream(options: TransformChatStreamOptions): ReadableStream<Uint8Array> {
  const responseId = options.responseId ?? `resp_${randomUUID().replace(/-/g, "")}`;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const output: Array<{ index: number; item: Record<string, unknown> }> = [];
      const tools = new Map<number, ToolState>();
      let nextOutputIndex = 0;
      let textState: { itemId: string; index: number; text: string } | undefined;
      let reasoningState: { itemId: string; index: number; text: string } | undefined;
      let usage: ResponsesUsage | undefined;
      let completed = false;
      let sawDone = false;
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
      const announceTool = (tool: ToolState) => {
        if (tool.announced || !tool.id || !tool.name) return;
        tool.announced = true;
        tool.outputIndex = nextOutputIndex++;
        const originalName = options.registry.byChatName.get(tool.name)?.originalName ?? tool.name;
        const item = { id: tool.itemId, type: "function_call", status: "in_progress", arguments: "", call_id: tool.id, name: originalName };
        output.push({ index: tool.outputIndex, item });
        emit("response.output_item.added", { response_id: responseId, output_index: tool.outputIndex, item });
      };
      const consumeChunk = (payload: Record<string, unknown>) => {
        if (completed) throw new CompatibilityError("UPSTREAM_PROTOCOL", "Upstream emitted content after completion", 502);
        if (payload.usage) usage = normalizeChatUsage(payload.usage);
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        for (const rawChoice of choices) {
          const choice = record(rawChoice); const delta = record(choice?.delta);
          if (!choice || !delta) continue;
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
          if (Array.isArray(delta.tool_calls)) for (const rawTool of delta.tool_calls) {
            const toolDelta = record(rawTool); if (!toolDelta) continue;
            const index = Number(toolDelta.index ?? 0);
            const state = tools.get(index) ?? { index, arguments: "", announced: false, itemId: `fc_${randomUUID().replace(/-/g, "")}` };
            if (typeof toolDelta.id === "string") state.id = toolDelta.id;
            const fn = record(toolDelta.function);
            if (fn && typeof fn.name === "string") state.name = (state.name ?? "") + fn.name;
            if (fn && typeof fn.arguments === "string") state.arguments += fn.arguments;
            tools.set(index, state); announceTool(state);
            if (state.announced && fn && typeof fn.arguments === "string" && fn.arguments) {
              emit("response.function_call_arguments.delta", { response_id: responseId, item_id: state.itemId,
                output_index: state.outputIndex, delta: fn.arguments });
            }
          }
        }
      };
      const finish = async () => {
        if (completed) return;
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
        const calls: ChatToolCall[] = [];
        for (const state of [...tools.values()].sort((a, b) => a.index - b.index)) {
          state.id ??= `call_${randomUUID().replace(/-/g, "")}`;
          state.name ??= "unknown_tool"; announceTool(state);
          const originalName = options.registry.byChatName.get(state.name)?.originalName ?? state.name;
          const item = { id: state.itemId, type: "function_call", status: "completed", arguments: state.arguments,
            call_id: state.id, name: originalName };
          const entry = output.find((value) => value.index === state.outputIndex); if (entry) entry.item = item;
          emit("response.function_call_arguments.done", { response_id: responseId, item_id: state.itemId,
            output_index: state.outputIndex, arguments: state.arguments });
          emit("response.output_item.done", { response_id: responseId, output_index: state.outputIndex, item });
          calls.push({ id: state.id, type: "function", function: { name: originalName, arguments: state.arguments } });
        }
        emit("response.completed", { response: response("completed") });
        await options.onCompleted?.({ responseId, calls, usage });
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
        const message = error instanceof Error ? error.message : String(error);
        if (!completed) emit("response.failed", { response: { ...response("failed"), error: { code: "upstream_error", message } } });
        controller.close();
      }
    },
  });
}
