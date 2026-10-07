import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptResponsesRequest,
  adaptProtocolRequest,
  adaptProtocolResponse,
  adaptProtocolSseChunk,
  applyProtocolCredentialHeaders,
  detectGatewayProtocol,
  extractProtocolModel,
} from "./protocol-adapters.js";

test("detects gateway wire protocols from endpoint suffixes", () => {
  assert.equal(detectGatewayProtocol("responses"), "responses");
  assert.equal(detectGatewayProtocol("chat/completions"), "chat_completions");
  assert.equal(detectGatewayProtocol("messages"), "anthropic");
  assert.equal(detectGatewayProtocol("v1beta/models/gemini-2.5:generateContent"), "gemini");
});

test("extracts Anthropic and Gemini model identifiers", () => {
  assert.equal(extractProtocolModel("anthropic", "messages", { model: "claude-sonnet" }), "claude-sonnet");
  assert.equal(extractProtocolModel("gemini", "v1beta/models/gemini-2.5:generateContent"), "gemini-2.5");
});

test("uses provider-specific credential headers", () => {
  const anthropic = applyProtocolCredentialHeaders(new Headers({ authorization: "Bearer stale" }), "anthropic", { upstreamApiKey: "sk-ant" });
  assert.equal(anthropic.get("x-api-key"), "sk-ant");
  assert.equal(anthropic.get("anthropic-version"), "2023-06-01");
  assert.equal(anthropic.get("authorization"), null);

  const gemini = applyProtocolCredentialHeaders(new Headers(), "gemini", { upstreamApiKey: "g-key" });
  assert.equal(gemini.get("x-goog-api-key"), "g-key");
});

test("adapts a normalized Responses request to Anthropic and Gemini payloads", () => {
  const body = { model: "source", input: "hello", instructions: "be concise", max_output_tokens: 32, stream: true };
  assert.deepEqual(adaptResponsesRequest("anthropic", body, "claude-sonnet"), {
    model: "claude-sonnet", system: "be concise", messages: [{ role: "user", content: "hello" }],
    max_tokens: 32, stream: true,
  });
  assert.deepEqual(adaptResponsesRequest("gemini", body, "gemini-2.5"), {
    contents: [{ role: "user", parts: [{ text: "hello" }] }], model: "gemini-2.5",
    systemInstruction: { parts: [{ text: "be concise" }] }, generationConfig: { maxOutputTokens: 32 },
  });
});

test("converts every ingress protocol to every upstream protocol", () => {
  const inputs = {
    responses: { model: "m", input: "hello", stream: true },
    chat_completions: { model: "m", messages: [{ role: "user", content: "hello" }], stream: true },
    anthropic: { model: "m", system: "rules", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], stream: true },
    gemini: { model: "m", contents: [{ role: "user", parts: [{ text: "hello" }] }] },
  } as const;
  for (const source of Object.keys(inputs) as Array<keyof typeof inputs>) {
    for (const target of Object.keys(inputs) as Array<keyof typeof inputs>) {
      const converted = adaptProtocolRequest(source, target, inputs[source], "upstream");
      assert.equal(converted.model, "upstream");
      assert.ok(JSON.stringify(converted).includes("hello"));
    }
  }
});

test("converts JSON and SSE responses back to the client protocol", () => {
  const upstream = { id: "r", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 2, output_tokens: 3 } };
  const anthropic = adaptProtocolResponse("anthropic", "responses", upstream);
  assert.equal(anthropic.output && Array.isArray(anthropic.output), true);
  const chat = adaptProtocolResponse("anthropic", "chat_completions", upstream);
  assert.equal((chat.choices as Array<{ message: { content: string } }>)[0]?.message.content, "hello");
  const stream = adaptProtocolSseChunk("anthropic", "responses", `data: ${JSON.stringify(upstream)}\n\ndata: [DONE]\n`);
  assert.match(stream, /output/);
  assert.match(stream, /\[DONE\]/);
});
