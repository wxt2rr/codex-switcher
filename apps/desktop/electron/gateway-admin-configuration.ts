const EXCLUDED_GATEWAY_KEYS = new Set([
  "intentrulesjson",
  "intentrules",
  "intentrouting",
  "intentroutingenabled",
  "classifier",
  "promptrouting",
  "prompt",
  "prompts",
  "rules",
]);

function normalizeKey(key: string): string {
  return key.replace(/[\s_-]+/g, "").toLowerCase();
}

/**
 * Keeps legacy/admin JSON compatible while ensuring the product never
 * persists the excluded prompt-intent routing surface.
 */
export function stripExcludedGatewayFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gateway configuration must be a JSON object");
  }

  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current)
        .filter(([key]) => !EXCLUDED_GATEWAY_KEYS.has(normalizeKey(key)))
        .map(([key, child]) => [key, visit(child)]),
    );
  };

  return visit(value) as Record<string, unknown>;
}
