import assert from "node:assert/strict";
import test from "node:test";

import {
  closeUpstreamProxyAgents,
  fetchWithOptionalProxy,
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

test("proxy dispatch removes a caller-supplied content length", async () => {
  let received: RequestInit | undefined;
  try {
    const response = await fetchWithOptionalProxy(
      "https://api.example.com/v1/responses",
      {
        method: "POST",
        headers: {
          "content-type": "application/json", "content-length": "999", connection: "Upgrade", upgrade: "h2c",
          "http2-settings": "AAMAAABkAAQCAAAAAA==",
        },
        body: JSON.stringify({ model: "demo", input: [] }),
      },
      "http://127.0.0.1:7899",
      async (_url, init) => {
        received = init;
        return new Response("ok", { status: 200 });
      },
    );
    assert.equal(response.status, 200);
    assert.equal(new Headers(received?.headers).has("content-length"), false);
    assert.equal(new Headers(received?.headers).has("upgrade"), false);
    assert.equal(new Headers(received?.headers).has("http2-settings"), false);
  } finally {
    await closeUpstreamProxyAgents();
  }
});
