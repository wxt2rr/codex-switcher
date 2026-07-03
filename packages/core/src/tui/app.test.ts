import assert from "node:assert/strict";
import test from "node:test";

import { APP_PAGE_ACTIONS, renderAppScreen } from "./app.js";

test("renderAppScreen shows current app target and available actions", () => {
  const output = renderAppScreen({
    status: {
      currentEnv: "project",
      currentAccount: "work",
      launcher: "wt",
      instances: [
        { instanceId: "instance-2", pid: 5555, isLatest: true },
        { instanceId: "instance-1", pid: 4444, isLatest: false },
      ],
    },
    selected: 1,
    message: "Managed app is running",
  });

  assert.match(output, /codex-sw-node - App/);
  assert.match(output, /Current: project\/work/);
  assert.match(output, /Launcher: wt/);
  assert.match(output, /Managed app is running/);
  assert.match(output, /Managed instances:/);
  assert.match(output, /instance-2 \(pid=5555\) \[latest\]/);
  assert.match(output, /instance-1 \(pid=4444\)/);
  assert.match(output, /> Launch New/);
  assert.match(output, /Stop Managed/);
  assert.equal(APP_PAGE_ACTIONS.length, 3);
});
