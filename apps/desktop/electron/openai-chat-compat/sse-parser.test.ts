import test from "node:test";
import assert from "node:assert/strict";

import { SseParser } from "./sse-parser.js";

const source = ": keepalive\r\nevent: message\r\ndata: {\"text\":\"你好\"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]\n\n";
const expected = [
  { event: "message", data: "{\"text\":\"你好\"}" },
  { data: "first\nsecond" },
  { data: "[DONE]" },
];

function parse(chunks: Uint8Array[]) {
  const parser = new SseParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()];
}

test("SSE parser is invariant across arbitrary UTF-8 chunk boundaries", () => {
  const bytes = new TextEncoder().encode(source);
  assert.deepEqual(parse([bytes]), expected);
  assert.deepEqual(parse([...bytes].map((byte) => Uint8Array.of(byte))), expected);
  for (let split = 1; split < bytes.length; split += 1) {
    assert.deepEqual(parse([bytes.slice(0, split), bytes.slice(split)]), expected);
  }
});

test("SSE parser rejects an incomplete final event", () => {
  const parser = new SseParser();
  parser.push(new TextEncoder().encode("data: {\"partial\":"));
  assert.throws(() => parser.finish(), /incomplete event/);
});
