const SCHEMA_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"]);
const SCHEMA_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_SINGLE_KEYS = new Set(["items", "additionalItems", "unevaluatedItems", "contains", "additionalProperties", "unevaluatedProperties", "propertyNames", "not", "if", "then", "else", "contentSchema"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function upstreamRequiresMoonshotSchema(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return ["moonshot.cn", "moonshot.ai", "kimi.com"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

export function normalizeMoonshotChatTools(body: Record<string, unknown>): number {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  // Tool definitions are often shared with the caller's request object by the
  // registry. Clone before rewriting so a Kimi request cannot mutate a later
  // non-Kimi request that reuses the same model configuration.
  body.tools = tools.map((tool) => {
    try { return JSON.parse(JSON.stringify(tool)) as unknown; } catch { return tool; }
  });
  const clonedTools = Array.isArray(body.tools) ? body.tools : [];
  let changed = 0;
  for (const rawTool of clonedTools) {
    const tool = record(rawTool);
    const fn = record(tool?.function);
    const parameters = record(fn?.parameters);
    if (parameters) changed += wrapRefSiblings(parameters);
  }
  return changed;
}

function wrapRefSiblings(schema: Record<string, unknown>): number {
  let changed = 0;
  if (typeof schema.$ref === "string" && Object.keys(schema).length > 1) {
    const reference = schema.$ref;
    delete schema.$ref;
    schema.allOf = [{ $ref: reference }];
    changed += 1;
  }
  for (const [key, child] of Object.entries(schema)) {
    if (SCHEMA_MAP_KEYS.has(key)) {
      const map = record(child);
      if (map) for (const value of Object.values(map)) {
        const nested = record(value);
        if (nested) changed += wrapRefSiblings(nested);
      }
    } else if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
      for (const value of child) {
        const nested = record(value);
        if (nested) changed += wrapRefSiblings(nested);
      }
    } else if (SCHEMA_SINGLE_KEYS.has(key)) {
      if (Array.isArray(child)) {
        for (const value of child) {
          const nested = record(value);
          if (nested) changed += wrapRefSiblings(nested);
        }
      } else {
        const nested = record(child);
        if (nested) changed += wrapRefSiblings(nested);
      }
    }
  }
  return changed;
}
