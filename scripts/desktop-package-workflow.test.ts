import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("desktop packaging workflow builds native installers for version tags and manual runs", async () => {
  const workflow = await readFile(join(process.cwd(), ".github", "workflows", "desktop-package.yml"), "utf8");
  const requiredContent = [
    "workflow_dispatch:",
    'tags: ["desktop-v*"]',
    "permissions:",
    "contents: read",
    "package-macos:",
    "runs-on: macos-latest",
    "package-windows:",
    "runs-on: windows-latest",
    "npm run desktop:build",
    "npm run desktop:test",
    "npm run desktop:package:mac",
    "npm run package:verify --workspace apps/desktop",
    "npm run desktop:package:win",
    "codex-switcher-macos-arm64",
    "codex-switcher-windows-x64",
  ];

  for (const content of requiredContent) {
    assert.ok(workflow.includes(content), `desktop package workflow should include: ${content}`);
  }
  assert.equal(workflow.match(/actions\/upload-artifact@v4/g)?.length, 2);
  assert.equal(workflow.match(/if-no-files-found: error/g)?.length, 2);
  assert.equal(workflow.match(/retention-days: 14/g)?.length, 2);
  assert.doesNotMatch(workflow, /contents:\s*write/);
});
