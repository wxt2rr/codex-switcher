import assert from "node:assert/strict";
import test from "node:test";
import { conversionMatrix, planConversion } from "./formats.js";
test("conversion matrix covers every directed protocol pair", () => {
    const matrix = conversionMatrix();
    assert.equal(matrix.length, 16);
    assert.equal(new Set(matrix.map((item) => `${item.from}->${item.to}`)).size, 16);
});
test("protocol path quality and pivot steps are deterministic", () => {
    assert.equal(planConversion("responses", "chat_completions").quality, "good");
    assert.equal(planConversion("chat_completions", "anthropic").quality, "fair");
    assert.equal(planConversion("anthropic", "gemini").quality, "discouraged");
    assert.deepEqual(planConversion("anthropic", "gemini").steps.map((step) => step.id), [
        "anthropic-to-chat",
        "chat-to-gemini",
    ]);
});
//# sourceMappingURL=formats.test.js.map