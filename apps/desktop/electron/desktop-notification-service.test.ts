import assert from "node:assert/strict";
import { test } from "node:test";

import { DesktopNotificationService, type DesktopNotificationWindow } from "./desktop-notification-service.js";

test("native notification delivery reports support and focuses the account on click", () => {
  let shown = 0;
  let clicked: (() => void) | undefined;
  const sent: unknown[] = [];
  const window: DesktopNotificationWindow = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => undefined,
    show: () => undefined,
    focus: () => undefined,
    webContents: { send: (_channel, payload) => sent.push(payload) },
  };
  class FakeNotification {
    static isSupported() { return true; }
    constructor(public readonly options: { title: string; body?: string }) { /* no-op */ }
    on(_event: "click", listener: () => void) { clicked = listener; return this; }
    show() { shown += 1; }
  }
  const service = new DesktopNotificationService({ getWindow: () => window, notification: FakeNotification });
  service.setEnabled(true);
  assert.deepEqual(service.getStatus(), { supported: true, permission: "not-required", enabled: true });
  assert.deepEqual(service.notify({ title: "Test", body: "Safe", accountKey: "acct", envName: "default", accountName: "plus" }), { delivered: true, fallback: false });
  clicked?.();
  assert.equal(shown, 1);
  assert.deepEqual(sent, [{ accountKey: "acct", envName: "default", accountName: "plus" }]);
});

test("unsupported native notifications degrade to the renderer fallback", () => {
  const notices: unknown[] = [];
  class UnsupportedNotification {
    static isSupported() { return false; }
    constructor(_options: { title: string; body?: string; silent?: boolean }) { /* no-op */ }
    on() { return this; }
    show() { /* no-op */ }
  }
  const window: DesktopNotificationWindow = {
    isDestroyed: () => false, isMinimized: () => false, restore: () => undefined,
    show: () => undefined, focus: () => undefined, webContents: { send: (_channel, payload) => notices.push(payload) },
  };
  const service = new DesktopNotificationService({ getWindow: () => window, notification: UnsupportedNotification, onFallback: (input) => notices.push(input) });
  service.setEnabled(true);
  assert.deepEqual(service.notify({ title: "Fallback", body: "body" }), { delivered: false, fallback: true });
  assert.equal(notices.length, 2);
});
