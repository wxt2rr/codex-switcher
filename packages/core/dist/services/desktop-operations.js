export function createDesktopOperationsService(options) {
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
                output: proxy.source === "off"
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
                        throw new Error(result.stderr || `token refresh failed with exit code ${result.exitCode}`);
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
//# sourceMappingURL=desktop-operations.js.map