import assert from "node:assert/strict";
import test from "node:test";

import { normalizeKey } from "./terminal.js";

test("normalizeKey maps arrows, enter, digits, and quit keys", () => {
  assert.equal(normalizeKey({ name: "up" }), "up");
  assert.equal(normalizeKey({ name: "down" }), "down");
  assert.equal(normalizeKey({ name: "return" }), "enter");
  assert.equal(normalizeKey({ name: "backspace" }), "backspace");
  assert.equal(normalizeKey({ name: "q", sequence: "q" }), "quit");
  assert.equal(normalizeKey({ sequence: "5" }), "digit:5");
  assert.equal(normalizeKey({ sequence: "x" }), "char:x");
  assert.equal(normalizeKey({ ctrl: true, name: "c" }), "quit");
});
