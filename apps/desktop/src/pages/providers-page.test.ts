import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./providers-page.tsx", import.meta.url), "utf8");

test("providers page exposes the complete provider catalog and unified account entry", () => {
  assert.match(source, /listProviderCatalog/);
  assert.match(source, /onAddAccount/);
  assert.match(source, /自动发现模型|Model discovery/);
  assert.match(source, /ProviderIcon/);
  assert.match(source, /Codex: Responses/);
  assert.match(source, /Responses 自动转换|Responses conversion/);
  assert.match(source, /上游协议|Provider upstream/);
});

test("provider page is a static directory with connection details", () => {
  assert.match(source, /Codex 统一使用 Responses|Codex uses Responses/);
  assert.match(source, /已连接的环境账号|Connected environment accounts/);
  assert.match(source, /凭据、环境账号和模型暴露始终通过账号页管理|Manage credentials, environment accounts, and model exposure through Accounts/);
  assert.doesNotMatch(source, /importProviderCredential/);
});

test("provider page clearly routes account creation to the Accounts page", () => {
  assert.match(source, /添加账号|Add account/);
  assert.match(source, /在账号页添加账号|Add account in Accounts/);
  assert.match(source, /onAddAccount\(activeProvider\.id\)/);
});
