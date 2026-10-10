import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ConversionDiagnostic } from "./diagnostics.js";
import type { MediaResolver } from "./types.js";

export interface CanonicalMediaPart {
  type: "image" | "file";
  url?: string;
  data?: string;
  mimeType?: string;
  fileName?: string;
}

export async function resolveMediaPart(
  source: GatewayProtocol,
  target: GatewayProtocol,
  part: CanonicalMediaPart,
  resolver: MediaResolver | undefined,
): Promise<{ part: CanonicalMediaPart; diagnostics: ConversionDiagnostic[] }> {
  if (part.data || !part.url || source === target || target === "chat_completions" || target === "responses") return { part, diagnostics: [] };
  const resolve = part.type === "image" ? resolver?.resolveImage : resolver?.resolveFile;
  if (!resolve) {
    return {
      part,
      diagnostics: [{ code: "media_resolver_missing", level: "warning", message: "The target protocol may require inline media data, but no media resolver was configured", source, target }],
    };
  }
  const resolved = await resolve(part.url);
  const fileName = "fileName" in resolved && typeof resolved.fileName === "string" ? resolved.fileName : undefined;
  return { part: { ...part, data: resolved.data, mimeType: resolved.mimeType, ...(fileName ? { fileName } : {}) }, diagnostics: [] };
}

export function asMediaPart(value: JsonValue | undefined): CanonicalMediaPart | undefined {
  if (!isObject(value)) return undefined;
  if (isObject(value.image_url)) return { type: "image", url: asString(value.image_url.url) };
  if (value.type === "input_image") return { type: "image", url: asString(value.image_url) };
  if (isObject(value.source) && value.source.type === "url") return { type: "image", url: asString(value.source.url) };
  if (isObject(value.source) && value.source.type === "base64") return { type: "image", data: asString(value.source.data), mimeType: asString(value.source.media_type) };
  if (isObject(value.inlineData)) return { type: "image", data: asString(value.inlineData.data), mimeType: asString(value.inlineData.mimeType) };
  if (isObject(value.file)) return { type: "file", url: asString(value.file.file_url), data: asString(value.file.file_data), mimeType: asString(value.file.mime_type) };
  if (value.type === "input_file") return { type: "file", url: asString(value.file_url), data: asString(value.file_data), mimeType: asString(value.mime_type), fileName: asString(value.filename) };
  if (isObject(value.fileData)) return { type: "file", url: asString(value.fileData.fileUri), mimeType: asString(value.fileData.mimeType) };
  if (isObject(value.source) && value.source.type === "base64" && typeof value.type === "string" && value.type === "document") return { type: "file", data: asString(value.source.data), mimeType: asString(value.source.media_type) };
  if (isObject(value.source) && value.source.type === "url" && typeof value.type === "string" && value.type === "document") return { type: "file", url: asString(value.source.url) };
  return undefined;
}

function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
