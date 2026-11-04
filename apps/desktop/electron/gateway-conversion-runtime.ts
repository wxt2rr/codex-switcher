import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { GatewayProtocol, JsonObject } from "../../../packages/gateway/dist/protocol.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult, ResponseStreamState } from "../../../packages/gateway/dist/conversion/index.js";
import { getConfiguredResourcesPath, resolveRuntimeResource } from "./runtime-paths.js";

type GatewayConversionModule = typeof import("../../../packages/gateway/dist/conversion/index.js");

export interface GatewayResponseStreamHooks {
  /** Called once after a terminal or interrupted stream has been finalized. */
  onFinalized?: (state: ResponseStreamState, reason: string) => void | Promise<void>;
}

let conversionModule: GatewayConversionModule | undefined;

export function useLegacyProtocolConversion(env: NodeJS.ProcessEnv = process.env): boolean {
  // The legacy transformers are retained as source-compatible test helpers,
  // but they are no longer a selectable runtime path.  Allowing an
  // environment toggle here would reintroduce the very capability drift the
  // shared Gateway converter is meant to eliminate. Read the argument so
  // callers can keep their old signature without leaking configuration into
  // production behavior.
  void env;
  return false;
}

/** Load the shared conversion engine from the workspace or packaged resources. */
export async function initializeGatewayConversionRuntime(): Promise<boolean> {
  if (conversionModule) return true;
  const relativePath = join("packages", "gateway", "dist", "conversion", "index.js");
  const currentFile = typeof __filename === "string" ? __filename : join(process.cwd(), "apps", "desktop", "electron", "gateway-conversion-runtime.ts");
  // During development/tests an old packaged app may still be present in
  // CODEX_SWITCHER_DESKTOP_RESOURCES_PATH. Prefer the workspace build so a
  // freshly compiled converter is actually exercised. In a packaged app the
  // workspace root is unavailable and resolution falls back to Resources.
  let runtimePath: string;
  try {
    runtimePath = resolveRuntimeResource(relativePath, { currentFile });
  } catch {
    runtimePath = resolveRuntimeResource(relativePath, { currentFile, resourcesPath: getConfiguredResourcesPath() });
  }
  if (!existsSync(runtimePath)) {
    runtimePath = resolveRuntimeResource(relativePath, { currentFile, resourcesPath: getConfiguredResourcesPath() });
  }
  if (!existsSync(runtimePath)) return false;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<GatewayConversionModule>;
    conversionModule = await dynamicImport(pathToFileURL(runtimePath).href);
    return true;
  } catch {
    conversionModule = undefined;
    return false;
  }
}

export async function convertGatewayRequestAtRuntime(
  source: GatewayProtocol,
  target: GatewayProtocol,
  body: JsonObject,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<ConversionResult<JsonObject> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.convertGatewayRequest(source, target, body, metadata, options);
}

export async function convertGatewayResponseAtRuntime(
  source: GatewayProtocol,
  target: GatewayProtocol,
  body: JsonObject,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<ConversionResult<JsonObject> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.convertGatewayResponse(source, target, body, metadata, options);
}

/**
 * Encode the canonical response events accumulated by a streaming conversion
 * into the requested non-streaming envelope.  Compatibility adapters use the
 * exact same event state for history persistence and for a JSON fallback, so
 * the stream and non-stream paths cannot drift apart.
 */
export async function encodeGatewayResponseEventsAtRuntime(
  target: GatewayProtocol,
  events: readonly import("../../../packages/gateway/dist/conversion/index.js").ConversionResponseEvent[],
  metadata: ConversionMetadata = {},
): Promise<JsonObject | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.encodeResponseEvents(target, events, metadata);
}

/** Rebuild lossless Responses history with the same converter used on the wire. */
export async function buildGatewayStreamHistoryAtRuntime(
  events: readonly import("../../../packages/gateway/dist/conversion/index.js").ConversionResponseEvent[],
): Promise<{ items: JsonObject[]; calls: Array<{ id: string; name: string; arguments: string; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number; signature?: string }> } | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.buildStreamHistory(events);
}

export async function createGatewayResponseStreamStateAtRuntime(
  source: GatewayProtocol,
  target: GatewayProtocol,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<ResponseStreamState | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.createResponseStreamState(source, target, metadata, options);
}

export async function convertGatewayStreamChunkAtRuntime(
  state: ResponseStreamState,
  body: JsonObject,
): Promise<ConversionResult<JsonObject[]> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.convertStreamChunk(state, body);
}

export async function finalizeGatewayResponseStreamAtRuntime(
  state: ResponseStreamState,
  reason?: string,
): Promise<ConversionResult<JsonObject[]> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.finalizeResponseStream(state, reason);
}

export async function failGatewayResponseStreamAtRuntime(
  state: ResponseStreamState,
  code: string,
  message: string,
  retryable = false,
  details?: JsonObject,
): Promise<ConversionResult<JsonObject[]> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.failResponseStream(state, code, message, retryable, details);
}

/** Convert an upstream SSE response without buffering the complete response. */
export async function convertGatewayResponseStreamAtRuntime(
  response: Response,
  source: GatewayProtocol,
  target: GatewayProtocol,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
  hooks: GatewayResponseStreamHooks = {},
): Promise<Response | undefined> {
  const state = await createGatewayResponseStreamStateAtRuntime(source, target, metadata, options);
  if (!state || !response.body) return undefined;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let doneEmitted = false;
  let hookCalled = false;
  const notifyFinalized = async (reason: string): Promise<void> => {
    if (hookCalled) return;
    hookCalled = true;
    try {
      await hooks.onFinalized?.(state, reason);
    } catch {
      // History/telemetry persistence must never break the response stream.
    }
  };

  const output = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const emit = (events: readonly JsonObject[]): void => {
          for (const event of events) controller.enqueue(encoder.encode(encodeSseEvent(target, event)));
        };
        const emitDone = (): void => {
          if (target === "chat_completions" && !doneEmitted) {
            doneEmitted = true;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
        };
        const consume = async (block: string): Promise<void> => {
          const data = block.split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();
          if (!data) return;
          if (data === "[DONE]") {
            const finalized = await finalizeGatewayResponseStreamAtRuntime(state);
            emit(finalized?.value ?? []);
            await notifyFinalized("stop");
            emitDone();
            return;
          }
          const parsed = JSON.parse(data) as unknown;
          if (!isJsonObject(parsed)) return;
          const converted = await convertGatewayStreamChunkAtRuntime(state, parsed);
          emit(converted?.value ?? []);
          if (state.ended) await notifyFinalized("stop");
        };

        try {
          const reader = response.body!.getReader();
          while (true) {
            const next = await reader.read();
            pending += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
            const blocks = pending.split(/\r?\n\r?\n/);
            pending = blocks.pop() ?? "";
            for (const block of blocks) await consume(block);
            if (next.done) break;
          }
          pending += decoder.decode();
          if (pending.trim()) await consume(pending);
          if (!state.ended) {
            const finalized = await finalizeGatewayResponseStreamAtRuntime(state);
            emit(finalized?.value ?? []);
            await notifyFinalized("stop");
          } else {
            await notifyFinalized("stop");
          }
          emitDone();
          controller.close();
        } catch (error) {
          if (!state.ended) {
            const aborted = error instanceof DOMException && error.name === "AbortError";
            const failed = await failGatewayResponseStreamAtRuntime(state, aborted ? "client_cancelled" : "stream_conversion_failed", error instanceof Error ? error.message : String(error), false, errorDetails(error));
            emit(failed?.value ?? []);
          }
          await notifyFinalized("error");
          emitDone();
          controller.close();
        }
      })();
    },
  });

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", headers.get("cache-control") ?? "no-cache");
  return new Response(output, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Convert an upstream SSE response into one non-streaming response.
 *
 * Some Responses-compatible providers only implement the streaming transport
 * and reject `stream: false`.  The Gateway still has to honor a non-streaming
 * Chat Completions client, so consume the same shared stream state used by the
 * normal SSE converter and encode the finalized events as the requested
 * protocol's JSON response.
 */
export async function convertGatewayResponseStreamToJsonAtRuntime(
  response: Response,
  source: GatewayProtocol,
  target: GatewayProtocol,
  metadata: ConversionMetadata = {},
  hooks: GatewayResponseStreamHooks = {},
): Promise<Response | undefined> {
  const state = await createGatewayResponseStreamStateAtRuntime(source, target, metadata);
  if (!state || !response.body) return undefined;

  const decoder = new TextDecoder();
  let pending = "";
  let hookCalled = false;
  const notifyFinalized = async (reason: string): Promise<void> => {
    if (hookCalled) return;
    hookCalled = true;
    try {
      await hooks.onFinalized?.(state, reason);
    } catch {
      // History/telemetry persistence must never break a compatibility response.
    }
  };
  const consume = async (block: string): Promise<void> => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;
    if (data === "[DONE]") {
      await finalizeGatewayResponseStreamAtRuntime(state);
      await notifyFinalized("stop");
      return;
    }
    const parsed = JSON.parse(data) as unknown;
    if (!isJsonObject(parsed)) return;
    await convertGatewayStreamChunkAtRuntime(state, parsed);
    if (state.ended) await notifyFinalized("stop");
  };

  try {
    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      pending += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? "";
      for (const block of blocks) await consume(block);
      if (next.done) break;
    }
    pending += decoder.decode();
    if (pending.trim()) await consume(pending);
    if (!state.ended) {
      await finalizeGatewayResponseStreamAtRuntime(state);
      await notifyFinalized("stop");
    } else {
      await notifyFinalized("stop");
    }
  } catch (error) {
    if (!state.ended) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      await failGatewayResponseStreamAtRuntime(state, aborted ? "client_cancelled" : "stream_conversion_failed", error instanceof Error ? error.message : String(error), false, errorDetails(error));
    }
    await notifyFinalized("error");
  }

  const encoded = conversionModule!.encodeResponseEvents(target, state.events, metadata);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(encoded), { status: response.status, statusText: response.statusText, headers });
}

function encodeSseEvent(protocol: GatewayProtocol, event: JsonObject): string {
  const type = typeof event.type === "string" ? event.type : undefined;
  const prefix = (protocol === "responses" || protocol === "anthropic") && type ? `event: ${type}\n` : "";
  return `${prefix}data: ${JSON.stringify(event)}\n\n`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetails(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value)) return undefined;
  const details: JsonObject = {};
  for (const key of ["status", "status_code", "request_id", "type", "code", "name"]) {
    const child = value[key];
    if (typeof child === "string" || typeof child === "number") details[key] = child;
  }
  return Object.keys(details).length ? details : undefined;
}
