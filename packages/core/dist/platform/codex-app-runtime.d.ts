export interface ManagedAppStatePaths {
    stateDir: string;
    appPidFile: string;
    appInstancesDir: string;
    appProfilesDir: string;
    appLastInstanceFile: string;
}
export interface ManagedAppInstanceRecord {
    instanceId: string;
    pid: number;
    targetKey?: string;
}
export interface ManagedAppProfileRemovalOptions {
    maxRetries?: number;
    retryDelayMs?: number;
    remove?: (path: string) => Promise<void>;
    delay?: (ms: number) => Promise<void>;
}
export declare function resolveManagedAppStatePaths(stateDir: string): ManagedAppStatePaths;
export declare function readManagedAppPid(paths: ManagedAppStatePaths): Promise<number | null>;
export declare function writeManagedAppPid(paths: ManagedAppStatePaths, pid: number | null): Promise<void>;
export declare function readLastManagedAppInstanceId(paths: ManagedAppStatePaths): Promise<string | null>;
export declare function listManagedAppInstances(paths: ManagedAppStatePaths): Promise<ManagedAppInstanceRecord[]>;
export declare function setManagedAppInstance(paths: ManagedAppStatePaths, input: ManagedAppInstanceRecord): Promise<void>;
export declare function clearManagedAppInstance(paths: ManagedAppStatePaths, instanceId: string, removalOptions?: ManagedAppProfileRemovalOptions): Promise<void>;
export declare function removeManagedAppProfile(profilePath: string, options?: ManagedAppProfileRemovalOptions): Promise<void>;
export type ManagedAppStopper = (pid: number, applicationName?: string) => Promise<boolean>;
export declare function stopManagedAppPid(paths: ManagedAppStatePaths, stopper: ManagedAppStopper, applicationName?: string, targetKey?: string): Promise<boolean>;
