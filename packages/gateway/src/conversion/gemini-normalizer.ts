import type { JsonObject, JsonValue } from "../protocol.js";

const GEMINI_SNAKE_KEYS: Record<string, string> = {
  inline_data: "inlineData",
  file_data: "fileData",
  file_uri: "fileUri",
  mime_type: "mimeType",
  function_call: "functionCall",
  function_response: "functionResponse",
  function_declarations: "functionDeclarations",
  tool_config: "toolConfig",
  function_calling_config: "functionCallingConfig",
  allowed_function_names: "allowedFunctionNames",
  thinking_config: "thinkingConfig",
  thinking_budget: "thinkingBudget",
  include_thoughts: "includeThoughts",
  stop_sequences: "stopSequences",
  max_output_tokens: "maxOutputTokens",
  response_mime_type: "responseMimeType",
  response_schema: "responseSchema",
  response_json_schema: "responseJsonSchema",
  system_instruction: "systemInstruction",
  generation_config: "generationConfig",
  candidate_count: "candidateCount",
  presence_penalty: "presencePenalty",
  frequency_penalty: "frequencyPenalty",
  cached_content: "cachedContent",
  thought_signature: "thoughtSignature",
};

/** Normalize Gemini REST/proto JSON variants without rewriting schema keys. */
export function normalizeGeminiWire(value: JsonObject): JsonObject {
  return normalizeGeminiObject(value, false);
}

function normalizeGeminiObject(value: JsonObject, inSchema: boolean): JsonObject {
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const mapped = inSchema ? key : GEMINI_SNAKE_KEYS[key] ?? key;
    const childIsSchema = inSchema || mapped === "parameters" || mapped === "inputSchema" || mapped === "responseSchema" || mapped === "responseJsonSchema" || mapped === "schema" || mapped === "json_schema";
    result[mapped] = normalizeGeminiValue(child, childIsSchema);
  }
  return result;
}

function normalizeGeminiValue(value: JsonValue, inSchema: boolean): JsonValue {
  if (Array.isArray(value)) return value.map((item) => normalizeGeminiValue(item, inSchema));
  if (isObject(value)) return normalizeGeminiObject(value, inSchema);
  return value;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
