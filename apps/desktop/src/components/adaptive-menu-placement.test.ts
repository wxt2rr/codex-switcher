import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isVerticalScrollBoundary,
  resolveAdaptiveMenuLayout,
  resolveAdaptiveMenuPlacement,
} from "./adaptive-menu-placement";

const source = readFileSync(new URL("./adaptive-menu-placement.ts", import.meta.url), "utf8");

test("only scrolling overflow modes create vertical menu boundaries", () => {
  assert.equal(isVerticalScrollBoundary("auto"), true);
  assert.equal(isVerticalScrollBoundary("scroll"), true);
  assert.equal(isVerticalScrollBoundary("hidden"), false);
  assert.equal(isVerticalScrollBoundary("clip"), false);
  assert.equal(isVerticalScrollBoundary("visible"), false);
});

test("adaptive menu opens upward when the scroll viewport has insufficient space below", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 780, triggerBottom: 816, boundaryTop: 300, boundaryBottom: 860, menuHeight: 120 }), "up");
});

test("adaptive menu keeps opening downward when enough space remains below", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 420, triggerBottom: 456, boundaryTop: 300, boundaryBottom: 860, menuHeight: 120 }), "down");
});

test("adaptive menu prefers the side with more room when neither side fully fits", () => {
  assert.equal(resolveAdaptiveMenuPlacement({ triggerTop: 350, triggerBottom: 386, boundaryTop: 300, boundaryBottom: 430, menuHeight: 120 }), "up");
});

test("adaptive menu reports the usable height on the selected side", () => {
  assert.deepEqual(
    resolveAdaptiveMenuLayout({ triggerTop: 350, triggerBottom: 386, boundaryTop: 300, boundaryBottom: 430, menuHeight: 120 }),
    { placement: "up", availableHeight: 34 },
  );
});

test("adaptive menu opens upward before it enters the viewport edge safety area", () => {
  assert.equal(resolveAdaptiveMenuPlacement({
    triggerTop: 116,
    triggerBottom: 152,
    boundaryTop: 0,
    boundaryBottom: 258,
    menuHeight: 91,
  }), "up");
});

test("adaptive menu keeps an 8px inset from its visible boundary by default", () => {
  assert.deepEqual(resolveAdaptiveMenuLayout({
    triggerTop: 116,
    triggerBottom: 152,
    boundaryTop: 0,
    boundaryBottom: 258,
    menuHeight: 84,
  }), { placement: "down", availableHeight: 90 });
});

test("adaptive menu remeasures after delayed content mounts and size changes", () => {
  assert.match(source, /Math\.max\(menu\.height, menuElement\.scrollHeight\)/);
  assert.match(source, /new ResizeObserver\(update\)/);
  assert.match(source, /resizeObserver\.observe\(root\)/);
  assert.match(source, /resizeObserver\.observe\(menuElement\)/);
  assert.match(source, /resizeObserver\.disconnect\(\)/);
  assert.doesNotMatch(source, /\}, \[open, rootRef, menuRef\]\);/);
});
