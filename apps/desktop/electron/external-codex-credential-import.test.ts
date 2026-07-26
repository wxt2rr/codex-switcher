import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexChatGptAuthJson,
  buildImportedAccountNames,
  parseExternalCodexCredentials,
} from "./external-codex-credential-import.js";

test("Sub2API import accepts nested official token aliases", () => {
  const [credential] = parseExternalCodexCredentials(JSON.stringify({
    tokens: {
      accessToken: "access-token",
      refresh_token: "refresh-token",
      idToken: "id-token",
      account_id: "account-id",
    },
    user: { email: "user@example.com" },
  }), "sub2api");

  assert.deepEqual(credential, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "id-token",
    accountId: "account-id",
    email: "user@example.com",
    lastRefresh: undefined,
    name: undefined,
  });
});

test("Sub2API import accepts wrappers, line-delimited JSON, and raw access tokens", () => {
  const credentials = parseExternalCodexCredentials(JSON.stringify({
    contents: [
      "{\"access_token\":\"first\"}",
      "{\"accessToken\":\"second\"}\nthird",
    ],
  }), "sub2api");

  assert.deepEqual(credentials.map((credential) => credential.accessToken), ["first", "second", "third"]);
});

test("CPA import accepts the official flat Codex object and arrays", () => {
  const credentials = parseExternalCodexCredentials(JSON.stringify([
    {
      type: "codex",
      access_token: "first-access",
      refresh_token: "first-refresh",
      id_token: "first-id",
      account_id: "first-account",
      last_refresh: "2026-07-26T10:00:00Z",
      email: "first@example.com",
    },
    {
      access_token: "second-access",
    },
  ]), "cpa");

  assert.equal(credentials.length, 2);
  assert.deepEqual(credentials[0], {
    accessToken: "first-access",
    refreshToken: "first-refresh",
    idToken: "first-id",
    accountId: "first-account",
    lastRefresh: "2026-07-26T10:00:00Z",
    email: "first@example.com",
    name: undefined,
  });
  assert.equal(credentials[1]?.accessToken, "second-access");
});

test("CPA import rejects non-Codex types and never includes secret values in errors", () => {
  const secret = "secret-access-token";
  assert.throws(
    () => parseExternalCodexCredentials(JSON.stringify({ type: "claude", access_token: secret }), "cpa"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /CPA import: item 1 is not a Codex credential/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("a malformed Sub2API batch fails before returning any credentials", () => {
  assert.throws(
    () => parseExternalCodexCredentials(JSON.stringify([
      { access_token: "valid-secret" },
      { id_token: "missing-access-secret" },
    ]), "sub2api"),
    /Sub2API import: item 2 is missing access_token/,
  );
});

test("Codex auth conversion nests all token fields and supplies last_refresh", () => {
  assert.deepEqual(
    buildCodexChatGptAuthJson({
      accessToken: "access",
      idToken: "id",
      refreshToken: "refresh",
      accountId: "account",
      lastRefresh: "not-a-date",
    }, new Date("2026-07-26T12:00:00.000Z")),
    {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: "access",
        id_token: "id",
        refresh_token: "refresh",
        account_id: "account",
      },
      last_refresh: "2026-07-26T12:00:00.000Z",
    },
  );
});

test("batch account names are deterministic and unique", () => {
  assert.deepEqual(buildImportedAccountNames("team", 3), ["team", "team-2", "team-3"]);
});
