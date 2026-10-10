import assert from "node:assert/strict";
import test from "node:test";
import { convertGatewayRequest } from "./request-converter.js";
import { convertGatewayResponse, decodeResponseEvents } from "./response-converter.js";
import { GOLDEN_PROTOCOLS, GOLDEN_REQUESTS, GOLDEN_RESPONSES } from "./golden-fixtures.js";

test("golden request matrix preserves the shared semantic contract", async () => {
  for (const source of GOLDEN_PROTOCOLS) {
    for (const target of GOLDEN_PROTOCOLS) {
      const result = await convertGatewayRequest(source, target, GOLDEN_REQUESTS[source], { originModelName: "logical-model", upstreamModelName: "upstream-model" });
      assert.equal(result.value.model, "upstream-model", `${source}->${target} model`);
      assert.equal(JSON.stringify(result.value).includes("hello"), true, `${source}->${target} text`);
      assert.equal(JSON.stringify(result.value).includes("search"), true, `${source}->${target} tool`);
      assert.equal(result.quality === "good" || result.quality === "fair" || result.quality === "discouraged", true);
    }
  }
});

test("golden response matrix preserves text, reasoning, tools and usage", async () => {
  for (const source of GOLDEN_PROTOCOLS) {
    const events = decodeResponseEvents(source, GOLDEN_RESPONSES[source]);
    assert.equal(events.some((event) => event.type === "text_delta" && event.text === "hello"), true, `${source} text`);
    assert.equal(events.some((event) => event.type === "reasoning_delta" && event.text === "think"), true, `${source} reasoning`);
    assert.equal(events.some((event) => event.type === "tool_call_delta" && event.name === "search"), true, `${source} tool`);
    for (const target of GOLDEN_PROTOCOLS) {
      const result = await convertGatewayResponse(source, target, GOLDEN_RESPONSES[source], { originModelName: "logical-model", upstreamModelName: "upstream-model" });
      const serialized = JSON.stringify(result.value);
      assert.equal(serialized.includes("hello"), true, `${source}->${target} text`);
      assert.equal(serialized.includes("search"), true, `${source}->${target} tool`);
      assert.equal(serialized.includes("input_tokens") || serialized.includes("prompt_tokens") || serialized.includes("promptTokenCount"), true, `${source}->${target} usage`);
    }
  }
});

