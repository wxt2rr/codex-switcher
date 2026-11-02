import assert from "node:assert/strict";
import { test } from "node:test";

import { CodexSubscriptionClient, CodexSubscriptionError } from "./codex-subscription-client.js";
import type { CodexSubscriptionAccount } from "./codex-reset-card-utils.js";

const account: CodexSubscriptionAccount = {
  accountKey: "codex:acct:workspace",
  envName: "default",
  accountName: "plus",
  authMode: "auth",
  preferredAuthMethod: "chatgpt",
  authFile: "/tmp/auth.json",
  homePath: "/tmp/codex",
  accountId: "acct-123",
  workspaceId: "workspace-1",
  accessToken: "secret-token",
};

test("subscription client reads usage windows and reset cards with account headers", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new CodexSubscriptionClient({
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      const payload = String(url).endsWith("/usage")
        ? { plan_type: "plus", rate_limit: { primary_window: { used_percent: 12, window_minutes: 300, resets_at: "2026-11-02T12:00:00Z" }, secondary_window: { used_percent: 75, window_minutes: 10080, resets_at: 1_800_000_000 } } }
        : { available_count: 2, credits: [
          { id: "credit-1", reset_type: "weekly", status: "available", granted_at: "2026-11-01T00:00:00Z", expires_at: "2026-11-02T18:00:00Z" },
          { id: "credit-2", reset_type: "five_hour", status: "consumed", granted_at: "2026-11-01T00:00:00Z", expires_at: null },
          { id: "credit-3", reset_type: "weekly", status: "available", granted_at: "2026-11-01T00:00:00Z", expires_at: null },
        ] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await client.readAccount(account);
  assert.equal(result.plan, "plus");
  assert.equal(result.usageWindows.length, 2);
  assert.equal(result.usageWindows[0]?.name, "five-hour");
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0]?.id, "card-2e160b8fb28e");
  assert.equal(result.cards[0]?.type, "weekly");
  assert.equal(result.cards[1]?.nonExpiring, true);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer secret-token");
    assert.equal(headers.get("chatgpt-account-id"), "acct-123");
    assert.equal(headers.get("chatgpt-workspace-id"), "workspace-1");
  }
});

test("subscription client uses the account proxy and redacts timeout errors", async () => {
  let proxy: string | undefined;
  const client = new CodexSubscriptionClient({
    fetchWithProxyImpl: async (_url, _init, proxyUrl) => {
      proxy = proxyUrl;
      throw new Error("Bearer secret-token: upstream unavailable");
    },
    fetchImpl: async () => {
      throw new Error("Bearer secret-token: upstream unavailable");
    },
  });
  const proxiedAccount = { ...account, proxyUrl: "http://127.0.0.1:7890" };
  await assert.rejects(client.readAccount(proxiedAccount), (error: unknown) => {
    assert.ok(error instanceof CodexSubscriptionError);
    assert.equal(error.kind, "network");
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
  assert.equal(proxy, "http://127.0.0.1:7890");
});

test("subscription client classifies empty error bodies by HTTP status", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [403, "unauthorized"], [404, "unsupported"], [429, "rate-limited"], [503, "api"]] as const) {
    const client = new CodexSubscriptionClient({
      fetchImpl: async () => new Response("", { status, headers: { "retry-after": "2" } }),
    });
    await assert.rejects(client.readAccount(account), (error: unknown) => error instanceof CodexSubscriptionError && error.kind === kind);
  }
});

test("subscription client sends idempotent consume payload", async () => {
  let body = "";
  const client = new CodexSubscriptionClient({
    fetchImpl: async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ code: "reset", windows_reset: 2 }), { status: 200 });
    },
  });
  const result = await client.consume(account, "credit-1", "redeem-123");
  assert.deepEqual(result, { code: "reset", windowsReset: 2 });
  assert.deepEqual(JSON.parse(body), { credit_id: "credit-1", redeem_request_id: "redeem-123" });
});

test("subscription client classifies private endpoint failures without leaking tokens", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [404, "unsupported"], [429, "rate-limited"], [503, "api"]] as const) {
    const client = new CodexSubscriptionClient({
      fetchImpl: async () => new Response(JSON.stringify({ error: "Bearer secret-token should not appear" }), { status, headers: { "retry-after": "2" } }),
    });
    await assert.rejects(client.readAccount(account), (error: unknown) => {
      assert.ok(error instanceof CodexSubscriptionError);
      assert.equal(error.kind, kind);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    });
  }
});

test("subscription client tolerates unknown expiry and malformed credit entries", async () => {
  const client = new CodexSubscriptionClient({
    fetchImpl: async (url) => new Response(JSON.stringify(String(url).endsWith("/usage")
      ? { rate_limits: { windows: [{ window_minutes: 60, used_percent: 0 }] } }
      : { credits: [
        { id: "unknown-expiry", reset_type: "vendor", status: "available", expires_at: "not-a-date" },
        { status: "available" },
        { id: "used", status: "consumed" },
      ] }), { status: 200 }),
  });
  const result = await client.readAccount(account);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.type, "unknown");
  assert.equal(result.cards[0]?.expiresAt, undefined);
  assert.equal(result.cards[0]?.nonExpiring, undefined);
});

test("subscription client reports unsupported payloads and invalid JSON distinctly", async () => {
  const unsupported = new CodexSubscriptionClient({ fetchImpl: async (url) => new Response(JSON.stringify(String(url).endsWith("/usage") ? {} : { message: "legacy endpoint" }), { status: 200 }) });
  await assert.rejects(unsupported.readAccount(account), (error: unknown) => error instanceof CodexSubscriptionError && error.kind === "unsupported");
  const malformed = new CodexSubscriptionClient({ fetchImpl: async () => new Response("not-json", { status: 200 }) });
  await assert.rejects(malformed.readAccount(account), (error: unknown) => error instanceof CodexSubscriptionError && error.kind === "parse");
});
