import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayRequestContext } from "../request/request-ir.js";
import { decodeGatewayRequest, encodeGatewayRequest, decodeGatewayResponse, encodeGatewayResponse } from "./codecs.js";
import type { JsonObject } from "../protocol.js";

const context = createGatewayRequestContext({ requestId: "r1", environmentId: "env", agentId: "codex", protocol: "responses", logicalModelId: "logical" });

test("all four protocols decode into the same logical request", () => {
  const requests = [
    { protocol: "responses" as const, body: { model: "m", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], tools: [{ type: "function", function: { name: "search", parameters: {} } }] } },
    { protocol: "chat_completions" as const, body: { model: "m", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "search", parameters: {} } }] } },
    { protocol: "anthropic" as const, body: { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], tools: [{ name: "search", input_schema: {} }] } },
    { protocol: "gemini" as const, body: { model: "m", contents: [{ role: "user", parts: [{ text: "hello" }] }], tools: [{ functionDeclarations: [{ name: "search", parameters: {} }] }] } },
  ];
  for (const item of requests) {
    const request = decodeGatewayRequest(item.protocol, item.body as unknown as JsonObject, { ...context, protocol: item.protocol });
    assert.equal(request.messages[0]?.parts[0]?.value, "hello");
    assert.equal(request.tools[0]?.name, "search");
  }
});

test("the IR encodes a tool, reasoning and system message for every protocol", () => {
  const request = decodeGatewayRequest("responses", { model: "m", input: [{ role: "system", content: "rules" }, { role: "user", content: "hello" }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", parameters: {} } }] }, context);
  for (const protocol of ["responses", "chat_completions", "anthropic", "gemini"] as const) {
    const body = encodeGatewayRequest(protocol, request, "upstream");
    assert.equal(body.model, "upstream");
    assert.ok(JSON.stringify(body).includes("search"));
    assert.ok(JSON.stringify(body).includes("rules"));
  }
});

test("the Chat Completions codec downgrades developer messages to system", () => {
  const request = decodeGatewayRequest("responses", {
    model: "m",
    input: [{ role: "developer", content: "rules" }, { role: "user", content: "hello" }],
  }, context);
  const body = encodeGatewayRequest("chat_completions", request, "upstream");
  assert.deepEqual(body.messages, [
    { role: "system", content: "rules" },
    { role: "user", content: "hello" },
  ]);
});

test("public codec preserves request controls and Gemini snake_case", () => {
  const request = decodeGatewayRequest("gemini", {
    model: "gemini",
    system_instruction: { parts: [{ text: "rules" }] },
    contents: [{ role: "user", parts: [{ text: "hello" }, { inline_data: { mime_type: "image/png", data: "abc" } }] }],
    tools: [{ function_declarations: [{ name: "lookup", parameters: { type: "object", properties: { snake_case: { type: "string" } } } }] }],
    generation_config: { max_output_tokens: 99, stop_sequences: ["END"] },
  }, { ...context, protocol: "gemini" });
  assert.equal(request.parameters?.maxTokens, 99);
  const chat = encodeGatewayRequest("chat_completions", request, "chat");
  assert.equal(chat.max_tokens, 99);
  assert.deepEqual((chat.tools as Array<Record<string, unknown>>)[0]?.function, { name: "lookup", parameters: { type: "object", properties: { snake_case: { type: "string" } } } });
});

test("public codec preserves Anthropic token budgets and Gemini structured output", () => {
  const anthropic = decodeGatewayRequest("anthropic", {
    model: "claude",
    messages: [{ role: "user", content: "json" }],
    max_tokens: 777,
    output_config: { format: { type: "json_schema", schema: { type: "object" } } },
  }, { ...context, protocol: "anthropic" });
  const anthropicBody = encodeGatewayRequest("anthropic", anthropic, "claude");
  assert.equal(anthropicBody.max_tokens, 777);
  assert.deepEqual(anthropicBody.output_config, { format: { type: "json_schema", schema: { type: "object" } } });

  const gemini = decodeGatewayRequest("gemini", {
    model: "gemini",
    contents: [{ role: "user", parts: [{ text: "json" }] }],
    generation_config: { response_mime_type: "application/json", response_schema: { type: "object" } },
  }, { ...context, protocol: "gemini" });
  assert.deepEqual(gemini.parameters?.responseFormat, { type: "json_schema", schema: { type: "object" } });
  const geminiBody = encodeGatewayRequest("gemini", gemini, "gemini");
  assert.deepEqual((geminiBody.generationConfig as Record<string, unknown>).responseSchema, { type: "object" });
});

test("tool encoders keep Responses and Chat field placement distinct", () => {
  const chat = decodeGatewayRequest("chat_completions", {
    model: "m",
    messages: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" }, strict: true } }],
  }, { ...context, protocol: "chat_completions" });
  const responses = encodeGatewayRequest("responses", chat, "upstream");
  assert.deepEqual(responses.tools, [{ type: "function", name: "search", description: "Search", parameters: { type: "object" }, strict: true }]);
  assert.equal((responses.tools as Array<Record<string, unknown>>)[0]?.function, undefined);

  const responseInput = decodeGatewayRequest("responses", {
    model: "m",
    input: "hello",
    tools: [{ type: "function", name: "search", parameters: { type: "object" }, strict: true }],
  }, context);
  const chatOutput = encodeGatewayRequest("chat_completions", responseInput, "upstream");
  assert.deepEqual(chatOutput.tools, [{ type: "function", function: { name: "search", parameters: { type: "object" }, strict: true } }]);
});

test("public Chat codec keeps hosted web search at the top level", () => {
  const request = decodeGatewayRequest("chat_completions", {
    model: "m",
    messages: [{ role: "user", content: "search" }],
    web_search_options: { search_context_size: "high" },
  }, { ...context, protocol: "chat_completions" });
  assert.equal(request.tools[0]?.kind, "web_search");
  const encoded = encodeGatewayRequest("chat_completions", request, "upstream");
  assert.deepEqual(encoded.web_search_options, { search_context_size: "high" });
  assert.equal(encoded.tools, undefined);
});

test("Responses namespaces are grouped and preserve child function fields", () => {
  const request = decodeGatewayRequest("responses", {
    model: "m",
    input: "hello",
    tools: [{ type: "namespace", name: "crm", description: "CRM", defer_loading: true, tools: [{ type: "function", name: "lookup", parameters: { type: "object" }, defer_loading: true }] }],
  }, context);
  const body = encodeGatewayRequest("responses", request, "upstream");
  assert.deepEqual(body.tools, [{ type: "namespace", name: "crm", description: "CRM", defer_loading: true, tools: [{ type: "function", name: "lookup", parameters: { type: "object" }, defer_loading: true }] }]);
});

test("public codec preserves Responses tool items when hopping through the IR", () => {
  const request = decodeGatewayRequest("responses", {
    model: "m",
    input: [
      { role: "user", content: [{ type: "input_text", text: "look up" }] },
      { id: "fc-item", type: "function_call", call_id: "call-1", name: "lookup", arguments: "{\"q\":\"x\"}" },
      { type: "function_call_output", call_id: "call-1", output: "ok" },
    ],
  }, context);
  assert.equal(request.messages.flatMap((message) => message.parts).filter((part) => part.type === "tool_use").length, 1);
  assert.equal(request.messages.flatMap((message) => message.parts).filter((part) => part.type === "tool_result").length, 1);

  const chat = encodeGatewayRequest("chat_completions", request, "m");
  assert.deepEqual((chat.messages as JsonObject[]).map((message) => message.role), ["user", "assistant", "tool"]);
  assert.equal(((chat.messages as JsonObject[])[1]?.tool_calls as JsonObject[])[0]?.id, "call-1");
  assert.equal((chat.messages as JsonObject[])[2]?.tool_call_id, "call-1");

  const responses = encodeGatewayRequest("responses", request, "m");
  assert.equal((responses.input as JsonObject[]).some((item) => item.type === "function_call" && item.id === "fc-item"), true);
  assert.equal((responses.input as JsonObject[]).some((item) => item.type === "function_call_output" && item.call_id === "call-1"), true);
  assert.equal(((responses.input as JsonObject[])[0]?.content as JsonObject[])[0]?.type, "input_text");
});

test("response events round-trip across non-streaming protocol envelopes", () => {
  const body = { id: "resp-1", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }], usage: { input_tokens: 2, output_tokens: 3 } };
  const events = decodeGatewayResponse("responses", body);
  assert.equal(events.some((event) => event.type === "text_delta" && event.text === "hello"), true);
  for (const protocol of ["responses", "chat_completions", "anthropic", "gemini"] as const) {
    assert.ok(encodeGatewayResponse(protocol, events));
  }
});

test("public response IR retains Responses item locations and encrypted reasoning", () => {
  const events = decodeGatewayResponse("responses", {
    id: "r-lifecycle",
    output: [
      { id: "rs-1", type: "reasoning", encrypted_content: "enc", summary: [{ type: "summary_text", text: "plan" }] },
      { id: "msg-1", type: "message", content: [{ type: "output_text", text: "answer" }] },
      { id: "fc-1", type: "function_call", call_id: "call-1", name: "lookup", arguments: "{}" },
    ],
  });
  const reasoning = events.find((event): event is Extract<typeof event, { type: "reasoning_delta" }> => event.type === "reasoning_delta" && Boolean(event.encryptedContent));
  assert.deepEqual(reasoning && { itemId: reasoning.itemId, outputIndex: reasoning.outputIndex, encryptedContent: reasoning.encryptedContent }, { itemId: "rs-1", outputIndex: undefined, encryptedContent: "enc" });
  const call = events.find((event) => event.type === "tool_call_delta");
  assert.deepEqual(call && { itemId: call.itemId, outputIndex: call.outputIndex }, { itemId: "fc-1", outputIndex: undefined });
  const encoded = encodeGatewayResponse("responses", events);
  assert.equal(JSON.stringify(encoded).includes('"encrypted_content":"enc"'), true);
});

test("stream lifecycle frames do not synthesize terminal events", () => {
  const created = decodeGatewayResponse("responses", { type: "response.created", response: { id: "r", status: "in_progress" } });
  assert.equal(created.some((event) => event.type === "message_end"), false);
  const chunk = decodeGatewayResponse("chat_completions", { id: "c", choices: [{ delta: { content: "hi" }, finish_reason: null }] });
  assert.equal(chunk.some((event) => event.type === "message_end"), false);
});

test("the full protocol matrix preserves images, reasoning, tools, tool calls, usage and cache counters", () => {
  const requests = {
    responses: {
      model: "logical",
      instructions: "follow the rules",
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image.png" }] }],
      reasoning: { effort: "high" },
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }],
      stream: true,
    },
    chat_completions: {
      model: "logical",
      messages: [{ role: "system", content: "follow the rules" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }],
      reasoning: { effort: "high" },
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }],
      stream: true,
    },
    anthropic: {
      model: "logical",
      system: "follow the rules",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
      thinking: { type: "enabled", budget_tokens: 512 },
      tools: [{ name: "search", description: "Search", input_schema: { type: "object" } }],
      stream: true,
    },
    gemini: {
      model: "logical",
      systemInstruction: { parts: [{ text: "follow the rules" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "abc" } }] }],
      tools: [{ functionDeclarations: [{ name: "search", description: "Search", parameters: { type: "object" } }] }],
    },
  } as const;

  for (const source of Object.keys(requests) as Array<keyof typeof requests>) {
    const request = decodeGatewayRequest(source, requests[source] as unknown as JsonObject, { ...context, protocol: source });
    assert.equal(request.messages.some((message) => message.role === "system"), true, source);
    assert.equal(request.messages.flatMap((message) => message.parts).some((part) => part.type === "image"), true, source);
    assert.equal(request.tools[0]?.name, "search", source);
    for (const target of Object.keys(requests) as Array<keyof typeof requests>) {
      const encoded = encodeGatewayRequest(target, request, "upstream");
      assert.equal(encoded.model, "upstream", source + "->" + target);
      assert.ok(JSON.stringify(encoded).includes("search"), source + "->" + target);
      assert.ok(JSON.stringify(encoded).includes("hello"), source + "->" + target);
    }
  }

  const responseBodies = {
    responses: { id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }, { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] }, { type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }], usage: { input_tokens: 4, output_tokens: 3, reasoning_tokens: 2, cached_tokens: 1 } },
    chat_completions: { id: "c", choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "think", tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 4, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 } } },
    anthropic: { id: "a", content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "hello" }, { type: "tool_use", id: "call-1", name: "search", input: { q: "hello" } }], usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1 } },
    gemini: { candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "hello" }, { functionCall: { name: "search", args: { q: "hello" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 2 } },
  } as const;

  for (const source of Object.keys(responseBodies) as Array<keyof typeof responseBodies>) {
    const events = decodeGatewayResponse(source, responseBodies[source] as unknown as JsonObject);
    assert.equal(events.some((event) => event.type === "tool_call_delta"), true, source);
    assert.equal(events.some((event) => event.type === "reasoning_delta"), true, source);
    assert.equal(events.some((event) => event.type === "usage"), true, source);
    for (const target of Object.keys(responseBodies) as Array<keyof typeof responseBodies>) {
      const encoded = encodeGatewayResponse(target, events);
      assert.ok(encoded, source + "->" + target);
      assert.ok(JSON.stringify(encoded).includes("hello"), source + "->" + target);
    }
  }
});
