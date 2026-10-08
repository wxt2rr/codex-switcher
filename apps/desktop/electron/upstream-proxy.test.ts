import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUpstreamProxyUrl,
  resolveUpstreamProxy,
  shouldBypassUpstreamProxy,
} from "./upstream-proxy.js";

test("upstream proxy resolution prefers route, then global, then direct", () => {
  assert.deepEqual(
    resolveUpstreamProxy("https://api.example.com/v1", "http://127.0.0.1:9000", "http://127.0.0.1:8000"),
    { url: "http://127.0.0.1:9000", source: "route" },
  );
  assert.deepEqual(
    resolveUpstreamProxy("https://api.example.com/v1", undefined, "http://127.0.0.1:8000"),
    { url: "http://127.0.0.1:8000", source: "global" },
  );
  assert.deepEqual(resolveUpstreamProxy("https://api.example.com/v1"), { source: "direct" });
});

test("local and NO_PROXY targets bypass the proxy", () => {
  assert.equal(shouldBypassUpstreamProxy("http://127.0.0.1:17832/routes/a/responses"), true);
  assert.equal(shouldBypassUpstreamProxy("https://api.example.com/v1", "api.example.com"), true);
  assert.equal(shouldBypassUpstreamProxy("https://other.example.com/v1", "api.example.com"), false);
  assert.deepEqual(resolveUpstreamProxy("http://localhost:17832/health", undefined, "http://127.0.0.1:8000"), { source: "direct" });
});

test("HTTP, HTTPS, and SOCKS5 proxy URLs are normalized without embedded credentials", () => {
  assert.equal(normalizeUpstreamProxyUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  assert.equal(normalizeUpstreamProxyUrl("socks5://127.0.0.1:1080/"), "socks5://127.0.0.1:1080");
  assert.throws(() => normalizeUpstreamProxyUrl("http://user:pass@127.0.0.1:8000"), /without embedded credentials/);
});
