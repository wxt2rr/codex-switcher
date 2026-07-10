import type { ExternalCommandResult } from "../tasks/bridge.js";
import type { TaskRunner } from "../tasks/task-runner.js";
export interface DesktopActionResult {
    message: string;
    output?: string;
}
export interface DesktopOperationsServiceOptions {
    tasks: TaskRunner;
    removeAccount(input: {
        envName: string;
        accountName: string;
    }): Promise<void>;
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
    logoutApp(input?: {
        accountName?: string;
    }): Promise<void>;
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
    setProxy(input: {
        value: string;
    }): Promise<DesktopActionResult>;
    disableProxy(): Promise<DesktopActionResult>;
    testProxy(): Promise<DesktopActionResult & {
        taskId: string;
    }>;
    getTokenRefreshStatus(): Promise<DesktopActionResult>;
    startTokenRefreshGuard(): Promise<DesktopActionResult>;
    stopTokenRefreshGuard(): Promise<DesktopActionResult>;
    runTokenRefreshOnce(): Promise<DesktopActionResult & {
        taskId: string;
    }>;
    getAppStatus(): Promise<DesktopActionResult>;
    logoutApp(input?: {
        accountName?: string;
    }): Promise<DesktopActionResult>;
    stopManagedApp(): Promise<DesktopActionResult>;
    listOperations(): Promise<DesktopActionResult>;
    runDoctor(): Promise<DesktopActionResult & {
        taskId: string;
    }>;
    runRecover(): Promise<DesktopActionResult & {
        taskId: string;
    }>;
}
export declare function createDesktopOperationsService(options: DesktopOperationsServiceOptions): DesktopOperationsService;
