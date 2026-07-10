import test from "node:test";
import assert from "node:assert/strict";

import { buildDesktopViewSections } from "./view-model.js";

test("home view keeps only status and quick actions", () => {
  const sections = buildDesktopViewSections("overview");

  assert.deepEqual(sections.map((section) => section.id), ["status", "quick-switch", "recent"]);
});
