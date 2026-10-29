import type { JsonObject, JsonValue } from "../protocol.js";

const HOST_SUFFIXES = ["moonshot.cn", "moonshot.ai", "kimi.com"];
const SINGLE_SCHEMA_KEYS = ["items", "additionalItems", "unevaluatedItems", "contains", "additionalProperties", "unevaluatedProperties", "propertyNames", "not", "if", "then", "else", "contentSchema"];
const ARRAY_SCHEMA_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"];
const MAP_SCHEMA_KEYS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"];

export function upstreamRequiresMoonshotSchema(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/** Rewrites `$ref` siblings to the draft-07-compatible allOf form. */
export function normalizeMoonshotChatTools(body: JsonObject): number {
  if (!Array.isArray(body.tools)) return 0;
  let changed = 0;
  for (const rawTool of body.tools) {
    if (!isObject(rawTool)) continue;
    const fn = isObject(rawTool.function) ? rawTool.function : undefined;
    if (!fn || !isObject(fn.parameters)) continue;
    changed += wrapRefSiblings(fn.parameters);
  }
  return changed;
}

function wrapRefSiblings(schema: JsonObject): number {
  let changed = 0;
  if (typeof schema.$ref === "string" && Object.keys(schema).length > 1) {
    const reference = schema.$ref;
    delete schema.$ref;
    schema.allOf = [{ $ref: reference }];
    changed += 1;
  }
  for (const [key, child] of Object.entries(schema)) {
    if (MAP_SCHEMA_KEYS.includes(key) && isObject(child)) {
      for (const value of Object.values(child)) if (isObject(value)) changed += wrapRefSiblings(value);
    } else if (ARRAY_SCHEMA_KEYS.includes(key) && Array.isArray(child)) {
      for (const value of child) if (isObject(value)) changed += wrapRefSiblings(value);
    } else if (SINGLE_SCHEMA_KEYS.includes(key)) {
      if (Array.isArray(child)) {
        for (const value of child) if (isObject(value)) changed += wrapRefSiblings(value);
      } else if (isObject(child)) {
        changed += wrapRefSiblings(child);
      }
    }
  }
  return changed;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
