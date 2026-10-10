import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ReasoningConversionState } from "./types.js";

export function decodeReasoning(protocol: GatewayProtocol, body: JsonObject): ReasoningConversionState | undefined {
  const raw = protocol === "anthropic" ? body.thinking : body.reasoning;
  if (!isObject(raw)) return undefined;
  const effort = asString(raw.effort);
  const budgetTokens = asNumber(raw.budget_tokens) ?? asNumber(raw.budgetTokens);
  const enabled = raw.type === "enabled" || raw.enabled === true || effort !== undefined || budgetTokens !== undefined;
  return {
    ...(enabled ? { enabled: true } : {}),
    ...(isReasoningEffort(effort) ? { effort } : {}),
    ...(budgetTokens !== undefined && budgetTokens > 0 ? { budgetTokens: Math.floor(budgetTokens) } : {}),
    ...(raw.return_thinking === true || raw.returnThinking === true ? { returnThinking: true } : {}),
  };
}

export function encodeReasoning(protocol: GatewayProtocol, state: ReasoningConversionState | undefined): JsonObject | undefined {
  if (!state || state.enabled === false) return undefined;
  if (protocol === "anthropic") {
    return {
      type: "enabled",
      budget_tokens: state.budgetTokens ?? 1024,
    };
  }
  if (protocol === "gemini") {
    return {
      thinkingConfig: {
        ...(state.budgetTokens !== undefined ? { thinkingBudget: state.budgetTokens } : {}),
        ...(state.returnThinking !== undefined ? { includeThoughts: state.returnThinking } : {}),
      },
    };
  }
  return {
    ...(state.effort ? { effort: state.effort } : {}),
    ...(state.budgetTokens !== undefined ? { budget_tokens: state.budgetTokens } : {}),
    ...(state.returnThinking !== undefined ? { return_thinking: state.returnThinking } : {}),
  };
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function asNumber(value: JsonValue | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isReasoningEffort(value: string | undefined): value is NonNullable<ReasoningConversionState["effort"]> {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}
