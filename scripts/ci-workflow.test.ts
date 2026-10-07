import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const repoRoot = process.cwd();

test("GitHub Actions CI covers cross-platform core and desktop sandbox regressions", async () => {
  const content = await readFile(`${repoRoot}/.github/workflows/ci.yml`, "utf8");

  const requiredLines = [
    "name: ci",
    "cross-platform:",
    "windows-latest",
    "macos-latest",
    "ubuntu-latest",
    "Run cross-platform tests",
    "run: npm run test:cross-platform",
    "mac-desktop:",
    "Run desktop tests",
    "run: npm run desktop:test",
    "desktop-non-macos:",
    "matrix.os",
    "Install and verify bubblewrap",
    "apparmor-utils",
    "Allow bubblewrap user namespaces on Ubuntu runners",
    "/etc/apparmor.d/codex-switcher-bwrap",
    "apparmor_parser -r",
    "g++-mingw-w64-x86-64",
    "Cross-compile Windows plugin sandbox helper",
    "x86_64-w64-mingw32-g++",
    "codex-switcher-plugin-sandbox.exe",
    "Run Linux plugin sandbox smoke test",
    "CODEX_SWITCHER_EVIDENCE_OUT=.wxt/evidence/linux-sandbox.json",
    "Verify Linux plugin sandbox evidence",
    "Verify Windows plugin sandbox helper",
    "Run Windows plugin sandbox smoke test",
    "windows-sandbox.json",
    "Verify Windows plugin sandbox evidence",
    "Upload plugin sandbox evidence",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `ci workflow should include: ${line}`);
  }

  const workflow = parse(content) as {
    jobs?: Record<string, {
      strategy?: { matrix?: { os?: string[] } };
      steps?: Array<{ name?: string; if?: string; run?: string }>;
    }>;
  };
  const crossPlatform = workflow.jobs?.["cross-platform"];
  assert.deepEqual(crossPlatform?.strategy?.matrix?.os, ["macos-latest", "windows-latest", "ubuntu-latest"]);
  const desktopNonMacos = workflow.jobs?.["desktop-non-macos"];
  assert.deepEqual(desktopNonMacos?.strategy?.matrix?.os, ["windows-latest", "ubuntu-latest"]);
  const steps = desktopNonMacos?.steps ?? [];
  assert.ok(steps.some((step) => step.if === "matrix.os == 'ubuntu-latest'" && step.run?.includes("bwrap --version")));
  assert.ok(steps.some((step) => step.name === "Allow bubblewrap user namespaces on Ubuntu runners" && step.if === "matrix.os == 'ubuntu-latest'" && step.run?.includes("apparmor_parser -r")));
  assert.ok(steps.some((step) => step.name === "Cross-compile Windows plugin sandbox helper" && step.if === "matrix.os == 'ubuntu-latest'" && step.run?.includes("x86_64-w64-mingw32-g++")));
  assert.ok(steps.some((step) => step.if === "matrix.os == 'windows-latest'" && step.run?.includes("codex-switcher-plugin-sandbox.exe")));
  assert.ok(steps.some((step) => step.name === "Upload plugin sandbox evidence" && step.run === undefined));
});
