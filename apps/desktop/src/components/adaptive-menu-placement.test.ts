import assert from "node:assert/strict";
import test from "node:test";

import { resolveAdaptiveMenuPlacement } from "./adaptive-menu-placement";

test("adaptive menu opens upward when the scroll viewport has insufficient space below", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 780, triggerBottom: 816, boundaryTop: 300, boundaryBottom: 860, menuHeight: 120 }), "up");
});

test("adaptive menu keeps opening downward when enough space remains below", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 420, triggerBottom: 456, boundaryTop: 300, boundaryBottom: 860, menuHeight: 120 }), "down");
});

test("adaptive menu prefers the side with more room when neither side fully fits", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 350, triggerBottom: 386, boundaryTop: 300, boundaryBottom: 430, menuHeight: 120 }), "up");
});
