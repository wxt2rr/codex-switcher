import test from "node:test";
import assert from "node:assert/strict";
import { createTaskRunner, } from "./task-runner.js";
test("task runner records successful task lifecycle and log events", async () => {
    const runner = createTaskRunner();
    const result = await runner.run({
        kind: "proxy-test",
        summary: "Run proxy connectivity check",
        execute: async ({ log, updateProgress }) => {
            updateProgress("started");
            log("testing proxy");
            updateProgress("done");
            return "ok";
        },
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.output, "ok");
    assert.deepEqual(result.progress, ["started", "done"]);
    assert.deepEqual(result.logs, ["testing proxy"]);
    const recent = runner.listRecent();
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.kind, "proxy-test");
    assert.equal(recent[0]?.status, "succeeded");
});
test("task runner records failed task lifecycle and keeps failure diagnostics", async () => {
    const runner = createTaskRunner();
    await assert.rejects(() => runner.run({
        kind: "doctor-fix",
        summary: "Run repair",
        execute: async ({ log, updateProgress }) => {
            updateProgress("started");
            log("repair step 1");
            throw new Error("repair failed");
        },
    }));
    const recent = runner.listRecent();
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.status, "failed");
    assert.deepEqual(recent[0]?.progress, ["started"]);
    assert.deepEqual(recent[0]?.logs, ["repair step 1"]);
    assert.equal(recent[0]?.error, "repair failed");
});
//# sourceMappingURL=task-runner.test.js.map