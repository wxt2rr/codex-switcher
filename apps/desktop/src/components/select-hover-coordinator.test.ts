import test from "node:test";
import assert from "node:assert/strict";

import { SelectHoverCoordinator } from "./select-hover-coordinator";

test("select hover coordinator keeps a single active owner", () => {
  const coordinator = new SelectHoverCoordinator();
  const events: string[] = [];

  coordinator.register("first", {
    cancelPendingOpen: () => events.push("cancel:first"),
    close: () => events.push("close:first"),
  });
  coordinator.register("second", {
    cancelPendingOpen: () => events.push("cancel:second"),
    close: () => events.push("close:second"),
  });

  coordinator.activate("first");
  assert.equal(coordinator.getActiveId(), "first");
  coordinator.activate("second");
  assert.equal(coordinator.getActiveId(), "second");
  assert.deepEqual(events, ["cancel:second", "close:second", "cancel:first", "close:first"]);
});

test("unregistering the active select releases ownership", () => {
  const coordinator = new SelectHoverCoordinator();
  coordinator.register("first", { cancelPendingOpen() {}, close() {} });

  coordinator.activate("first");
  coordinator.unregister("first");

  assert.equal(coordinator.getActiveId(), null);
});
