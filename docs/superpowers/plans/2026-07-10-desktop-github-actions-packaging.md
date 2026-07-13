# Desktop GitHub Actions Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track the desktop application source and automatically build downloadable macOS ARM64 and Windows x64 installers when a `desktop-v*` tag is pushed or the packaging workflow is manually dispatched.

**Architecture:** Repository ignore rules retain desktop source while excluding generated output. Portable package tests derive paths from each test module. A dedicated GitHub Actions workflow runs native macOS and Windows jobs, validates before packaging, and uploads unsigned installers as short-lived workflow artifacts.

**Tech Stack:** GitHub Actions, Node.js 20, npm workspaces, Electron Builder 24, Node test runner.

## Global Constraints

- Ordinary pushes and pull requests do not generate installers.
- Packaging triggers are `workflow_dispatch` and tags matching `desktop-v*`.
- macOS uses `macos-latest` and produces ARM64 DMG/ZIP artifacts.
- Windows uses `windows-latest` and produces an x64 NSIS EXE artifact.
- Missing installer files must fail the artifact-upload step.
- Artifact retention is 14 days.
- No signing secrets, GitHub Release publishing, or `contents: write` permission are added.
- Existing user changes outside the packaging scope must not be staged, reverted, or rewritten.

---

### Task 1: Track desktop source without generated output

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Produces: Git-visible `apps/desktop` source with ignored `dist`, `electron-dist`, `release`, and `node_modules` directories.

- [ ] **Step 1: Replace the broad `apps/` ignore with generated-output rules.**

```gitignore
apps/desktop/dist/
apps/desktop/electron-dist/
apps/desktop/release/
apps/desktop/node_modules/
```

- [ ] **Step 2: Verify source visibility and output exclusion.**

Run:

```bash
git check-ignore apps/desktop/package.json; test $? -eq 1
git check-ignore apps/desktop/dist/index.html
git check-ignore apps/desktop/release/example.dmg
```

Expected: the source check reports unignored while generated paths report ignored.

### Task 2: Make desktop package tests portable

**Files:**
- Modify: `apps/desktop/electron/package.test.ts`
- Modify: `apps/desktop/electron/builder-config.test.ts`

**Interfaces:**
- Produces: module-relative `desktopRoot` resolution and an assertion matching macOS targets `dmg`, `zip`, and `dir`.

- [ ] **Step 1: Update the packaging assertion first and run it to preserve the known failing evidence.**

Expected failure before the assertion update: configured targets contain `dmg` and `zip` in addition to `dir`.

- [ ] **Step 2: Resolve test paths from `import.meta.url`.**

Use `fileURLToPath(new URL("..", import.meta.url))` for the desktop root and read `package.json` relative to it.

- [ ] **Step 3: Assert the current macOS package contract.**

```ts
assert.deepEqual(desktopPackage.build.mac?.target, ["dmg", "zip", "dir"]);
```

- [ ] **Step 4: Build desktop output and run both package tests.**

Run:

```bash
npm run desktop:build
npx tsx --test apps/desktop/electron/package.test.ts apps/desktop/electron/builder-config.test.ts
```

Expected: all package tests pass.

### Task 3: Define the packaging workflow contract

**Files:**
- Create: `.github/workflows/desktop-package.yml`
- Create: `scripts/desktop-package-workflow.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: a testable workflow contract and `test:desktop-package-workflow` script.

- [ ] **Step 1: Write a failing source-contract test.**

The test reads `.github/workflows/desktop-package.yml` relative to `import.meta.url` and asserts the presence of `workflow_dispatch`, `desktop-v*`, both native runners, both package commands, both artifact names, `if-no-files-found: error`, and `retention-days: 14`.

- [ ] **Step 2: Run the new test and confirm it fails because the workflow does not exist.**

Run:

```bash
npx tsx --test scripts/desktop-package-workflow.test.ts
```

Expected: failure with `ENOENT` for `.github/workflows/desktop-package.yml`.

- [ ] **Step 3: Create the native packaging workflow.**

The macOS job runs install, desktop build, desktop tests, mac package, mac artifact verification, then uploads DMG/ZIP/blockmaps. The Windows job runs install, desktop build, desktop tests, Windows package, then uploads EXE/blockmaps. Both use `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4`.

- [ ] **Step 4: Add the contract-test script to root package scripts.**

```json
"test:desktop-package-workflow": "tsx --test scripts/desktop-package-workflow.test.ts"
```

- [ ] **Step 5: Run the workflow contract test.**

Expected: the test passes.

### Task 4: Update desktop packaging documentation

**Files:**
- Modify: `apps/desktop/README.md`

**Interfaces:**
- Consumes: the tag and artifact names from Task 3.
- Produces: operator instructions for manual dispatch and `desktop-v*` tag packaging.

- [ ] **Step 1: Document the automatic packaging flow.**

Include the tag commands, artifact names, 14-day retention, unsigned-package limitation, and the fact that normal pushes do not package installers.

- [ ] **Step 2: Review names and commands against the workflow.**

Run:

```bash
rg -n "desktop-v|codex-switcher-macos-arm64|codex-switcher-windows-x64|14 days|unsigned" apps/desktop/README.md .github/workflows/desktop-package.yml
```

Expected: documentation and workflow names match.

### Task 5: Verify the complete packaging change

**Files:**
- Verify: `.gitignore`
- Verify: `.github/workflows/desktop-package.yml`
- Verify: `apps/desktop/electron/package.test.ts`
- Verify: `apps/desktop/electron/builder-config.test.ts`
- Verify: `scripts/desktop-package-workflow.test.ts`

**Interfaces:**
- Produces: local evidence that the repository is ready for GitHub-native packaging.

- [ ] **Step 1: Run the workflow and CI contract tests.**

```bash
npx tsx --test scripts/ci-workflow.test.ts scripts/desktop-package-workflow.test.ts
```

- [ ] **Step 2: Run the complete desktop test suite.**

```bash
npm run desktop:test
```

- [ ] **Step 3: Run the desktop production build.**

```bash
npm run desktop:build
```

- [ ] **Step 4: Audit repository visibility and ignored generated files.**

```bash
git status --short apps/desktop .github/workflows/desktop-package.yml .gitignore
git status --short --ignored apps/desktop/dist apps/desktop/electron-dist apps/desktop/release
```

- [ ] **Step 5: Record the native-runner boundary.**

Local validation proves workflow structure, tests, and the macOS production build. The Windows installer is accepted only after `package-windows` succeeds on `windows-latest`; no local macOS command is treated as proof of the Windows artifact.
