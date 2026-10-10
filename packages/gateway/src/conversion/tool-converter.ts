import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";

export type CanonicalToolKind = "function" | "custom" | "namespace" | "web_search";

export interface CanonicalTool {
  kind: CanonicalToolKind;
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  namespace?: string;
  raw?: JsonObject;
}

export function decodeTools(protocol: GatewayProtocol, value: JsonValue | undefined): CanonicalTool[] {
  if (!Array.isArray(value)) return [];
  if (protocol === "gemini") {
    return value.flatMap((item) => {
      if (!isObject(item) || !Array.isArray(item.functionDeclarations)) return [];
      return item.functionDeclarations.flatMap((declaration) => decodeFunctionTool(declaration));
    });
  }
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    if (item.type === "web_search" || item.type === "web_search_preview") return [{ kind: "web_search", name: String(item.type), raw: item }];
    if (item.type === "custom") return [{ kind: "custom", name: asString(item.name) ?? "custom", description: asString(item.description), raw: item }];
    if (item.type === "namespace") {
      const functions = isObject(item.namespace) ? item.namespace.functions : undefined;
      return isObject(functions) ? Object.keys(functions).map((name) => ({ kind: "namespace" as const, name, namespace: asString(item.name), raw: item })) : [];
    }
    if (protocol === "anthropic") return decodeFunctionTool(item);
    return decodeFunctionTool(isObject(item.function) ? item.function : item);
  });
}

export function encodeTools(protocol: GatewayProtocol, tools: readonly CanonicalTool[]): JsonValue[] | undefined {
  if (!tools.length) return undefined;
  const result: JsonValue[] = [];
  for (const tool of tools) {
    if (tool.kind === "web_search") {
      result.push(protocol === "responses" ? { type: "web_search_preview" } : protocol === "chat_completions" ? { type: "web_search_options" } : protocol === "gemini" ? { googleSearch: {} } : { type: "computer_20241022", name: tool.name });
      continue;
    }
    if (protocol === "gemini") {
      result.push({ functionDeclarations: [{ name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.inputSchema ?? { type: "object" } }] });
      continue;
    }
    if (protocol === "anthropic") {
      result.push({ name: tool.name, ...(tool.description ? { description: tool.description } : {}), input_schema: tool.inputSchema ?? { type: "object" } });
      continue;
    }
    if (tool.kind === "custom") {
      result.push(protocol === "responses" ? { type: "custom", name: tool.name, ...(tool.description ? { description: tool.description } : {}) } : { type: "function", function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.inputSchema ?? { type: "object" } } });
      continue;
    }
    result.push({ type: "function", function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.inputSchema ?? { type: "object" } } });
  }
  return result;
}

function decodeFunctionTool(value: JsonValue | undefined): CanonicalTool[] {
  if (!isObject(value)) return [];
  const name = asString(value.name);
  if (!name) return [];
  return [{ kind: "function", name, description: asString(value.description), inputSchema: isObject(value.parameters) ? value.parameters : isObject(value.input_schema) ? value.input_schema : undefined, raw: value }];
}

function isObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
