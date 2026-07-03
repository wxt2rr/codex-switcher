import assert from "node:assert/strict";
import test from "node:test";
import { listAccountOptions, listEnvOptions, listTargetOptions, renderSwitchSummary, } from "./switch.js";
test("listTargetOptions exposes cli and app targets", () => {
    assert.deepEqual(listTargetOptions(), ["cli", "app"]);
});
test("listEnvOptions prioritizes current target env", () => {
    const envs = listEnvOptions([
        { name: "project", isCurrentApp: true },
        { name: "default", isCurrentCli: true },
    ], "cli");
    assert.equal(envs[0]?.name, "default");
});
test("listAccountOptions filters by env and prioritizes current target account", () => {
    const accounts = listAccountOptions([
        { envName: "default", name: "personal", authMode: "apikey" },
        { envName: "default", name: "work", authMode: "auth", isCurrentCli: true },
        { envName: "project", name: "other", authMode: "auth" },
    ], "default", "cli");
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0]?.name, "work");
});
test("renderSwitchSummary shows target, env, account, and action", () => {
    const summary = renderSwitchSummary({
        target: "cli",
        envName: "default",
        accountName: "work",
        actionLabel: "launch-cli",
    });
    assert.match(summary, /Target:\s+cli/);
    assert.match(summary, /Env:\s+default/);
    assert.match(summary, /Account:\s+work/);
    assert.match(summary, /Action:\s+launch-cli/);
});
//# sourceMappingURL=switch.test.js.map