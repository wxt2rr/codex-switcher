import assert from "node:assert/strict";
import test from "node:test";

import { providerIconMeta, providerIconUrls } from "./provider-icon.js";

test("provider icons have stable local metadata and a safe fallback", () => {
  assert.equal(providerIconMeta("openai").label, "◎");
  assert.equal(providerIconMeta("anthropic").label, "A");
  assert.equal(providerIconMeta("unknown-provider").label, "UNKNOWN-PROVIDER".slice(0, 2));
});

test("known providers use the official LobeHub static icon CDNs", () => {
  const urls = providerIconUrls("siliconflow");
  assert.equal(urls.length, 2);
  assert.match(urls[0], /icons-static-svg@latest\/icons\/siliconcloud\.svg$/);
  assert.match(urls[1], /registry\.npmmirror\.com\/.*\/files\/icons\/siliconcloud\.svg$/);
  assert.deepEqual(providerIconUrls("custom"), []);
});
