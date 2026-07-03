# Windows CLI TUI Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-native migration path for `codex-switcher` CLI and TUI without breaking the current macOS workflow during the transition.

**Architecture:** Introduce a Node/TypeScript CLI entry that coexists with the legacy Bash entrypoints, move command orchestration into shared TypeScript modules, and add platform adapters so terminal and scheduler behavior can diverge cleanly by OS. Keep the legacy Bash scripts working on macOS while the new Node path grows feature coverage and test evidence on macOS and Windows.

**Tech Stack:** TypeScript, Node.js, npm bin shims, `node:test`, existing `packages/core` APIs, legacy Bash compatibility layer.

---

## File Map

- Create: `docs/superpowers/plans/2026-07-01-windows-cli-tui-support.md`
- Create: `scripts/node-cli.ts`
- Create: `scripts/node-cli.test.ts`
- Create: `packages/core/src/platform/os.ts`
- Create: `packages/core/src/platform/os.test.ts`
- Modify: `package.json`
- Modify: `scripts/core-cli.ts`
- Modify: `scripts/core-cli.test.ts`
- Modify: `README.md`
- Modify: `README.en.md`

## Verification Matrix

- `node entry boots` -> `npx --yes tsx scripts/node-cli.ts version` -> exits `0`, prints package version
- `node entry routes legacy-safe commands` -> `npx --yes tsx --test scripts/node-cli.test.ts` -> passes on macOS
- `platform detection is cross-platform-safe` -> `npx --yes tsx --test packages/core/src/platform/os.test.ts` -> passes
- `existing core-cli behavior is unchanged` -> `npx --yes tsx --test scripts/core-cli.test.ts` -> passes
- `legacy Bash bridge still works on macOS` -> `npx --yes tsx --test scripts/legacy-cli-compat.test.ts` -> passes

## Task 1: Add a shared OS/platform detection module

**Files:**
- Create: `packages/core/src/platform/os.ts`
- Test: `packages/core/src/platform/os.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, isWindowsPlatform } from "./os.js";

test("detectPlatform maps Node platforms to switcher platform ids", () => {
  assert.equal(detectPlatform("win32"), "windows");
  assert.equal(detectPlatform("darwin"), "macos");
  assert.equal(detectPlatform("linux"), "linux");
});

test("isWindowsPlatform only returns true for win32", () => {
  assert.equal(isWindowsPlatform("win32"), true);
  assert.equal(isWindowsPlatform("darwin"), false);
  assert.equal(isWindowsPlatform("linux"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --yes tsx --test packages/core/src/platform/os.test.ts`  
Expected: FAIL because `./os.js` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export type SwitcherPlatform = "windows" | "macos" | "linux" | "unknown";

export function detectPlatform(platform = process.platform): SwitcherPlatform {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "unknown";
}

export function isWindowsPlatform(platform = process.platform): boolean {
  return detectPlatform(platform) === "windows";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --yes tsx --test packages/core/src/platform/os.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/os.ts packages/core/src/platform/os.test.ts
git commit -m "test: add platform detection helpers"
```

## Task 2: Add a Node CLI entrypoint that can coexist with Bash

**Files:**
- Create: `scripts/node-cli.ts`
- Test: `scripts/node-cli.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("node-cli prints version without invoking bash", async () => {
  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "version"],
    { cwd: repoRoot },
  );

  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --yes tsx --test scripts/node-cli.test.ts`  
Expected: FAIL because `scripts/node-cli.ts` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
import packageJson from "../package.json" with { type: "json" };
import { detectPlatform } from "../packages/core/src/platform/os.js";

async function main() {
  const [command = "help"] = process.argv.slice(2);

  if (command === "version" || command === "--version") {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (command === "platform") {
    process.stdout.write(`${detectPlatform()}\n`);
    return;
  }

  process.stderr.write("node-cli: command not implemented yet\n");
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Update package manifest for an opt-in Node bin**

```json
{
  "bin": {
    "codex-sw": "plugins/codex-switcher/scripts/codex-sw",
    "codex-switcher": "plugins/codex-switcher/scripts/codex-switcher",
    "codex-sw-node": "scripts/node-cli.ts"
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx --yes tsx --test scripts/node-cli.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/node-cli.ts scripts/node-cli.test.ts
git commit -m "feat: add opt-in node cli entrypoint"
```

## Task 3: Route safe read-only commands through the Node CLI

**Files:**
- Modify: `scripts/node-cli.ts`
- Modify: `scripts/core-cli.ts`
- Test: `scripts/node-cli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("node-cli delegates whoami to the TypeScript core path", async () => {
  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "whoami"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_SWITCHER_STATE_DIR: stateDir,
        CODEX_SWITCHER_ENVS_DIR: envsDir,
        CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      },
    },
  );

  assert.match(result.stdout, /cli: default\/personal/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --yes tsx --test scripts/node-cli.test.ts`  
Expected: FAIL because `whoami` is not implemented in `scripts/node-cli.ts`

- [ ] **Step 3: Add an exported programmatic runner in `scripts/core-cli.ts`**

```ts
export async function runCoreCli(argv: string[], io = process): Promise<number> {
  const [command = "", arg1 = "all", arg2 = "", arg3 = ""] = argv;
  // move the existing switch statement here, replacing process.stdout/stderr
  // writes with io.stdout/io.stderr writes
  return 0;
}

async function main() {
  const code = await runCoreCli(process.argv.slice(2));
  process.exit(code);
}
```

- [ ] **Step 4: Update `scripts/node-cli.ts` to delegate read-only commands**

```ts
import { runCoreCli } from "./core-cli.js";

const CORE_COMMANDS = new Set(["whoami", "status", "overview", "env-ls", "account-ls"]);

async function main() {
  const argv = process.argv.slice(2);
  const [command = "help"] = argv;

  if (CORE_COMMANDS.has(command)) {
    const code = await runCoreCli(argv);
    process.exit(code);
  }

  // keep version/platform handlers above this branch
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx --yes tsx --test scripts/node-cli.test.ts scripts/core-cli.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/core-cli.ts scripts/core-cli.test.ts scripts/node-cli.ts scripts/node-cli.test.ts
git commit -m "feat: route read-only commands through node cli"
```

## Task 4: Document the migration path and Windows support status

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: Write the failing doc check**

Run: `rg -n "Windows|PowerShell|cmd|codex-sw-node" README.md README.en.md`  
Expected: missing or incomplete entries for the new migration path

- [ ] **Step 2: Update the docs**

```md
- Current stable path: legacy Bash CLI/TUI on macOS and Unix-like terminals
- New migration path: `codex-sw-node` for cross-platform CLI bring-up
- Windows native support target: `cmd`, `PowerShell`, and `Windows Terminal`
- During migration, macOS Bash entrypoints remain supported and are the default
```

- [ ] **Step 3: Run the doc check**

Run: `rg -n "Windows|PowerShell|cmd|codex-sw-node" README.md README.en.md`  
Expected: matching lines in both docs

- [ ] **Step 4: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: describe windows cli migration path"
```

## Task 5: Preserve macOS compatibility evidence before expanding feature scope

**Files:**
- Test: `scripts/legacy-cli-compat.test.ts`
- Test: `scripts/core-cli.test.ts`
- Test: `scripts/node-cli.test.ts`
- Test: `packages/core/src/platform/os.test.ts`

- [ ] **Step 1: Run the TypeScript command tests**

Run: `npx --yes tsx --test scripts/core-cli.test.ts scripts/node-cli.test.ts packages/core/src/platform/os.test.ts`  
Expected: PASS

- [ ] **Step 2: Run the macOS legacy bridge compatibility test**

Run: `npx --yes tsx --test scripts/legacy-cli-compat.test.ts`  
Expected: PASS on macOS

- [ ] **Step 3: Record the migration checkpoint**

```md
Checkpoint: Node CLI entry exists, read-only commands delegate to TypeScript, and macOS legacy Bash compatibility still passes.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-01-windows-cli-tui-support.md
git commit -m "docs: record windows cli migration plan"
```
