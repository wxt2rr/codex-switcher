import test from "node:test";
import assert from "node:assert/strict";

import { detectPlatform, isWindowsPlatform } from "./os.js";

test("detectPlatform maps Node platforms to switcher platform ids", () => {
  assert.equal(detectPlatform("win32"), "windows");
  assert.equal(detectPlatform("darwin"), "macos");
  assert.equal(detectPlatform("linux"), "linux");
  assert.equal(detectPlatform("freebsd"), "unknown");
});

test("isWindowsPlatform only returns true for win32", () => {
  assert.equal(isWindowsPlatform("win32"), true);
  assert.equal(isWindowsPlatform("darwin"), false);
  assert.equal(isWindowsPlatform("linux"), false);
});
