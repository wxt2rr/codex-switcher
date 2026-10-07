import assert from "node:assert/strict";
import test from "node:test";
import { buildTrayMenu, chooseUpdate, dispatchMode, verifyArtifact } from "./runtime.js";
const profile = { id: "default", displayName: "Default", environmentId: "default", mode: "manual", selectedAccountId: "a", gatewayId: "g", updatedAt: 1 };
test("profile preserves manual account switching and exposes gateway as an explicit mode", () => {
    assert.equal(dispatchMode(profile), "manual-account");
    assert.equal(dispatchMode({ ...profile, mode: "gateway" }), "gateway-route");
    const menu = buildTrayMenu(profile, [{ id: "a", displayName: "Personal" }]);
    assert.equal(menu.find((item) => item.id === "account:a")?.enabled, true);
    assert.equal(menu.find((item) => item.id === "mode-gateway")?.enabled, true);
});
test("update selection requires a newer version, platform and channel", () => {
    const manifest = { version: "2.0.0", channel: "stable", platforms: ["macos"], artifactUrl: "https://example/update", sha256: "x", publishedAt: 1 };
    assert.ok(chooseUpdate("1.0.0", manifest, "macos"));
    assert.equal(chooseUpdate("2.0.0", manifest, "macos"), null);
    assert.equal(chooseUpdate("1.0.0", manifest, "windows"), null);
});
test("update artifact verification is deterministic", () => {
    assert.equal(verifyArtifact(new TextEncoder().encode("payload"), "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5"), true);
    assert.equal(verifyArtifact(new TextEncoder().encode("payload"), "bad"), false);
});
//# sourceMappingURL=runtime.test.js.map