import assert from "node:assert/strict";
import test from "node:test";

import { createTaskRunner } from "../tasks/task-runner.js";
import { createDesktopOperationsService } from "./desktop-operations.js";

function createService() {
  const calls: string[] = [];
  const service = createDesktopOperationsService({
    tasks: createTaskRunner(),
    removeAccount: async ({ envName, accountName }) => {
      calls.push(`remove:${envName}/${accountName}`);
    },
    logoutAccount: async ({ envName, accountName, target }) => {
      calls.push(`logout:${envName}/${accountName}:${target}`);
    },
    readProxyState: async () => ({ source: "off" as const, value: "" }),
    setManualProxy: async (value) => {
      calls.push(`set-proxy:${value}`);
      return "http://127.0.0.1:7890";
    },
    clearManualProxy: async () => {
      calls.push("clear-proxy");
    },
    runProxyCheck: async () => ({
      stdout: "usage_api_proxy_test: ok\n",
      stderr: "",
      exitCode: 0,
    }),
    getTokenRefreshStatus: async () => "token_refresh_guard: disabled\n",
    startTokenRefreshGuard: async () => "token_refresh_guard: enabled\n",
    stopTokenRefreshGuard: async () => "token_refresh_guard: disabled\n",
    runTokenRefreshOnce: async () => ({
      stdout: "Summary: scanned=1\n",
      stderr: "",
      exitCode: 0,
    }),
    getAppStatus: async () => "app_current: default/default\n",
    logoutApp: async (input) => {
      calls.push(`logout-app:${input?.accountName ?? ""}`);
    },
    stopManagedApp: async () => true,
    listOperations: async () => "ops: ok\n",
    runDoctor: async () => ({
      stdout: "doctor: ok\n",
      stderr: "",
      exitCode: 0,
    }),
    runRecover: async () => ({
      stdout: "recover: ok\n",
      stderr: "",
      exitCode: 0,
    }),
  });
  return { calls, service };
}

test("desktop operations service removes an account without invoking the Bash wrapper", async () => {
  const { calls, service } = createService();

  const result = await service.deleteAccount({
    envName: "default",
    accountName: "personal",
  });

  assert.equal(result.message, "Removed account default/personal");
  assert.equal(result.output, "default/personal\n");
  assert.deepEqual(calls, ["remove:default/personal"]);
});

test("desktop operations service uses task runner for proxy test", async () => {
  const { service } = createService();

  const result = await service.testProxy();

  assert.equal(result.message, "Proxy test completed");
  assert.equal(result.output, "usage_api_proxy_test: ok\n");
  assert.match(result.taskId, /^task-\d+$/);
});

test("desktop operations service returns off proxy status from adapter state", async () => {
  const { service } = createService();

  const result = await service.getProxyStatus();

  assert.equal(result.message, "Loaded proxy status");
  assert.equal(result.output, "usage_api_proxy: off\n");
});
