import type { JsonObject } from "../protocol.js";
/** Normalize Gemini REST/proto JSON variants without rewriting schema keys. */
export declare function normalizeGeminiWire(value: JsonObject): JsonObject;
