import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = process.cwd();

test("package.json exposes Windows manual helper npm scripts", async () => {
  const packageJson = JSON.parse(await readFile(`${repoRoot}/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.ok(packageJson.scripts, "package.json should define scripts");
  assert.equal(
    packageJson.scripts?.["windows:manual:start"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-start.ps1",
  );
  assert.equal(
    packageJson.scripts?.["windows:manual:capture"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-capture.ps1",
  );
  assert.equal(
    packageJson.scripts?.["windows:manual:result-template"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-result-template.ps1",
  );
  assert.equal(
    packageJson.scripts?.["test:lifecycle"],
    "node ./scripts/run-lifecycle-tests.mjs",
  );
  assert.equal(
    packageJson.scripts?.["desktop:package:linux"],
    "npm run package:linux --workspace ./apps/desktop",
  );
  const desktopPackageJson = JSON.parse(await readFile(`${repoRoot}/apps/desktop/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(desktopPackageJson.scripts?.["test:desktop"], "node ./scripts/run-tests.mjs");
  assert.equal(
    packageJson.scripts?.["release:verify-manifest"],
    "node ./scripts/verify-update-manifest.mjs",
  );
  assert.equal(packageJson.scripts?.["core:test"], "node ./packages/core/scripts/run-tests.mjs");
  assert.doesNotMatch(packageJson.scripts?.["test:cross-platform"] ?? "", /\$\(|find /);
  assert.match(packageJson.scripts?.["test:cross-platform"] ?? "", /tsx --test --test-concurrency=1/);
  const corePackageJson = JSON.parse(await readFile(`${repoRoot}/packages/core/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(corePackageJson.scripts?.test, "node ./scripts/run-tests.mjs");
  const gatewayPackageJson = JSON.parse(await readFile(`${repoRoot}/packages/gateway/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(gatewayPackageJson.scripts?.test, "node ./scripts/run-tests.mjs");
});
