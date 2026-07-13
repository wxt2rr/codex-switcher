import test from "node:test";
import assert from "node:assert/strict";

import { normalizeChatUsage, responseEnvelope, responseEvent, serializeResponseEvent } from "./responses-events.js";

test("Responses event helpers serialize stable lifecycle payloads and usage", () => {
  const usage = normalizeChatUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14,
    prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } });
  const response = responseEnvelope("resp_1", "model", "completed", [{ type: "message" }], usage);
  const event = responseEvent("response.completed", { response });
  const text = new TextDecoder().decode(serializeResponseEvent(event));
  assert.match(text, /^event: response\.completed\ndata:/);
  assert.equal((response.usage as typeof usage).output_tokens_details.reasoning_tokens, 2);
});
