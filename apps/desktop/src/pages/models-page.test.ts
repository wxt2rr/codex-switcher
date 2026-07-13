import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./models-page.tsx", import.meta.url), "utf8");

test("models page is list-first with separate edit and binding panels", () => {
  assert.match(source, /<SidePanel[\s\S]*editorOpen/);
  assert.match(source, /<SidePanel[\s\S]*bindingOpen/);
  assert.match(source, /<ConfirmDialog/);
  assert.match(source, /setBindingDraft/);
  assert.match(source, /saveBindings/);
});

test("model form keeps only core fields and JSON uses full catalog helpers", () => {
  assert.match(source, /serializeSingleModelCatalog/);
  assert.match(source, /parseSingleModelCatalog/);
  assert.doesNotMatch(source, /label=\{zh \? "描述"/);
});
