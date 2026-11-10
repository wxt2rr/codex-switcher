import { type AccountState, type AuthDataRecord, type EnvironmentModelIdentityMode, type SwitcherState } from "./store.js";
import { type GatewayEnvironmentState } from "../gateway/model.js";
import { type GatewayEnvironmentStateV2 } from "../gateway/v2.js";
export interface ReadLegacyStateOptions {
    stateDir: string;
    envsDir: string;
    defaultHome: string;
    now?: string;
}
export interface WriteLegacyPointersOptions {
    stateDir: string;
    target: "cli" | "app";
    env: string;
    account: string;
}
export interface WriteLegacyRuntimeOptions {
    stateDir: string;
    envName: string;
    accountName: string;
    runtime: AccountState["runtime"];
}
export interface WriteLegacyAuthDataOptions {
    stateDir: string;
    envName: string;
    accountName: string;
    authData: AuthDataRecord;
}
export interface WriteLegacySystemAuthRuntimeOptions {
    stateDir: string;
    envName: string;
    runtime: AccountState["runtime"];
}
export interface WriteLegacySystemAuthDataOptions {
    stateDir: string;
    envName: string;
    authData: AuthDataRecord;
}
export interface ClearLegacySystemAuthOptions {
    stateDir: string;
    envName: string;
}
export interface WriteLegacyGatewayOptions {
    stateDir: string;
    envName: string;
    gateway: GatewayEnvironmentState;
}
export interface ClearLegacyGatewayOptions {
    stateDir: string;
    envName: string;
}
export interface WriteLegacyGatewayV2Options {
    stateDir: string;
    envName: string;
    gateway: GatewayEnvironmentStateV2;
}
export interface ReadLegacyGatewayV2Options {
    stateDir: string;
    envName: string;
}
export interface CreateLegacyEnvOptions {
    envsDir: string;
    envName: string;
}
export interface UpdateLegacyEnvOptions {
    stateDir: string;
    envsDir: string;
    envName: string;
    nextEnvName: string;
    homePath: string;
    modelIdentityMode?: EnvironmentModelIdentityMode;
}
export interface SetLegacyEnvModelIdentityModeOptions {
    stateDir: string;
    envName: string;
    modelIdentityMode: EnvironmentModelIdentityMode;
}
export interface SetLegacyEnvRemoteAccountOptions {
    stateDir: string;
    envName: string;
    accountName?: string;
}
export declare function readLegacyState(options: ReadLegacyStateOptions): Promise<SwitcherState>;
export declare function writeLegacyPointers(options: WriteLegacyPointersOptions): Promise<void>;
export declare function writeLegacyRuntime(options: WriteLegacyRuntimeOptions): Promise<void>;
/** Persist credential material only in the account auth store, never in Gateway metadata. */
export declare function writeLegacyAuthData(options: WriteLegacyAuthDataOptions): Promise<void>;
/** Persist the environment-owned system identity separately from accounts. */
export declare function writeLegacySystemAuthRuntime(options: WriteLegacySystemAuthRuntimeOptions): Promise<void>;
export declare function writeLegacySystemAuthData(options: WriteLegacySystemAuthDataOptions): Promise<void>;
/** Clear the active slot without touching the legacy account directory. The
 * old directory is intentionally retained as a recoverable migration backup. */
export declare function clearLegacySystemAuth(options: ClearLegacySystemAuthOptions): Promise<void>;
export declare function writeLegacyGateway(options: WriteLegacyGatewayOptions): Promise<void>;
export declare function clearLegacyGateway(options: ClearLegacyGatewayOptions): Promise<void>;
export declare function writeLegacyGatewayV2(options: WriteLegacyGatewayV2Options): Promise<void>;
export declare function readLegacyGatewayV2(options: ReadLegacyGatewayV2Options): Promise<GatewayEnvironmentStateV2 | undefined>;
export declare function clearLegacyGatewayV2(options: ClearLegacyGatewayOptions): Promise<void>;
export declare function createLegacyEnv(options: CreateLegacyEnvOptions): Promise<void>;
export declare function updateLegacyEnv(options: UpdateLegacyEnvOptions): Promise<void>;
export declare function setLegacyEnvModelIdentityMode(options: SetLegacyEnvModelIdentityModeOptions): Promise<void>;
export declare function setLegacyEnvRemoteAccount(options: SetLegacyEnvRemoteAccountOptions): Promise<void>;
