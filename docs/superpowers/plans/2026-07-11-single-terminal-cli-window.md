# Single Terminal CLI Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure launching Codex CLI through macOS Terminal creates exactly one new command window, including when Terminal is not already running.

**Architecture:** Keep terminal selection and duplicate-launch gating unchanged. When Terminal is already running, use an unscoped `do script` to create a new CLI window. On cold startup, launch Terminal, wait for its initial window, and run the command in that window's selected tab so Terminal does not create a second window.

**Tech Stack:** Electron, TypeScript, Node.js test runner, AppleScript

## Global Constraints

- Change only the macOS Apple Terminal `new-window` launch behavior.
- Preserve iTerm, current-window, Windows, Linux, working-directory, and duplicate-launch behavior.
- Do not close or reuse an existing user window for the new-window action.

---

### Task 1: Enforce a Single Native Terminal Command

**Files:**
- Modify: `apps/desktop/electron/bridge.ts:2045`
- Test: `apps/desktop/electron/bridge-smoke.test.ts:134`

**Interfaces:**
- Consumes: `buildTerminalAppleScript(command: string): string`
- Produces: an AppleScript that creates a new window on warm startup and reuses Terminal's initial window on cold startup

- [x] **Step 1: Write the failing regression assertions**

Update the Apple Terminal launch test to assert:

```ts
assert.match(terminalScript, /set terminalWasRunning to application "Terminal" is running/);
assert.match(terminalScript, /if terminalWasRunning then\ndo script/);
assert.match(terminalScript, /else\nlaunch\nrepeat 50 times/);
assert.match(terminalScript, /do script .* in selected tab of front window/);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --test-name-pattern="selects Terminal without a side-effecting iTerm fallback" apps/desktop/electron/bridge-smoke.test.ts`

Expected: FAIL because the generated script does not distinguish warm and cold Terminal startup.

- [x] **Step 3: Implement the minimal AppleScript generator**

Implement explicit warm/cold startup handling:

```ts
function buildTerminalAppleScript(command: string): string {
  const quotedCommand = quoteAppleScriptString(command);
  return `set terminalWasRunning to application "Terminal" is running
tell application "Terminal"
if terminalWasRunning then
do script ${quotedCommand}
else
launch
repeat 50 times
if exists front window then exit repeat
delay 0.1
end repeat
if not (exists front window) then error "Terminal did not create its initial window"
do script ${quotedCommand} in selected tab of front window
end if
activate
end tell`;
}
```

- [x] **Step 4: Run focused and bridge regression tests**

Run: `npm test -- apps/desktop/electron/bridge-smoke.test.ts`

Expected: all Electron bridge smoke tests pass.

- [x] **Step 5: Run TypeScript/build verification**

Run: `npm run build --workspace apps/desktop`

Expected: command exits with status 0.
