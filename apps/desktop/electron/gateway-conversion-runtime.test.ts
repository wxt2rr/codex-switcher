import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { useLegacyProtocolConversion } from "./gateway-conversion-runtime.js";

test("shared gateway conversion is the only runtime conversion path", () => {
  assert.equal(useLegacyProtocolConversion({}), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "0" }), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "1" }), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "true" }), false);
  assert.equal(useLegacyProtocolConversion({ CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION: "yes" }), false);
});

test("production compatibility entry points do not import legacy transformers", async () => {
  const projectRoot = process.cwd().endsWith(join("apps", "desktop"))
    ? join(process.cwd(), "../..")
    : process.cwd();
  const root = join(projectRoot, "apps", "desktop", "electron");
  const files = [
    join(root, "usage-router-service.ts"),
    join(root, "openai-chat-compat", "compatibility-handler.ts"),
    join(root, "gateway-conversion-runtime.ts"),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.equal(/from\s+["']\.\/?openai-chat-compat\/(?:request|response|stream)-transformer/.test(source), false);
  assert.equal(/from\s+["']\.\/(?:request|response|stream)-transformer/.test(source), false);
});
