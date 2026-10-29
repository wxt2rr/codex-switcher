import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMoonshotChatTools, upstreamRequiresMoonshotSchema } from "./moonshot-schema.js";
test("Moonshot host detection is host-gated", () => {
    assert.equal(upstreamRequiresMoonshotSchema("https://api.moonshot.cn/v1"), true);
    assert.equal(upstreamRequiresMoonshotSchema("https://api.kimi.com/coding"), true);
    assert.equal(upstreamRequiresMoonshotSchema("https://api.openai.com/v1"), false);
});
test("Moonshot schema rewrite moves ref siblings into allOf recursively", () => {
    const body = {
        tools: [{ type: "function", function: { name: "demo", parameters: {
                        type: "object",
                        properties: { value: { $ref: "#/$defs/value", type: "string" } },
                        $defs: { value: { $ref: "#/$defs/base", description: "value" }, base: { type: "string" } },
                    } } }],
    };
    assert.equal(normalizeMoonshotChatTools(body), 2);
    const parameters = body.tools[0].function;
    const schema = parameters.parameters;
    assert.deepEqual(schema.properties.value, { type: "string", allOf: [{ $ref: "#/$defs/value" }] });
});
//# sourceMappingURL=moonshot-schema.test.js.map