import assert from "node:assert/strict";
import test from "node:test";

import { isPointInsideHoverMenu } from "./hover-menu-intent";

const trigger = { left: 10, right: 110, top: 10, bottom: 46 };
const content = { left: 10, right: 180, top: 52, bottom: 180 };

test("hover menu stays open while the pointer is inside either trigger or content", () => {
  assert.equal(isPointInsideHoverMenu({ x: 50, y: 30 }, trigger, content), true);
  assert.equal(isPointInsideHoverMenu({ x: 50, y: 90 }, trigger, content), true);
});

test("hover menu tolerates the small travel gap between trigger and content", () => {
  assert.equal(isPointInsideHoverMenu({ x: 50, y: 49 }, trigger, content, 8), true);
});

test("hover menu closes after the pointer leaves both regions", () => {
  assert.equal(isPointInsideHoverMenu({ x: 240, y: 200 }, trigger, content), false);
});
