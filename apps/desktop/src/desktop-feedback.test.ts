import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDesktopActionItems,
  buildDesktopNotice,
  formatCompletedActionLabel,
  formatDesktopValidationMessage,
  formatOperationCompletedMessage,
} from "./desktop-feedback.js";

test("formatCompletedActionLabel maps known operation labels", () => {
  assert.equal(formatCompletedActionLabel("zh", "ops", "proxy", ["test"]), "代理测试");
  assert.equal(formatCompletedActionLabel("en", "ops", "token-refresh", ["run-once"]), "Token Refresh");
  assert.equal(formatCompletedActionLabel("ja", "log", "switcher", []), "switcher ログ");
});

test("buildDesktopActionItems exposes only modern desktop tools", () => {
  const items = buildDesktopActionItems("en");
  const zhItems = buildDesktopActionItems("zh");
  const jaItems = buildDesktopActionItems("ja");

  assert.deepEqual(
    items.map((item) => item.id),
    ["refresh", "switcher-log", "token-refresh-log", "launch-cli"],
  );
  assert.equal(items[0]?.label, "Reload Data");
  assert.equal(items[0]?.group, "data");
  assert.equal(items[2]?.group, "logs");
  assert.equal(items[3]?.label, "Open CLI Session");
  assert.equal(zhItems[3]?.label, "打开 CLI 会话");
  assert.equal(jaItems[3]?.label, "CLI セッションを開く");
});

test("desktop feedback formats validation and success messages", () => {
  assert.equal(formatDesktopValidationMessage("zh", "env-name-required"), "必须填写环境名");
  assert.equal(formatDesktopValidationMessage("en", "runtime-requires-input"), "Runtime update requires env and account");
  assert.equal(
    formatOperationCompletedMessage("ja", "switcher ログ"),
    "switcher ログ が完了しました",
  );
});

test("desktop notices expose tone and localized text", () => {
  const success = buildDesktopNotice("en", "success", "Reload Data");
  const validation = buildDesktopNotice("zh", "validation", "env-name-required");
  const failure = buildDesktopNotice("ja", "error", "bridge unavailable");

  assert.deepEqual(success, { tone: "success", text: "Reload Data completed" });
  assert.deepEqual(validation, { tone: "warning", text: "必须填写环境名" });
  assert.deepEqual(failure, { tone: "error", text: "bridge unavailable" });
});
