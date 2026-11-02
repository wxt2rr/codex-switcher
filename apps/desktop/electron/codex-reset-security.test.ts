import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("reset-card consumption has no external Gateway/Agent HTTP route", async () => {
  const source = await readFile(join(process.cwd(), "electron", "usage-router-service.ts"), "utf8");
  assert.doesNotMatch(source, /consumeResetCard|rate-limit-reset-credits\/consume/);
  assert.match(source, /localAgentAccess/);
});

test("renderer bridge exposes confirmation as an explicit input", async () => {
  const source = await readFile(join(process.cwd(), "electron", "preload.ts"), "utf8");
  assert.match(source, /consumeResetCard: \(accountKey: string, cardId\?: string, confirmed = false\)/);
});
