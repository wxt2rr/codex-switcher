import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { GatewayDiagnosticsController } from "./gateway-diagnostics.js";

test("diagnostics captures linked request stages and redacts credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-diagnostics-"));
  const path = join(root, "gateway-diagnostics.jsonl");
  const controller = new GatewayDiagnosticsController(path);
  const status = controller.configure({ enabled: true, level: "full", maxRequests: 1, ttlMs: 60_000 });
  assert.equal(status.enabled, true);
  const capture = controller.begin({
    requestId: "req-1", traceId: "trace-1", gatewayId: "gw-1", envName: "test",
    method: "POST", path: "/gateways/gw-1/responses", ingressProtocol: "responses",
    requestedModel: "gpt-6.1-sol", routeId: "route-1", accountName: "ckt-aicode",
    providerId: "custom-openai", upstreamModel: "gpt-6.1-sol", upstreamProtocol: "responses",
    upstreamBaseUrl: "https://aicode.example.test", requestHeaders: { authorization: "Bearer secret", "x-request-id": "trace-1" },
  });
  assert.ok(capture);
  capture.recordIngressBody(Buffer.from(JSON.stringify({ model: "gpt-6.1-sol", input: [{ role: "user", content: "hi" }], api_key: "secret" })));
  capture.recordTransformedBody(Buffer.from(JSON.stringify({ model: "gpt-6.1-sol", input: [{ role: "user", content: "hi" }] })), "upstream_attempt_1");
  const upstream = new Response(JSON.stringify({ id: "resp-1", usage: { input_tokens: 169459, output_tokens: 80, total_tokens: 169539 } }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "up-1" },
  });
  capture.recordUpstreamResponse(upstream, "upstream_attempt_1");
  capture.recordFinalResponse({ status: 200, headers: upstream.headers, body: JSON.stringify({ id: "resp-1", usage: { input_tokens: 32134, output_tokens: 14 } }), usage: { model: "gpt-6.1-sol", inputTokens: 32134, outputTokens: 14, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 32148 } });
  await capture.finish({ outcome: "success" });

  const records = await controller.records({ requestId: "req-1" });
  assert.equal(records.length, 1);
  const record = records[0] as any;
  assert.equal(record.request.requestHeaders.authorization, "[REDACTED]");
  assert.equal(record.ingressBody.value.api_key, "[REDACTED]");
  assert.equal(record.upstreamResponses[0].usage.inputTokens, 169459);
  assert.equal(record.finalResponse.usage.inputTokens, 32134);
  const raw = await readFile(path, "utf8");
  assert.match(raw, /req-1/);
  assert.equal(controller.status().remainingRequests, 0);
  assert.equal(controller.begin({
    requestId: "req-2", traceId: "trace-2", gatewayId: "gw-1", envName: "test", method: "POST", path: "/responses",
    ingressProtocol: "responses", requestedModel: null, routeId: "route-1", accountName: "a", providerId: null,
    upstreamModel: null, upstreamProtocol: "responses", upstreamBaseUrl: "https://example.test",
  }), undefined);
});

test("diagnostics are disabled by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-diagnostics-"));
  const controller = new GatewayDiagnosticsController(join(root, "gateway-diagnostics.jsonl"));
  assert.equal(controller.status().enabled, false);
  assert.equal(controller.begin({
    requestId: "req", traceId: "trace", gatewayId: "gw", envName: "test", method: "POST", path: "/responses",
    ingressProtocol: "responses", requestedModel: null, routeId: "route", accountName: "a", providerId: null,
    upstreamModel: null, upstreamProtocol: "responses", upstreamBaseUrl: "https://example.test",
  }), undefined);
});
