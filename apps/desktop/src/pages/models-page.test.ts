import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./models-page.tsx", import.meta.url), "utf8");

test("models page keeps model editing while account exposure remains read-only", () => {
  assert.match(source, /<SidePanel[\s\S]*editorOpen/);
  assert.match(source, /<ConfirmDialog/);
  assert.doesNotMatch(source, /bindingOpen/);
  assert.doesNotMatch(source, /setModelAccountBindings/);
  assert.match(source, /AccountSourceSummary/);
  assert.match(source, /发现来源/);
  assert.match(source, /账号暴露/);
  assert.match(source, /grid-cols-1/);
  assert.match(source, /providerFilter/);
  assert.match(source, /<Select/);
  assert.doesNotMatch(source, /<select[\s>]/);
});

test("model form keeps only core fields and JSON uses full catalog helpers", () => {
  assert.match(source, /serializeSingleModelCatalog/);
  assert.match(source, /parseSingleModelCatalog/);
  assert.doesNotMatch(source, /label=\{zh \? "描述"/);
});
