import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedAppStopPlan, executeManagedAppStopPlan, } from "./codex-app-stop.js";
test("buildManagedAppStopPlan uses taskkill tree termination on windows", () => {
    const plan = buildManagedAppStopPlan({
        platform: "windows",
        pid: 4321,
    });
    assert.deepEqual(plan, [
        {
            kind: "spawn",
            command: "taskkill",
            args: ["/PID", "4321", "/T", "/F"],
        },
    ]);
});
test("buildManagedAppStopPlan uses AppleScript quit before pid fallback on macos", () => {
    const plan = buildManagedAppStopPlan({
        platform: "macos",
        pid: 9876,
        preferAppQuit: true,
    });
    assert.deepEqual(plan, [
        {
            kind: "spawn",
            command: "osascript",
            args: ["-e", 'tell application "Codex" to quit'],
            optional: true,
        },
        {
            kind: "signal",
            pid: 9876,
            signal: "SIGTERM",
        },
    ]);
});
test("executeManagedAppStopPlan runs steps in order and tolerates optional failures", async () => {
    const calls = [];
    const result = await executeManagedAppStopPlan([
        {
            kind: "spawn",
            command: "osascript",
            args: ["-e", 'tell application "Codex" to quit'],
            optional: true,
        },
        {
            kind: "signal",
            pid: 1111,
            signal: "SIGTERM",
        },
    ], {
        spawn: async (command, args) => {
            calls.push(`spawn:${command} ${args.join(" ")}`);
            throw new Error("missing osascript");
        },
        signal: async (pid, signal) => {
            calls.push(`signal:${pid}:${signal}`);
        },
    });
    assert.equal(result, true);
    assert.deepEqual(calls, [
        'spawn:osascript -e tell application "Codex" to quit',
        "signal:1111:SIGTERM",
    ]);
});
test("executeManagedAppStopPlan tolerates missing windows taskkill target", async () => {
    const calls = [];
    const result = await executeManagedAppStopPlan([
        {
            kind: "spawn",
            command: "taskkill",
            args: ["/PID", "4321", "/T", "/F"],
        },
    ], {
        spawn: async (command, args) => {
            calls.push(`spawn:${command} ${args.join(" ")}`);
            const error = new Error("taskkill exited with code 128");
            error.code = "TASKKILL_NOT_FOUND";
            error.stderr = "ERROR: The process \"4321\" not found.";
            throw error;
        },
        signal: async () => {
            calls.push("signal");
        },
    });
    assert.equal(result, true);
    assert.deepEqual(calls, ["spawn:taskkill /PID 4321 /T /F"]);
});
//# sourceMappingURL=codex-app-stop.test.js.map