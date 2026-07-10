import type { ExternalCommandResult } from "../tasks/bridge.js";
import type { TaskRunner } from "../tasks/task-runner.js";

export interface DesktopActionResult {
  message: string;
  output?: string;
}

export interface DesktopOperationsServiceOptions {
  tasks: TaskRunner;
  removeAccount(input: { envName: string; accountName: string }): Promise<void>;
  logoutAccount(input: {
    envName: string;
    accountName: string;
    target: "cli" | "app" | "both";
  }): Promise<void>;
  readProxyState(): Promise<{
    source: "manual" | "auto-env" | "auto-system" | "off";
    value: string;
  }>;
  setManualProxy(value: string): Promise<string>;
  clearManualProxy(): Promise<void>;
  runProxyCheck(): Promise<ExternalCommandResult>;
  getTokenRefreshStatus(): Promise<string>;
  startTokenRefreshGuard(): Promise<string>;
  stopTokenRefreshGuard(): Promise<string>;
  runTokenRefreshOnce(): Promise<ExternalCommandResult>;
  getAppStatus(): Promise<string>;
  logoutApp(input?: { accountName?: string }): Promise<void>;
  stopManagedApp(): Promise<boolean>;
  listOperations(): Promise<string>;
  runDoctor(): Promise<ExternalCommandResult>;
  runRecover(): Promise<ExternalCommandResult>;
}

export interface DesktopOperationsService {
  deleteAccount(input: {
    envName: string;
    accountName: string;
  }): Promise<DesktopActionResult>;
  logoutAccount(input: {
    envName: string;
    accountName: string;
    target: "cli" | "app" | "both";
  }): Promise<DesktopActionResult>;
  getProxyStatus(): Promise<DesktopActionResult>;
  setProxy(input: { value: string }): Promise<DesktopActionResult>;
  disableProxy(): Promise<DesktopActionResult>;
  testProxy(): Promise<DesktopActionResult & { taskId: string }>;
  getTokenRefreshStatus(): Promise<DesktopActionResult>;
  startTokenRefreshGuard(): Promise<DesktopActionResult>;
  stopTokenRefreshGuard(): Promise<DesktopActionResult>;
  runTokenRefreshOnce(): Promise<DesktopActionResult & { taskId: string }>;
  getAppStatus(): Promise<DesktopActionResult>;
  logoutApp(input?: { accountName?: string }): Promise<DesktopActionResult>;
  stopManagedApp(): Promise<DesktopActionResult>;
  listOperations(): Promise<DesktopActionResult>;
  runDoctor(): Promise<DesktopActionResult & { taskId: string }>;
  runRecover(): Promise<DesktopActionResult & { taskId: string }>;
}

export function createDesktopOperationsService(
  options: DesktopOperationsServiceOptions,
): DesktopOperationsService {
  return {
    async deleteAccount(input) {
      await options.removeAccount(input);
      return {
        message: `Removed account ${input.envName}/${input.accountName}`,
        output: `${input.envName}/${input.accountName}\n`,
      };
    },

    async logoutAccount(input) {
      await options.logoutAccount(input);
      return {
        message: `Logged out ${input.envName}/${input.accountName}`,
        output: `${input.envName}/${input.accountName}\n`,
      };
    },

    async getProxyStatus() {
      const proxy = await options.readProxyState();
      return {
        message: "Loaded proxy status",
        output:
          proxy.source === "off"
            ? "usage_api_proxy: off\n"
            : `usage_api_proxy: ${proxy.value} (${proxy.source})\n`,
      };
    },

    async setProxy(input) {
      const value = await options.setManualProxy(input.value);
      return {
        message: `Updated proxy to ${value}`,
        output: `${value}\n`,
      };
    },

    async disableProxy() {
      await options.clearManualProxy();
      return {
        message: "Disabled proxy",
        output: "off\n",
      };
    },

    async testProxy() {
      const record = await options.tasks.run({
        kind: "proxy-test",
        summary: "Run proxy connectivity check",
        execute: async ({ updateProgress }) => {
          updateProgress("starting");
          const result = await options.runProxyCheck();
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `proxy test failed with exit code ${result.exitCode}`);
          }
          updateProgress("completed");
          return result;
        },
      });

      return {
        message: "Proxy test completed",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },

    async getTokenRefreshStatus() {
      return {
        message: "Loaded token refresh status",
        output: await options.getTokenRefreshStatus(),
      };
    },

    async startTokenRefreshGuard() {
      return {
        message: "Started token refresh guard",
        output: await options.startTokenRefreshGuard(),
      };
    },

    async stopTokenRefreshGuard() {
      return {
        message: "Stopped token refresh guard",
        output: await options.stopTokenRefreshGuard(),
      };
    },

    async runTokenRefreshOnce() {
      const record = await options.tasks.run({
        kind: "token-refresh",
        summary: "Run one token refresh scan",
        execute: async ({ updateProgress }) => {
          updateProgress("starting");
          const result = await options.runTokenRefreshOnce();
          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr || `token refresh failed with exit code ${result.exitCode}`,
            );
          }
          updateProgress("completed");
          return result;
        },
      });

      return {
        message: "Token refresh scan completed",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },

    async getAppStatus() {
      return {
        message: "Loaded app status",
        output: await options.getAppStatus(),
      };
    },

    async logoutApp(input) {
      await options.logoutApp(input);
      return {
        message: "Logged out app account",
        output: `${input?.accountName ?? ""}\n`,
      };
    },

    async stopManagedApp() {
      const stopped = await options.stopManagedApp();
      return {
        message: "Stopped managed app",
        output: `${stopped ? "stopped" : "noop"}\n`,
      };
    },

    async listOperations() {
      return {
        message: "Loaded operations status",
        output: await options.listOperations(),
      };
    },

    async runDoctor() {
      const record = await options.tasks.run({
        kind: "doctor",
        summary: "Run doctor diagnostics",
        execute: async ({ updateProgress }) => {
          updateProgress("starting");
          const result = await options.runDoctor();
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `doctor failed with exit code ${result.exitCode}`);
          }
          updateProgress("completed");
          return result;
        },
      });

      return {
        message: "Doctor finished",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },

    async runRecover() {
      const record = await options.tasks.run({
        kind: "recover",
        summary: "Run recover workflow",
        execute: async ({ updateProgress }) => {
          updateProgress("starting");
          const result = await options.runRecover();
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `recover failed with exit code ${result.exitCode}`);
          }
          updateProgress("completed");
          return result;
        },
      });

      return {
        message: "Recover finished",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },
  };
}
