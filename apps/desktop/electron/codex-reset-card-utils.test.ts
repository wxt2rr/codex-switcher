import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalAccountKey,
  decodeJwtPayload,
  extractSubscriptionCredentials,
  safeCardId,
} from "./codex-reset-card-utils.js";

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("canonical subscription identity prefers account and workspace claims", () => {
  assert.equal(
    canonicalAccountKey({ providerId: "OpenAI", accountId: "Acct-1", workspaceId: "Team-1" }),
    "openai:acct-1:team-1",
  );
  assert.equal(
    canonicalAccountKey({ providerId: "openai", accountId: "Acct-1", workspaceId: "Team-2" }),
    "openai:acct-1:team-2",
  );
});

test("canonical identity falls back to a stable token hash without storing the token", () => {
  const first = canonicalAccountKey({ accessToken: "same-secret" });
  const second = canonicalAccountKey({ accessToken: "same-secret" });
  assert.equal(first, second);
  assert.match(first, /^codex-subscription:token-[a-f0-9]{24}$/);
  assert.doesNotMatch(first, /same-secret/);
  assert.equal(safeCardId("opaque-credit-id"), safeCardId("opaque-credit-id"));
});

test("subscription credentials extract nested claims and tolerate string token stores", () => {
  const accessToken = jwt({
    email: "user@example.test",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-claim",
      chatgpt_workspace_id: "workspace-claim",
      chatgpt_plan_type: "plus",
    },
  });
  const credentials = extractSubscriptionCredentials({
    tokens: JSON.stringify({ access_token: accessToken }),
  });
  assert.equal(credentials.accessToken, accessToken);
  assert.equal(credentials.accountId, "acct-claim");
  assert.equal(credentials.workspaceId, "workspace-claim");
  assert.equal(credentials.email, "user@example.test");
  assert.equal(credentials.plan, "plus");
  assert.deepEqual(decodeJwtPayload("not-a-jwt"), {});
});
