import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { executableCandidates, getPlatformRuntime, resolveHomeDir, resolveRuntimePaths, shellInitFiles, } from "./runtime.js";
test("resolveHomeDir prefers Windows-specific env vars on win32", () => {
    assert.equal(resolveHomeDir({
        USERPROFILE: "C:\\Users\\alice",
    }, "win32"), "C:\\Users\\alice");
});
test("resolveRuntimePaths derives switcher directories from home", () => {
    const paths = resolveRuntimePaths({
        HOME: "/Users/alice",
    }, "darwin");
    assert.equal(paths.stateDir, "/Users/alice/.codex-switcher");
    assert.equal(paths.envsDir, "/Users/alice/.codex-envs");
    assert.equal(paths.defaultHome, "/Users/alice/.codex");
});
test("resolveRuntimePaths honors explicit environment overrides", () => {
    const paths = resolveRuntimePaths({
        HOME: "/Users/alice",
        CODEX_SWITCHER_STATE_DIR: "/tmp/state",
        CODEX_SWITCHER_ENVS_DIR: "/tmp/envs",
        CODEX_SWITCHER_DEFAULT_HOME: "/tmp/home",
    }, "darwin");
    assert.equal(paths.stateDir, "/tmp/state");
    assert.equal(paths.envsDir, "/tmp/envs");
    assert.equal(paths.defaultHome, "/tmp/home");
});
test("executableCandidates includes Windows launchers on win32", () => {
    assert.deepEqual(executableCandidates("codex", "win32"), [
        "codex",
        "codex.exe",
        "codex.cmd",
        "codex.bat",
    ]);
    assert.deepEqual(executableCandidates("codex", "darwin"), ["codex"]);
});
test("shellInitFiles returns PowerShell profiles on windows", () => {
    const files = shellInitFiles({
        USERPROFILE: "C:\\Users\\alice",
    }, "win32");
    assert.deepEqual(files, [
        join("C:\\Users\\alice", "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
        join("C:\\Users\\alice", "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    ]);
});
test("getPlatformRuntime exposes platform-specific defaults", () => {
    const runtime = getPlatformRuntime({
        USERPROFILE: "C:\\Users\\alice",
    }, "win32");
    assert.equal(runtime.platform, "windows");
    assert.equal(runtime.npmCommand, "npm.cmd");
    assert.equal(runtime.paths.stateDir, "C:\\Users\\alice/.codex-switcher");
    assert.match(runtime.codexCliCandidates.join(","), /codex\.exe/);
});
//# sourceMappingURL=runtime.test.js.map