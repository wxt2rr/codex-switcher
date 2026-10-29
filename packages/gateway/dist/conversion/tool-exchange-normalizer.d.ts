import type { JsonValue } from "../protocol.js";
import { type CanonicalMediaPart } from "./media-resolver.js";
export interface CanonicalToolExchangePart {
    type: "text" | "image" | "file" | "tool_use" | "tool_result" | "reasoning" | "unknown";
    value: JsonValue;
    media?: CanonicalMediaPart;
}
export interface CanonicalToolExchangeMessage {
    role: "system" | "developer" | "user" | "assistant" | "tool";
    parts: CanonicalToolExchangePart[];
    name?: string;
}
export interface ToolExchangeNormalizationDiagnostic {
    code: "orphan_tool_result" | "duplicate_tool_result" | "synthetic_tool_result" | "merged_assistant" | "invalid_tool_call";
    callId?: string;
    message: string;
}
export interface CanonicalToolExchangeNormalizationResult {
    messages: CanonicalToolExchangeMessage[];
    diagnostics: ToolExchangeNormalizationDiagnostic[];
}
/**
 * Canonical equivalent of Magpie's pairToolMessages and CC Switch's known
 * call-id repair. It runs before protocol encoding so every target encoder
 * sees the same valid tool exchange.
 */
export declare function normalizeCanonicalToolExchange(input: readonly CanonicalToolExchangeMessage[]): CanonicalToolExchangeNormalizationResult;
