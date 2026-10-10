import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { GatewayProtocol, JsonObject } from "../../../packages/gateway/dist/protocol.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult, ResponseStreamState } from "../../../packages/gateway/dist/conversion/index.js";
import { getConfiguredResourcesPath, resolveRuntimeResource } from "./runtime-paths.js";

type GatewayConversionModule = typeof import("../../../packages/gateway/dist/conversion/index.js");

let conversionModule: GatewayConversionModule | undefined;

export function useLegacyProtocolConversion(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION?.trim().toLowerCase() === "1"
    || env.CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION?.trim().toLowerCase() === "true";
}

/** Load the shared conversion engine from the workspace or packaged resources. */
export async function initializeGatewayConversionRuntime(): Promise<boolean> {
  if (conversionModule) return true;
  const runtimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "conversion", "index.js"), {
    currentFile: typeof __filename === "string" ? __filename : join(process.cwd(), "apps", "desktop", "electron", "gateway-conversion-runtime.ts"),
    resourcesPath: getConfiguredResourcesPath(),
  });
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
): Promise<ConversionResult<JsonObject[]> | undefined> {
  if (!(await initializeGatewayConversionRuntime())) return undefined;
  return conversionModule!.failResponseStream(state, code, message);
}

/** Convert an upstream SSE response without buffering the complete response. */
export async function convertGatewayResponseStreamAtRuntime(
  response: Response,
  source: GatewayProtocol,
  target: GatewayProtocol,
  metadata: ConversionMetadata = {},
  options: ConversionOptions = {},
): Promise<Response | undefined> {
  const state = await createGatewayResponseStreamStateAtRuntime(source, target, metadata, options);
  if (!state || !response.body) return undefined;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let doneEmitted = false;

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
            emitDone();
            return;
          }
          const parsed = JSON.parse(data) as unknown;
          if (!isJsonObject(parsed)) return;
          const converted = await convertGatewayStreamChunkAtRuntime(state, parsed);
          emit(converted?.value ?? []);
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
          }
          emitDone();
          controller.close();
        } catch (error) {
          if (!state.ended) {
            const failed = await failGatewayResponseStreamAtRuntime(state, "stream_conversion_failed", error instanceof Error ? error.message : String(error));
            emit(failed?.value ?? []);
          }
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

function encodeSseEvent(protocol: GatewayProtocol, event: JsonObject): string {
  const type = typeof event.type === "string" ? event.type : undefined;
  const prefix = (protocol === "responses" || protocol === "anthropic") && type ? `event: ${type}\n` : "";
  return `${prefix}data: ${JSON.stringify(event)}\n\n`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
