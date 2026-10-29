import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../protocol.js";
import { ConversionLossError } from "./diagnostics.js";
import { convertGatewayRequest } from "./request-converter.js";

const requests = {
  responses: { model: "logical", instructions: "follow rules", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image.png" }] }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }], stream: true },
  chat_completions: { model: "logical", messages: [{ role: "system", content: "follow rules" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }], stream: true },
  anthropic: { model: "logical", system: "follow rules", messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }], thinking: { type: "enabled", budget_tokens: 512 }, tools: [{ name: "search", input_schema: { type: "object" } }], stream: true },
  gemini: { model: "logical", systemInstruction: { parts: [{ text: "follow rules" }] }, contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "abc" } }] }], tools: [{ functionDeclarations: [{ name: "search", parameters: { type: "object" } }] }] },
} as const;

test("request conversion covers the four-protocol matrix", async () => {
  for (const source of Object.keys(requests) as Array<keyof typeof requests>) {
    for (const target of Object.keys(requests) as Array<keyof typeof requests>) {
      const result = await convertGatewayRequest(source, target, requests[source] as unknown as JsonObject, { upstreamModelName: "upstream" });
      assert.equal(result.value.model, "upstream", `${source}->${target}`);
      assert.ok(JSON.stringify(result.value).includes("hello"), `${source}->${target}`);
      assert.ok(JSON.stringify(result.value).includes("search"), `${source}->${target}`);
      assert.ok(result.steps.length >= 1, `${source}->${target}`);
    }
  }
});

test("request conversion reports media resolver and can enforce strict loss policy", async () => {
  const result = await convertGatewayRequest("responses", "anthropic", requests.responses as unknown as JsonObject, { upstreamModelName: "claude" });
  assert.equal(result.diagnostics.some((item) => item.code === "media_resolver_missing"), true);
  await assert.rejects(
    convertGatewayRequest("responses", "anthropic", requests.responses as unknown as JsonObject, { upstreamModelName: "claude" }, { toolLossPolicy: "strict" }),
    (error: unknown) => error instanceof ConversionLossError,
  );
});

test("request conversion preserves tool calls, tool results and developer instructions", async () => {
  const responses = {
    model: "logical",
    instructions: "developer policy",
    input: [
      { role: "assistant", content: [{ type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }] },
      { type: "function_call_output", call_id: "call-1", output: "result" },
    ],
    tools: [
      { type: "custom", name: "custom_tool", description: "custom" },
      { type: "web_search_preview" },
    ],
  } as unknown as JsonObject;
  const chat = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "chat-model" });
  assert.deepEqual(chat.value.messages, [
    { role: "system", content: "developer policy" },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] },
    { role: "tool", name: "search", content: "result", tool_call_id: "call-1" },
  ]);
  assert.equal(chat.diagnostics.some((item) => item.code === "custom_tool_downgrade"), true);
  assert.equal(chat.diagnostics.some((item) => item.code === "web_search_tool_downgrade"), true);

  const anthropic = await convertGatewayRequest("chat_completions", "anthropic", {
    model: "logical", messages: [{ role: "developer", content: "developer policy" }, { role: "user", content: "hello" }],
  } as unknown as JsonObject, { upstreamModelName: "claude" });
  assert.equal(anthropic.value.system, "developer policy");
  assert.deepEqual(anthropic.value.messages, [{ role: "user", content: "hello" }]);
});

test("request conversion repairs strict Chat tool history", async () => {
  const responses = {
    model: "logical",
    input: [
      { type: "function_call_output", call_id: "orphan", output: "stale" },
      { type: "function_call", call_id: "call-b", name: "b", arguments: "{}" },
      { type: "function_call", call_id: "call-a", name: "a", arguments: "{}" },
      { type: "function_call_output", call_id: "call-a", output: "A" },
      { type: "function_call_output", call_id: "call-a", output: "duplicate" },
    ],
  } as unknown as JsonObject;
  const result = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "kimi-k3" });
  const messages = result.value.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.role, "user");
  assert.deepEqual((messages[1]?.tool_calls as Array<Record<string, unknown>>).map((call) => call.id), ["call-b", "call-a"]);
  assert.deepEqual(messages.slice(2).map((message) => message.tool_call_id), ["call-b", "call-a"]);
  assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_orphan_tool_result"), true);
  assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_duplicate_tool_result"), true);
  assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_synthetic_tool_result"), true);
});

test("request conversion normalizes developer messages for Chat Completions by default", async () => {
  const request = {
    model: "logical",
    input: [{ role: "developer", content: "developer policy" }, { role: "user", content: "hello" }],
  } as unknown as JsonObject;
  const compatible = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat-model" });
  assert.deepEqual(compatible.value.messages, [
    { role: "system", content: "developer policy" },
    { role: "user", content: "hello" },
  ]);

  const explicitDeveloper = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat-model" }, { instructionRole: "developer" });
  assert.deepEqual(explicitDeveloper.value.messages, [
    { role: "developer", content: "developer policy" },
    { role: "user", content: "hello" },
  ]);
});

test("request conversion applies a route capability profile to hosted tools", async () => {
  const responses = {
    model: "logical",
    input: "search for the answer",
    tools: [{ type: "web_search_preview" }, { type: "function", function: { name: "echo", parameters: { type: "object" } } }],
  } as unknown as JsonObject;
  const result = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "kimi-k3" }, {
    capabilityPolicy: "safe",
    capabilityProfile: {
      "tools.hosted.web_search": { status: "unsupported", source: "observed" },
      "tools.function": { status: "supported", source: "provider" },
    },
  });
  assert.deepEqual(result.value.tools, [{ type: "function", function: { name: "echo", parameters: { type: "object" } } }]);
  assert.equal(result.diagnostics.some((item) => item.code === "capability_tool_omitted"), true);
});

test("request conversion preserves tool choice, parallel tools and provider token dialect", async () => {
  const result = await convertGatewayRequest("responses", "chat_completions", {
    model: "logical",
    max_output_tokens: 123,
    parallel_tool_calls: true,
    tool_choice: "required",
    input: "hello",
  } as unknown as JsonObject, { upstreamModelName: "k3", upstreamEndpoint: "https://api.kimi.com/coding" });
  assert.equal(result.value.max_tokens, 123);
  assert.equal(result.value.parallel_tool_calls, true);
  assert.equal(result.value.tool_choice, "required");
});

test("request conversion pairs Anthropic and Gemini embedded tool results", async () => {
  const anthropic = await convertGatewayRequest("anthropic", "chat_completions", {
    model: "claude", messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: { q: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "answer" }] },
    ],
  } as unknown as JsonObject, { upstreamModelName: "chat" });
  assert.deepEqual(anthropic.value.messages, [
    { role: "assistant", content: null, tool_calls: [{ id: "tool-1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] },
    { role: "tool", name: "lookup", content: "answer", tool_call_id: "tool-1" },
  ]);

  const gemini = await convertGatewayRequest("gemini", "chat_completions", {
    model: "gemini", contents: [
      { role: "model", parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "lookup", response: { result: "answer" } } }] },
    ],
  } as unknown as JsonObject, { upstreamModelName: "chat" });
  const messages = gemini.value.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.role, "assistant");
  assert.equal((messages[1]?.tool_call_id as string), "name:lookup");
  assert.equal(gemini.diagnostics.some((item) => item.code === "tool_exchange_orphan_tool_result"), false);
});
