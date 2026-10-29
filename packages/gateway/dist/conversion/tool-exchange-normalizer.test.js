import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCanonicalToolExchange } from "./tool-exchange-normalizer.js";
test("canonical orphan tool results preserve media as user content", () => {
    const result = normalizeCanonicalToolExchange([{
            role: "tool",
            parts: [{ type: "tool_result", value: { call_id: "missing", output: [{ type: "image_url", image_url: { url: "https://example.test/result.png" } }] } }],
        }]);
    assert.equal(result.messages[0]?.role, "user");
    assert.equal(result.messages[0]?.parts[0]?.type, "image");
    assert.equal(result.messages[0]?.parts[0]?.media?.url, "https://example.test/result.png");
    assert.equal(result.diagnostics[0]?.code, "orphan_tool_result");
});
test("splits parallel embedded tool results before strict pairing", () => {
    const result = normalizeCanonicalToolExchange([
        {
            role: "assistant",
            parts: [
                { type: "tool_use", value: { id: "a", name: "alpha", arguments: "{}" } },
                { type: "tool_use", value: { id: "b", name: "beta", arguments: "{}" } },
            ],
        },
        {
            role: "user",
            parts: [
                { type: "tool_result", value: { tool_use_id: "b", content: "B" } },
                { type: "tool_result", value: { tool_use_id: "a", content: "A" } },
            ],
        },
    ]);
    assert.deepEqual(result.messages.map((message) => message.role), ["assistant", "tool", "tool"]);
    assert.deepEqual(result.messages.slice(1).map((message) => (message.parts[0]?.value).tool_use_id), ["a", "b"]);
    assert.equal(result.diagnostics.length, 0);
});
//# sourceMappingURL=tool-exchange-normalizer.test.js.map